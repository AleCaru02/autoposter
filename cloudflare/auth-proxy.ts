const AUTH_UPSTREAM = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const AUTH_PREFIX = "/api/auth";
const DEFAULT_APP_ORIGIN = "https://autoposter.02alessandrocaruso.workers.dev";
const MAX_BODY_BYTES = 64 * 1024;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const FORWARDED_FROM_CLIENT = new Set([
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "host",
]);

const REQUEST_ALLOWLIST = new Set([
  "accept",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "x-force-fetch",
]);

const FORBIDDEN_PROXY_QUERY_KEYS = new Set(["url", "upstream"]);

export type SameOriginAuthEnv = { APP_BASE_URL?: string };

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function configuredAppOrigin(env: SameOriginAuthEnv) {
  try {
    return new URL(env.APP_BASE_URL || DEFAULT_APP_ORIGIN).origin;
  } catch {
    return null;
  }
}

function rawPathUnsafe(rawUrl: string) {
  let rawPath = "";
  try {
    rawPath = rawUrl.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/, 1)[0] || "/";
  } catch {
    return true;
  }

  const lowered = rawPath.toLowerCase();
  if (lowered.includes("\\") || lowered.includes("%2f") || lowered.includes("%5c")) return true;
  if (/https?(?:%3a|:)(?:%2f|\/)/i.test(lowered)) return true;

  let decoded = rawPath;
  for (let index = 0; index < 3; index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return true;
    }
    if (decoded.includes("\\")) return true;
    if (decoded.split("/").some((segment) => segment === "." || segment === "..")) return true;
    if (!/%[0-9a-f]{2}/i.test(decoded)) break;
  }
  return false;
}

function authSuffix(pathname: string) {
  if (!pathname.startsWith(`${AUTH_PREFIX}/`)) return null;
  const suffix = pathname.slice(AUTH_PREFIX.length);
  if (!suffix || suffix.includes("//") || suffix.includes("://")) return null;
  return suffix;
}

function hasForbiddenProxyQuery(url: URL) {
  return [...url.searchParams.keys()].some((key) => FORBIDDEN_PROXY_QUERY_KEYS.has(key.toLowerCase()));
}

function forwardedRequestHeaders(request: Request, appOrigin: string) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || FORWARDED_FROM_CLIENT.has(lower) || !REQUEST_ALLOWLIST.has(lower)) continue;
    headers.append(name, value);
  }

  if (request.method === "POST") {
    headers.set("origin", appOrigin);
    const referer = request.headers.get("referer");
    if (referer) {
      try {
        if (new URL(referer).origin === appOrigin) headers.set("referer", referer);
        else headers.set("referer", `${appOrigin}/`);
      } catch {
        headers.set("referer", `${appOrigin}/`);
      }
    }
  }

  return headers;
}

function rewriteAuthLocation(headers: Headers, request: Request) {
  const location = headers.get("location");
  if (!location) return;

  try {
    const upstreamBase = new URL(AUTH_UPSTREAM);
    const target = new URL(location, upstreamBase);
    if (target.origin !== upstreamBase.origin) return;
    if (target.pathname !== upstreamBase.pathname && !target.pathname.startsWith(`${upstreamBase.pathname}/`)) return;

    const incoming = new URL(request.url);
    const suffix = target.pathname.slice(upstreamBase.pathname.length);
    target.protocol = incoming.protocol;
    target.host = incoming.host;
    target.pathname = `${AUTH_PREFIX}${suffix}`;
    headers.set("location", target.toString());
  } catch {
    // Preserve malformed/non-absolute provider Location unchanged.
  }
}

function forwardedResponseHeaders(upstream: Response, request: Request) {
  const headers = new Headers();
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (lower === "set-cookie" || HOP_BY_HOP.has(lower)) continue;
    headers.append(name, value);
  }

  const setCookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  if (upstream.headers.has("set-cookie") && setCookies.length === 0) throw new Error("SET_COOKIE_ENUMERATION_UNAVAILABLE");
  for (const cookie of setCookies) headers.append("set-cookie", cookie);

  rewriteAuthLocation(headers, request);
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  headers.delete("expires");
  return headers;
}

export async function handleSameOriginAuthProxy(request: Request, env: SameOriginAuthEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(AUTH_PREFIX)) return null;

  const appOrigin = configuredAppOrigin(env);
  if (!appOrigin) return json({ error: "AUTH_PROXY_NOT_CONFIGURED" }, 503);
  if (url.origin !== appOrigin) return json({ error: "AUTH_PROXY_HOST_NOT_ALLOWED" }, 403);
  if (rawPathUnsafe(request.url)) return json({ error: "INVALID_AUTH_PATH" }, 400);

  const suffix = authSuffix(url.pathname);
  if (!suffix) return json({ error: "AUTH_PATH_NOT_ALLOWED" }, 404);
  if (hasForbiddenProxyQuery(url)) return json({ error: "AUTH_PROXY_TARGET_OVERRIDE_DENIED" }, 400);
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const origin = request.headers.get("origin");
  if (origin && origin !== appOrigin) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  if (request.method === "POST" && origin !== appOrigin) return json({ error: "ORIGIN_REQUIRED" }, 403);

  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return json({ error: "AUTH_REQUEST_TOO_LARGE" }, 413);

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return json({ error: "AUTH_REQUEST_TOO_LARGE" }, 413);
  }

  const upstreamUrl = new URL(`${AUTH_UPSTREAM}${suffix}`);
  upstreamUrl.search = url.search;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: forwardedRequestHeaders(request, appOrigin),
      body,
      redirect: "manual",
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: forwardedResponseHeaders(upstream, request),
    });
  } catch {
    return json({ error: "AUTH_UPSTREAM_FAILED" }, 502);
  }
}

export const SAME_ORIGIN_AUTH_PROXY_CONTRACT = Object.freeze({
  prefix: AUTH_PREFIX,
  upstream: AUTH_UPSTREAM,
  methods: ["GET", "POST"] as const,
  maxBodyBytes: MAX_BODY_BYTES,
});
