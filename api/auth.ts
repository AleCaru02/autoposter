import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleSameOriginAuthProxy } from "../cloudflare/auth-proxy.js";

/**
 * Canonical production Vercel auth gateway.
 * Uses the same guarded Neon Auth proxy as Cloudflare; never exposes upstream
 * URLs or secrets in the browser and never accepts arbitrary proxy targets.
 *
 * Neon Auth must separately trust APP_ORIGIN, and the OAuth provider must be
 * configured on the same Neon database branch.
 */
export const APP_ORIGIN = "https://post-automatici-canonical.vercel.app";

/**
 * Only the canonical production host and one explicitly configured preview
 * origin may use the same-origin Auth gateway. Never trust forwarded-host,
 * wildcard *.vercel.app hosts, or user-controlled redirect parameters.
 * Previews must also be allowlisted independently in Neon Auth.
 */
export function resolveAuthOrigin(host: string | undefined, environment: { VERCEL_ENV?: string; AUTH_PREVIEW_ORIGIN?: string } = process.env): string | null {
  if (host === new URL(APP_ORIGIN).host) return APP_ORIGIN;
  if (environment.VERCEL_ENV !== "preview" || !environment.AUTH_PREVIEW_ORIGIN) return null;
  try {
    const parsed = new URL(environment.AUTH_PREVIEW_ORIGIN);
    if (parsed.protocol !== "https:" || parsed.pathname !== "/" || parsed.search || parsed.hash ||
      parsed.username || parsed.password || parsed.port || !parsed.hostname.endsWith(".vercel.app")) return null;
    return host === parsed.host ? parsed.origin : null;
  } catch {
    return null;
  }
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requestedAuthSuffix(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value.join("/") : value ?? "";
  // The public /api/auth/* rewrite supplies a relative path, never a URL.
  if (!raw || raw.length > 512 || /[\\%?#]/.test(raw) ||
      raw.includes("//") || raw.includes("://") ||
      raw.split("/").some(segment => segment === "." || segment === ".." || !segment)) {
    return null;
  }
  return raw;
}

/**
 * Neon Auth may set SameSite=None; Partitioned cookies with an upstream Domain.
 * Proxied auth is first-party: bind cookies to this canonical Vercel hostname,
 * keep Google top-level callbacks working, and preserve expiry/HttpOnly.
 */
export function normalizeNeonAuthCookie(raw: string): string {
  const [nameValue, ...attrs] = raw.split(";").map((part) => part.trim()).filter(Boolean);
  if (!nameValue || !nameValue.includes("=")) return "";
  const remaining = attrs.filter((attribute) => !/^(?:domain=|path=|samesite=|partitioned$|secure$)/i.test(attribute));
  return [nameValue, ...remaining, "Path=/", "SameSite=Lax", "Secure"].join("; ");
}

function requestHeaders(req: VercelRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (typeof value === "string") headers.set(name, value);
  }
  // Vercel has already parsed JSON bodies; the reserialized length can differ.
  headers.delete("content-length");
  return headers;
}

function requestBody(req: VercelRequest): BodyInit | undefined {
  if (req.method !== "POST") return undefined;
  if (req.body == null) return undefined;
  if (typeof req.body === "string") return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body).toString("utf8");
  return JSON.stringify(req.body);
}

function toWebRequest(req: VercelRequest, suffix: string, appOrigin: string) {
  const url = new URL(`${appOrigin}/api/auth/${suffix}`);
  const inbound = new URL(req.url || "/api/auth", appOrigin);
  inbound.searchParams.delete("path");
  url.search = inbound.search;
  return new Request(url.toString(), {
    method: req.method || "GET",
    headers: requestHeaders(req),
    body: requestBody(req),
    redirect: "manual",
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  // Prevent treating arbitrary preview URLs as authorized OAuth origins.
  const publicHost = first(req.headers.host);
  const appOrigin = resolveAuthOrigin(publicHost);
  if (!appOrigin) {
    return res.status(403).json({ error: "AUTH_ORIGIN_NOT_ALLOWED" });
  }
  const suffix = requestedAuthSuffix(req.query.path);
  if (!suffix) return res.status(404).json({ error: "AUTH_PATH_NOT_ALLOWED" });
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  try {
    const upstream = await handleSameOriginAuthProxy(toWebRequest(req, suffix, appOrigin), { APP_BASE_URL: appOrigin });
    if (!upstream) return res.status(404).json({ error: "AUTH_PATH_NOT_ALLOWED" });
    for (const [name, value] of upstream.headers) {
      if (name === "set-cookie" || name === "content-length" || name === "transfer-encoding") continue;
      res.setHeader(name, value);
    }
    // Preserve distinct session/callback cookies; never comma-join Set-Cookie.
    const cookies = upstream.headers.getSetCookie().map(normalizeNeonAuthCookie).filter(Boolean);
    if (cookies.length) res.setHeader("set-cookie", cookies);
    return res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    // No request body, session, Google OAuth code or upstream URL in logs.
    return res.status(502).json({ error: "AUTH_PROXY_UNAVAILABLE" });
  }
}
