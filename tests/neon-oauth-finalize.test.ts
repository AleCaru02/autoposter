import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler from "../api/oauth/complete.js";

type Capture = { status: number; headers: Record<string, string | string[]>; body: unknown };
const APP_ORIGIN = "https://post-automatici-canonical.vercel.app";
const UPSTREAM = "https://ep-divine-band-arrkz7vq.neonauth.c-4.us-west-2.aws.neon.tech/neondb/auth/get-session";
const CHALLENGE = "__Secure-neon-auth.session_challenge=challenge-only-test";
const originalFetch = globalThis.fetch;

function harness() {
  const state: Capture = { status: 200, headers: {}, body: null };
  const res = {
    setHeader(name: string, value: string | string[]) { state.headers[name.toLowerCase()] = value; return res; },
    status(value: number) { state.status = value; return res; },
    send(body: unknown) { state.body = body; return res; },
    json(body: unknown) { state.body = body; return res; },
  };
  return { res, state };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: "GET",
    headers: { host: new URL(APP_ORIGIN).host, cookie: CHALLENGE },
    query: { neon_auth_session_verifier: "test-verifier-only" },
    ...overrides,
  };
}

try {
  const authPage = readFileSync(new URL("../src/pages/auth-pages.tsx", import.meta.url), "utf8");
  assert.match(authPage, /callbackURL:\s*\x60\$\{window\.location\.origin\}\/api\/oauth\/complete\x60/);
  const legacy = readFileSync(new URL("../src/components/oauth-return-gate.tsx", import.meta.url), "utf8");
  assert.match(legacy, /new URL\("\/api\/oauth\/complete"/);

  let seenUpstream = "";
  let seenCookie = "";
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    seenUpstream = String(input);
    seenCookie = new Headers(init?.headers).get("cookie") || "";
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "__Secure-neon-auth.session_token=valid-test-cookie; Domain=neonauth.other.invalid; Path=/neondb/auth; HttpOnly; Secure; SameSite=None; Partitioned");
    headers.append("set-cookie", "__Secure-neon-auth.session_challenge=; Path=/neondb/auth; Max-Age=0; HttpOnly; Secure; SameSite=None");
    return new Response(JSON.stringify({ user: { id: "test" }, session: { id: "test" } }), { status: 200, headers });
  }) as typeof fetch;

  {
    const { res, state } = harness();
    await handler(request() as never, res as never);
    assert.equal(state.status, 302);
    assert.equal(state.headers.location, APP_ORIGIN + "/app/dashboard");
    assert.equal(calls, 1);
    assert.equal(seenUpstream, UPSTREAM + "?neon_auth_session_verifier=test-verifier-only");
    assert.equal(seenCookie, CHALLENGE);
    const cookies = state.headers["set-cookie"] as string[];
    assert.equal(cookies.length, 2);
    assert.ok(cookies[0].includes("SameSite=Lax"));
    assert.ok(cookies[0].includes("Path=/"));
    assert.ok(cookies[0].includes("Secure"));
    assert.doesNotMatch(cookies[0], /Domain=|Partitioned/);
    assert.doesNotMatch(state.headers.location as string, /verifier/);
  }

  const noUpstream = async (bad: Record<string, unknown>, expected: string, status = 302) => {
    const count = calls;
    const { res, state } = harness();
    await handler(request(bad) as never, res as never);
    assert.equal(state.status, status);
    if (status === 302) assert.equal(state.headers.location, APP_ORIGIN + "/login?oauth=" + expected);
    assert.equal(calls, count, "invalid callback must not call Neon upstream");
  };

  await noUpstream({ query: { error: "access_denied" } }, "provider_access_denied");
  await noUpstream({ query: { error: "account_not_linked" } }, "provider_account_not_linked");
  await noUpstream({ query: { error: "invalid_code" } }, "provider_invalid_code");
  await noUpstream({ query: { error: "sensitive@example.invalid" } }, "provider_other");
  await noUpstream({ query: {} }, "missing_verifier");
  await noUpstream({ headers: { host: new URL(APP_ORIGIN).host } }, "missing_challenge");
  await noUpstream({ headers: { host: "attacker.invalid", cookie: CHALLENGE } }, "", 403);
  await noUpstream({ method: "POST" }, "", 405);

  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  {
    const { res, state } = harness();
    await handler(request() as never, res as never);
    assert.equal(state.headers.location, APP_ORIGIN + "/login?oauth=exchange_failed");
  }
  console.log("Google OAuth server-side finalization: PASS");
} finally {
  globalThis.fetch = originalFetch;
}
