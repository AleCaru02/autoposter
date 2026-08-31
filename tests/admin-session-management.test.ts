import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePlatformRole, requireSuperAdmin } from "../cloudflare/platform-rbac.js";

const api = readFileSync(new URL("../cloudflare/admin-session-api.ts", import.meta.url), "utf8");
const entry = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");

const denied = await requireSuperAdmin(new Request("https://example.test/api/admin/customers/customer-a/sessions"), {});
assert.equal(denied.ok, false, "unauthenticated Session Management API must fail closed");
if (!denied.ok) assert.equal(denied.response.status, 401);
assert.equal(normalizePlatformRole("OWNER"), "CUSTOMER", "workspace OWNER must remain denied from Session Management");
assert.equal(normalizePlatformRole("admin"), "SUPER_ADMIN");

assert.equal(entry.includes('handleAdminSessionApi(request, env)'), true, "Session Management must route through the Worker Admin boundary");
assert.equal(api.includes("requireSuperAdmin(request, env)"), true, "every Session Management operation must require SUPER_ADMIN");
assert.equal(api.includes('/^\\/api\\/admin\\/customers\\/([^/]+)\\/sessions$/'), true, "session collection route missing");
assert.equal(api.includes('/^\\/api\\/admin\\/customers\\/([^/]+)\\/sessions\\/([^/]+)$/'), true, "single session route missing");
assert.equal(api.includes('request.method !== "GET" && request.method !== "DELETE"'), true, "collection route must allow only GET/DELETE");
assert.equal(api.includes('singleMatch && request.method !== "DELETE"'), true, "single route must allow only DELETE");

assert.equal(api.includes("lower(coalesce(nu.role::text, '')) <> 'admin'"), true, "SUPER_ADMIN must not be a revocation target");
assert.equal(api.includes('return json({ error: "CUSTOMER_NOT_FOUND" }, 404)'), true, "unknown/non-customer targets must return 404");
assert.equal(api.includes("where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') = ${targetAuthUserId}"), true, "session list must be target-user scoped server-side");

const safeSession = api.slice(api.indexOf("function browserSafeSession"), api.indexOf("async function audit"));
for (const key of ["id", "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent"]) {
  assert.equal(safeSession.includes(`${key}:`), true, `browser-safe session allowlist missing ${key}`);
}
for (const forbidden of ["token", "userId", "impersonatedBy", "activeOrganizationId", "cookie", "jwt", "authorization"]) {
  assert.equal(safeSession.toLowerCase().includes(forbidden.toLowerCase()), false, `browser-safe session response must not expose ${forbidden}`);
}
assert.equal(api.includes("to_jsonb(s)->>'token'"), false, "Session API must never select the authenticating session token");

const singleDelete = api.slice(api.indexOf("delete from neon_auth.session s"), api.indexOf("returning coalesce(to_jsonb(s)->>'id', '') as id") + 60);
assert.equal(singleDelete.includes("${sessionId}"), true, "single revoke must target the requested non-secret session id");
assert.equal(singleDelete.includes("${customerAuthUserId}"), true, "single revoke must bind the customer identity in the same DELETE");
assert.equal(api.includes('return json({ error: "SESSION_NOT_FOUND" }, 404)'), true, "cross-customer/unknown session ids must fail closed as 404");

const allDeleteStart = api.lastIndexOf("delete from neon_auth.session s");
const allDelete = api.slice(allDeleteStart, api.indexOf("returning coalesce(to_jsonb(s)->>'id', '') as id", allDeleteStart) + 60);
assert.equal(allDelete.includes("${customerAuthUserId}"), true, "revoke-all must be one customer-targeted DELETE statement");
assert.equal(allDelete.includes("sessionId"), false, "revoke-all must not broaden via a client session selector");

assert.equal(api.includes('"USER_SESSION_REVOKED"'), true, "single revoke audit event missing");
assert.equal(api.includes('"USER_SESSIONS_REVOKED"'), true, "revoke-all audit event missing");
assert.equal(api.includes("sessionRef: sessionId"), true, "single revoke audit must use only the non-secret session reference");
assert.equal(api.includes("revokedCount: deleted.length"), true, "revoke-all audit should record only minimal count metadata");
assert.equal(api.includes("DATABASE_URL") && api.includes("neon_auth.session"), true, "fallback must operate server-side on the Managed Auth source of truth");
assert.equal(api.includes("create table"), false, "Session Management must not create a parallel session store");
assert.equal(api.includes("request.json()"), false, "Session Management target identity must come from the Admin route, not a client-supplied auth userId body");

console.log("Admin session management regression: PASS");
