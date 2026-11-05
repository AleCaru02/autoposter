import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler, { APP_ORIGIN, normalizeNeonAuthCookie } from "../api/auth.js";

const UPSTREAM = "https://ep-divine-band-arrkz7vq.neonauth.c-4.us-west-2.aws.neon.tech/neondb/auth";
const originalFetch = globalThis.fetch;
type Captured = { status: number; headers: Record<string, string | string[]>; body: unknown };
function capture() {
  const data: Captured = { status: 200, headers: {}, body: null };
  const res = {
    setHeader(name: string, value: string | string[]) { data.headers[name.toLowerCase()] = value; return res; },
    status(status: number) { data.status = status; return res; },
    json(body: unknown) { data.body = body; return res; },
    send(body: unknown) { data.body = body; return res; },
  };
  return { data, res };
}
function req(path: string, method = "GET", headers: Record<string,string> = {}, body?: unknown) {
  const [suffix, search] = path.split("?", 2);
  return { method, query: { path: suffix }, url: `/api/auth/${suffix}${search ? "?" + search : ""}`, headers: { host: new URL(APP_ORIGIN).host, ...headers }, body };
}
async function run() {
 try {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { rewrites: Array<{ source: string; destination: string }> };
  assert.ok(vercel.rewrites.some(r => r.source === "/api/auth/:path*" && r.destination === "/api/auth?path=:path*"));

  let upstreamUrl = "";
  let upstreamHeaders: Headers | undefined;
  globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    upstreamUrl = String(u); upstreamHeaders = new Headers(init?.headers);
    return Response.json({ session: null }, { status: 200 });
  }) as typeof fetch;
  {
    const { data, res } = capture();
    await handler(req("get-session?disableCookieCache=true") as never, res as never);
    assert.equal(data.status, 200);
    assert.equal(upstreamUrl, UPSTREAM + "/get-session?disableCookieCache=true");
    assert.equal(data.headers["cache-control"], "no-store");
  }
  {
    globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      upstreamHeaders = new Headers(init?.headers);
      assert.equal(init?.method, "POST");
      return Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=test" });
    }) as typeof fetch;
    const { data, res } = capture();
    await handler(req("sign-in/social", "POST", { origin: APP_ORIGIN, "content-type": "application/json", "x-forwarded-host": "attacker.invalid" }, { provider: "google", callbackURL: APP_ORIGIN + "/app/dashboard" }) as never, res as never);
    assert.equal(data.status, 200);
    assert.equal(upstreamHeaders?.get("origin"), APP_ORIGIN);
    assert.equal(upstreamHeaders?.has("x-forwarded-host"), false);
    assert.match(Buffer.isBuffer(data.body) ? data.body.toString("utf8") : "", /accounts\.google\.com/);
  }
  {
    globalThis.fetch = (async () => {
      const headers = new Headers({ location: UPSTREAM + "/callback/google?state=opaque" });
      headers.append("set-cookie", "__Secure-neon-auth.session_token=a; Path=/; HttpOnly; Secure; SameSite=Lax");
      headers.append("set-cookie", "__Host-neon-auth.marker=b; Path=/; HttpOnly; Secure; SameSite=Lax");
      return new Response(null, { status: 302, headers });
    }) as typeof fetch;
    const { data, res } = capture();
    await handler(req("callback/google?state=opaque") as never, res as never);
    assert.equal(data.status, 302);
    assert.equal(data.headers.location, APP_ORIGIN + "/api/auth/callback/google?state=opaque");
    assert.equal((data.headers["set-cookie"] as string[]).length, 2);
  }
  {
    const raw = "__Secure-neon-auth.session_challenge=opaque; Path=/neondb/auth; Domain=ep-divine-band-arrkz7vq.neonauth.c-4.us-west-2.aws.neon.tech; HttpOnly; SameSite=None; Secure; Partitioned";
    const normalized = normalizeNeonAuthCookie(raw);
    assert.match(normalized, /Path=\//);
    assert.match(normalized, /SameSite=Lax/);
    assert.match(normalized, /Secure/);
    assert.match(normalized, /HttpOnly/);
    assert.doesNotMatch(normalized, /Domain=/i);
    assert.doesNotMatch(normalized, /Partitioned/i);
    assert.doesNotMatch(normalized, /SameSite=None/i);
  }
  {
    let forwardedCookie = "";
    globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      forwardedCookie = new Headers(init?.headers).get("cookie") || "";
      const headers = new Headers({"content-type":"application/json"});
      headers.append("set-cookie", "__Secure-neon-auth.session_token=opaque-session; Domain=neonauth.example; Path=/neondb/auth; HttpOnly; Secure; SameSite=None; Partitioned");
      return new Response(JSON.stringify({session:{id:"session-id"},user:{id:"user-id"}}), {status:200,headers});
    }) as typeof fetch;
    const { data, res } = capture();
    await handler(req("get-session?neon_auth_session_verifier=short-test", "GET", { cookie: "__Secure-neon-auth.session_challenge=challenge" }) as never, res as never);
    assert.equal(data.status, 200);
    assert.equal(forwardedCookie, "__Secure-neon-auth.session_challenge=challenge");
    const cookie = (data.headers["set-cookie"] as string[])[0];
    assert.match(cookie, /session_token/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=|Partitioned/);
  }
  {
    let called = false;
    globalThis.fetch = (async () => { called = true; throw new Error("unexpected"); }) as typeof fetch;
    for (const invalid of [req("sign-in/social", "POST", {origin: "https://evil.invalid"}), req("get-session", "GET", {host: "evil.invalid"}), req("../admin/list-users"), req("get-session%2fadmin")]) {
      const { data, res } = capture();
      await handler(invalid as never, res as never);
      assert.ok(data.status >= 400 && data.status < 500);
    }
    assert.equal(called, false);
  }
  console.log("Vercel same-origin Google Auth route: PASS");
 } finally { globalThis.fetch = originalFetch; }
}
await run();
