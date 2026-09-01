import controller from "./audit-viewer-qa-controller.mjs";

const AUTH_UPSTREAM = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const APP_ORIGIN = "https://autoposter.02alessandrocaruso.workers.dev";
const APP_HOST = "autoposter.02alessandrocaruso.workers.dev";
const AUTH_PREFIX = "/api/auth";
const CONTROL_PATH = "/__qa/control";
const PAGE_PATH = "/__qa/auth-feasibility";
const MAX_BODY_BYTES = 64 * 1024;
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
const FORWARDED_FROM_CLIENT = new Set(["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for"]);
const REQUEST_ALLOWLIST = new Set(["accept", "content-type", "cookie", "origin", "referer", "user-agent"]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function html() {
  return new Response("<!doctype html><meta charset=utf-8><title>Auth feasibility</title><main>same-origin auth feasibility</main>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function unsafeRawPath(rawUrl) {
  let rawPath = "";
  try { rawPath = rawUrl.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/, 1)[0] || "/"; } catch { return true; }
  const lowered = rawPath.toLowerCase();
  if (lowered.includes("\\")) return true;
  if (lowered.includes("%2f") || lowered.includes("%5c")) return true;
  let decoded = rawPath;
  for (let i = 0; i < 3; i += 1) {
    try { decoded = decodeURIComponent(decoded); } catch { return true; }
    if (decoded.split("/").some((segment) => segment === ".." || segment === ".")) return true;
    if (!/%[0-9a-f]{2}/i.test(decoded)) break;
  }
  return false;
}

function allowedAuthPath(pathname) {
  if (!pathname.startsWith(`${AUTH_PREFIX}/`)) return null;
  const suffix = pathname.slice(AUTH_PREFIX.length);
  if (!suffix || suffix.includes("//")) return null;
  return suffix;
}

function requestHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || FORWARDED_FROM_CLIENT.has(lower) || !REQUEST_ALLOWLIST.has(lower)) continue;
    headers.append(name, value);
  }
  // The preview verifier simulates the future production Worker boundary. These
  // forwarded values are server-owned constants, never taken from client input.
  headers.set("x-forwarded-host", APP_HOST);
  headers.set("x-forwarded-proto", "https");
  return headers;
}

function responseHeaders(upstream) {
  const headers = new Headers();
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (lower === "set-cookie" || HOP_BY_HOP.has(lower)) continue;
    headers.append(name, value);
  }
  const setCookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  if (upstream.headers.has("set-cookie") && setCookies.length === 0) throw new Error("SET_COOKIE_ENUMERATION_UNAVAILABLE");
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  headers.set("cache-control", "no-store");
  headers.delete("expires");
  return headers;
}

async function proxyAuth(request) {
  if (unsafeRawPath(request.url)) return json({ error: "INVALID_AUTH_PATH" }, 400);
  const url = new URL(request.url);
  const suffix = allowedAuthPath(url.pathname);
  if (!suffix) return json({ error: "AUTH_PATH_NOT_ALLOWED" }, 404);
  if (request.method !== "GET" && request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (request.method === "POST" && request.headers.get("origin") !== APP_ORIGIN) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  const length = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return json({ error: "AUTH_REQUEST_TOO_LARGE" }, 413);

  const upstreamUrl = new URL(`${AUTH_UPSTREAM}${suffix}`);
  upstreamUrl.search = url.search;
  const init = { method: request.method, headers: requestHeaders(request), redirect: "manual" };
  if (request.method === "POST") init.body = request.body;

  try {
    const upstream = await fetch(upstreamUrl, init);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders(upstream) });
  } catch (reason) {
    console.error("auth-feasibility-proxy", { path: url.pathname, category: reason instanceof Error ? reason.message : "UPSTREAM_FAILED" });
    return json({ error: "AUTH_UPSTREAM_FAILED" }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === CONTROL_PATH) return controller.fetch(request, env);
    if (url.pathname === PAGE_PATH && request.method === "GET") return html();
    if (url.pathname.startsWith(AUTH_PREFIX)) return proxyAuth(request);
    return json({ error: "NOT_FOUND" }, 404);
  },
};
