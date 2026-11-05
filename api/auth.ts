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

function toWebRequest(req: VercelRequest, suffix: string) {
  const url = new URL(`${APP_ORIGIN}/api/auth/${suffix}`);
  const inbound = new URL(req.url || "/api/auth", APP_ORIGIN);
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
  if (publicHost !== new URL(APP_ORIGIN).host) {
    return res.status(403).json({ error: "AUTH_ORIGIN_NOT_ALLOWED" });
  }
  const suffix = requestedAuthSuffix(req.query.path);
  if (!suffix) return res.status(404).json({ error: "AUTH_PATH_NOT_ALLOWED" });
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  try {
    const upstream = await handleSameOriginAuthProxy(toWebRequest(req, suffix), { APP_BASE_URL: APP_ORIGIN });
    if (!upstream) return res.status(404).json({ error: "AUTH_PATH_NOT_ALLOWED" });
    for (const [name, value] of upstream.headers) {
      if (name === "set-cookie" || name === "content-length" || name === "transfer-encoding") continue;
      res.setHeader(name, value);
    }
    // Preserve distinct session/callback cookies; never comma-join Set-Cookie.
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    return res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    // No request body, session, Google OAuth code or upstream URL in logs.
    return res.status(502).json({ error: "AUTH_PROXY_UNAVAILABLE" });
  }
}
