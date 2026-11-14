/**
 * Shared SSRF guard for outbound fetches of user-supplied URLs (website crawler).
 * Runtime-neutral: no node: imports, usable from Vercel functions and the Worker.
 */

function ipv4Private(ipv4: string) {
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function expandIpv6(address: string): number[] | null {
  let input = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const dotted = input.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return null;
    const hex = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    input = input.slice(0, -dotted[1].length) + hex;
  }
  if (!/^[0-9a-f:]+$/.test(input)) return null;
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill(0), ...rest];
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  return groups;
}

export function isPrivateAddress(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(value)) return ipv4Private(value);
  // Not an IP literal (e.g. a CNAME target in a DoH answer): the caller resolves names separately.
  if (!value.includes(":")) return false;
  const groups = expandIpv6(value);
  if (!groups) return true; // unparseable: fail closed
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  const embeddedV4 = () => `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return ipv4Private(embeddedV4()); // ::ffff:a.b.c.d
  if (groups.slice(0, 6).every((group) => group === 0)) return true; // deprecated IPv4-compatible
  if (groups[0] === 0x64 && groups[1] === 0xff9b) return true; // NAT64
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation
  if (groups[0] === 0x2002) return ipv4Private(`${groups[1] >> 8}.${groups[1] & 0xff}.${groups[2] >> 8}.${groups[2] & 0xff}`); // 6to4
  return false;
}

export const MAX_GUARDED_REDIRECTS = 5;

/**
 * Fetch that never auto-follows redirects: every hop is validated before it is requested,
 * so a public URL cannot bounce the crawler to metadata or private network endpoints.
 */
export async function guardedFetch(
  fetcher: typeof fetch,
  start: URL,
  init: RequestInit,
  validateTarget?: (url: URL) => Promise<void> | void,
): Promise<{ response: Response; finalUrl: URL }> {
  let current = start;
  for (let hop = 0; hop <= MAX_GUARDED_REDIRECTS; hop += 1) {
    if (current.protocol !== "http:" && current.protocol !== "https:") throw new Error("UNSAFE_REDIRECT_PROTOCOL");
    await validateTarget?.(current);
    const response = await fetcher(current.toString(), { ...init, redirect: "manual" });
    if (response.type === "opaqueredirect") throw new Error("REDIRECT_UNREADABLE");
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get("location");
      if (!location) return { response, finalUrl: current };
      try { await response.body?.cancel(); } catch { /* body already consumed */ }
      current = new URL(location, current);
      continue;
    }
    const finalUrl = new URL(response.url || current.toString());
    if (finalUrl.toString() !== current.toString()) await validateTarget?.(finalUrl);
    return { response, finalUrl };
  }
  throw new Error("TOO_MANY_REDIRECTS");
}
