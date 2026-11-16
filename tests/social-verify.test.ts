import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifySocialConnection, type SocialEnv } from "../api/_lib/social.js";

// Read-only verification of a stored social connection: no publishing endpoint may be called.
const env: SocialEnv = { META_GRAPH_VERSION: "v26.0", GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret" } as SocialEnv;
type Call = { url: string; method: string };
function fakeFetch(handler: (url: URL, init?: RequestInit) => { status: number; body: unknown }) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.origin + url.pathname, method: init?.method ?? "GET" });
    const { status, body } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, calls };
}
const noWrites = (calls: Call[]) => assert.ok(calls.every((c) => c.method === "GET" || c.url === "https://oauth2.googleapis.com/token"), `only reads (plus Google token refresh): ${JSON.stringify(calls)}`);

{
  const { fetcher, calls } = fakeFetch((url) => url.pathname.endsWith("/me/permissions")
    ? { status: 200, body: { data: [{ permission: "instagram_basic", status: "granted" }, { permission: "instagram_manage_insights", status: "granted" }] } }
    : { status: 200, body: { id: "1784", username: "iltuopropertymanager" } });
  const result = await verifySocialConnection({ provider: "INSTAGRAM", provider_account_id: "1784", metadata: { pageId: "55" } }, { accessToken: "page-token" }, env, fetcher);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.accountLabel, "@iltuopropertymanager"); assert.deepEqual(result.permissions, ["instagram_basic", "instagram_manage_insights"]); }
  assert.match(calls[0]!.url, /graph\.facebook\.com\/v26\.0\/1784$/);
  noWrites(calls);
}
{
  const { fetcher } = fakeFetch(() => ({ status: 400, body: { error: { code: 190, message: "Session has expired" } } }));
  const result = await verifySocialConnection({ provider: "FACEBOOK", provider_account_id: "55", metadata: { pageId: "55" } }, { accessToken: "x" }, env, fetcher);
  assert.deepEqual(result, { ok: false, code: "FACEBOOK_VERIFY_TOKEN_INVALID", reconnect: true }, "Meta error 190 means reconnect");
}
{
  const { fetcher } = fakeFetch(() => ({ status: 500, body: {} }));
  const result = await verifySocialConnection({ provider: "FACEBOOK", provider_account_id: "55", metadata: {} }, { accessToken: "x" }, env, fetcher);
  assert.deepEqual(result, { ok: false, code: "FACEBOOK_VERIFY_HTTP_500", reconnect: false }, "a provider outage never downgrades the connection");
}
{
  const { fetcher, calls } = fakeFetch(() => ({ status: 200, body: { sub: "abc", name: "Alessandro Caruso" } }));
  const result = await verifySocialConnection({ provider: "LINKEDIN", provider_account_id: "abc", metadata: {} }, { accessToken: "x" }, env, fetcher);
  assert.equal(result.ok, true);
  assert.equal(calls[0]!.url, "https://api.linkedin.com/v2/userinfo");
  const denied = await verifySocialConnection({ provider: "LINKEDIN", provider_account_id: "abc", metadata: {} }, { accessToken: "x" }, env, fakeFetch(() => ({ status: 401, body: {} })).fetcher);
  assert.deepEqual(denied, { ok: false, code: "LINKEDIN_VERIFY_TOKEN_INVALID", reconnect: true });
}
{
  // Expired Google access token: refresh first, then read the location.
  const { fetcher, calls } = fakeFetch((url) => url.host === "oauth2.googleapis.com"
    ? { status: 200, body: { access_token: "fresh", expires_in: 3600 } }
    : { status: 200, body: { name: "locations/42", title: "Il Tuo Property Manager" } });
  const result = await verifySocialConnection({ provider: "GBP", provider_account_id: "locations/42", metadata: { locationName: "locations/42" } }, { accessToken: "old", refreshToken: "r", expiresAt: "2026-09-28T00:00:00Z" }, env, fetcher);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.bundle.accessToken, "fresh"); assert.equal(result.accountLabel, "Il Tuo Property Manager"); }
  assert.deepEqual(calls.map((c) => c.url), ["https://oauth2.googleapis.com/token", "https://mybusinessbusinessinformation.googleapis.com/v1/locations/42"]);
  noWrites(calls);
  const revoked = await verifySocialConnection({ provider: "GBP", provider_account_id: "locations/42", metadata: {} }, { accessToken: "old", refreshToken: "r", expiresAt: "2026-09-28T00:00:00Z" }, env, fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } })).fetcher);
  assert.deepEqual(revoked, { ok: false, code: "GBP_VERIFY_TOKEN_INVALID", reconnect: true });
  const noRefresh = await verifySocialConnection({ provider: "GBP", provider_account_id: "locations/42", metadata: {} }, { accessToken: "old", expiresAt: "2026-09-28T00:00:00Z" }, env, fakeFetch(() => ({ status: 200, body: {} })).fetcher);
  assert.deepEqual(noRefresh, { ok: false, code: "GBP_VERIFY_TOKEN_INVALID", reconnect: true });
}
{
  const source = readFileSync(new URL("../api/_lib/social.ts", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("async function handleVerify"), source.indexOf("async function handleDisconnect"));
  assert.match(handler, /SOCIAL_TOKEN_KEY_MISMATCH/, "a key mismatch is reported");
  assert.ok(handler.indexOf("SOCIAL_TOKEN_KEY_MISMATCH") < handler.indexOf("update public.social_connections"), "a key mismatch returns before any database write");
  assert.doesNotMatch(handler, /token_reference=null|delete from/, "verification never deletes stored credentials");
  assert.match(source, /if \(path === "\/api\/social\/verify"\) return handleVerify\(request, env\);/);
}
console.log("PASS social verify: verifica solo in lettura, 190/401/invalid_grant → ricollega, guasti del provider non declassano, chiave diversa senza scritture.");
