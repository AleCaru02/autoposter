import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { socialVerifiable, verifySocialConnection, type SocialEnv } from "../api/_lib/social.js";

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
  if (result.ok) {
    assert.equal(result.accountLabel, "@iltuopropertymanager");
    assert.deepEqual(result.permissions, ["instagram_basic", "instagram_manage_insights"]);
    assert.deepEqual(Object.keys(result.checks).sort(), ["accountMetrics", "insights", "posts"], "Instagram probes posts, account metrics and insights (read-only)");
  }
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
  assert.deepEqual(calls.slice(0, 2).map((c) => c.url), ["https://oauth2.googleapis.com/token", "https://mybusinessbusinessinformation.googleapis.com/v1/locations/42"]);
  assert.match(calls[2]!.url, /businessprofileperformance\.googleapis\.com\/v1\/locations\/42:fetchMultiDailyMetricsTimeSeries$/, "GBP metrics probe is a read");
  if (result.ok) { assert.equal(result.checks.posts, "NOT_AVAILABLE", "no account id: Local Post listing is not probed"); assert.equal(result.checks.accountMetrics, "OK"); assert.equal(result.token.refreshable, true); }
  noWrites(calls);
  const revoked = await verifySocialConnection({ provider: "GBP", provider_account_id: "locations/42", metadata: {} }, { accessToken: "old", refreshToken: "r", expiresAt: "2026-09-28T00:00:00Z" }, env, fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } })).fetcher);
  assert.deepEqual(revoked, { ok: false, code: "GBP_VERIFY_TOKEN_INVALID", reconnect: true });
  const noClient = await verifySocialConnection({ provider: "GBP", provider_account_id: "locations/42", metadata: {} }, { accessToken: "old", refreshToken: "r", expiresAt: "2026-09-28T00:00:00Z" }, {} as SocialEnv, fakeFetch(() => ({ status: 401, body: { error: "invalid_client" } })).fetcher);
  assert.deepEqual(noClient, { ok: false, code: "GBP_VERIFY_CLIENT_NOT_CONFIGURED", reconnect: false }, "missing server OAuth client never downgrades the user grant");
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
assert.equal(socialVerifiable({ DATABASE_URL: "postgres://x", SOCIAL_TOKEN_KEY: "k".repeat(32) } as SocialEnv), true, "verification needs only DB + token key");
assert.equal(socialVerifiable({ DATABASE_URL: "postgres://x", SOCIAL_TOKEN_KEY: "short" } as SocialEnv), false);
{
  const { linkedinGrantedPermissions } = await import("../api/_lib/social.js");
  assert.deepEqual(linkedinGrantedPermissions("openid,profile,w_member_social", []), ["openid", "profile", "w_member_social"], "LinkedIn returns comma-separated scopes");
  assert.deepEqual(linkedinGrantedPermissions("openid profile", []), ["openid", "profile"]);
}
{
  const { fetcher, calls } = fakeFetch((url) => url.pathname.endsWith("/debug_token")
    ? { status: 200, body: { data: { is_valid: true, expires_at: 0, data_access_expires_at: 1800000000 } } }
    : url.pathname.endsWith("/me/permissions") ? { status: 200, body: { data: [] } }
    : url.pathname.endsWith("/published_posts") ? { status: 403, body: { error: { code: 10 } } }
    : { status: 200, body: { id: "55", name: "Pagina" } });
  const result = await verifySocialConnection({ provider: "FACEBOOK", provider_account_id: "55", metadata: { pageId: "55" } }, { accessToken: "x" }, { ...env, META_APP_ID: "1", META_APP_SECRET: "s" } as SocialEnv, fetcher);
  assert.equal(result.ok, true, "a failing capability probe never fails the base verification");
  if (result.ok) { assert.equal(result.checks.posts, "HTTP_403"); assert.equal(result.checks.tokenDebug, "OK"); assert.equal(result.token.expiresAt, null); assert.equal(result.token.dataAccessExpiresAt, new Date(1800000000 * 1000).toISOString()); }
  noWrites(calls);
}
{
  const migration = readFileSync(new URL("../db/migrations/20261118_social_connections_server_owned.sql", import.meta.url), "utf8");
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE[^;]*ON public\.social_connections FROM authenticated/, "browsers cannot forge connection rows");
  assert.match(migration, /REVOKE SELECT ON public\.social_connections FROM authenticated/);
  const grant = migration.match(/GRANT SELECT \(([^)]+)\)\s+ON public\.social_connections TO authenticated/);
  assert.ok(grant, "column-level read grant");
  assert.doesNotMatch(grant![1]!, /token_reference/, "encrypted tokens are never readable from the browser");
  const page = readFileSync(new URL("../src/pages/social-page.tsx", import.meta.url), "utf8");
  const select = page.match(/from\("social_connections"\)\s*\.select\("([^"]+)"\)/);
  assert.ok(select && select[1]!.split(",").every((column) => grant![1]!.includes(column.trim())), "the social page only reads granted columns");
}
{
  const limited = await verifySocialConnection({ provider: "INSTAGRAM", provider_account_id: "1784", metadata: {} }, { accessToken: "x" }, env, fakeFetch(() => ({ status: 429, body: { error: { code: 4 } } })).fetcher);
  assert.deepEqual(limited, { ok: false, code: "INSTAGRAM_VERIFY_HTTP_429", reconnect: false }, "rate limits never downgrade a connection");
  const forbidden = await verifySocialConnection({ provider: "GBP", provider_account_id: "locations/42", metadata: {} }, { accessToken: "a", expiresAt: "2099-01-01T00:00:00Z" }, env, fakeFetch(() => ({ status: 403, body: {} })).fetcher);
  assert.deepEqual(forbidden, { ok: false, code: "GBP_VERIFY_TOKEN_INVALID", reconnect: true }, "403 from the provider requires reconnecting");
}
console.log("PASS social verify: verifica solo in lettura, 190/401/invalid_grant → ricollega, guasti del provider non declassano, chiave diversa senza scritture.");
