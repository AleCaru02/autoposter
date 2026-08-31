import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePlatformRole, requireSuperAdmin } from "../cloudflare/platform-rbac.js";

const api = readFileSync(new URL("../cloudflare/admin-ban-api.ts", import.meta.url), "utf8");
const entry = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");

const denied = await requireSuperAdmin(new Request("https://example.test/api/admin/customers/customer-a/ban", { method: "POST" }), {});
assert.equal(denied.ok, false, "unauthenticated Ban API must fail closed");
if (!denied.ok) assert.equal(denied.response.status, 401);
assert.equal(normalizePlatformRole("OWNER"), "CUSTOMER", "workspace OWNER must remain denied from Ban/Unban");
assert.equal(normalizePlatformRole("admin"), "SUPER_ADMIN");

const adminRouter = entry.slice(entry.indexOf('if (path.startsWith("/api/admin/"))'));
assert.equal(adminRouter.includes('handleAdminBanApi(request, env)'), true, "Ban/Unban must route through the Worker Admin boundary");
assert.ok(adminRouter.indexOf('handleAdminBanApi(request, env)') < adminRouter.indexOf('handleAdminSessionApi(request, env)'), "Ban router must run before Session/generic Admin handling");
assert.equal(api.includes('path.match(/^\\/api\\/admin\\/customers\\/([^/]+)\\/(ban|unban)$/)'), true, "Ban/Unban route contract missing");
assert.equal(api.includes('request.method !== "POST"'), true, "Ban/Unban must be POST-only");
assert.equal(api.includes("requireSuperAdmin(request, env)"), true, "Ban/Unban must require SUPER_ADMIN");
assert.equal(api.includes("lower(coalesce(nu.role::text, '')) <> 'admin'"), true, "SUPER_ADMIN must never be a Ban/Unban target");
assert.equal(api.includes('return json({ error: "CUSTOMER_NOT_FOUND" }, 404)'), true, "unknown/non-customer targets must fail closed");

assert.equal(api.includes('const allowed = new Set(["reason", "expiresAt"])'), true, "Ban body allowlist must contain only reason/expiresAt");
assert.equal(api.includes("Object.keys(record).some((key) => !allowed.has(key))"), true, "unknown Ban body fields must be rejected");
assert.equal(api.includes("MAX_REASON_LENGTH = 500"), true, "Ban reason length bound missing");
assert.equal(api.includes("MAX_BAN_MS = 366 * 24 * 60 * 60 * 1000"), true, "Ban expiry upper bound missing");
assert.equal(api.includes("/[<>]/.test(normalized)"), true, "Ban reason must reject HTML-like input");
assert.equal(api.includes("parsed <= now"), true, "Ban expiry must be future-dated");
assert.equal(api.includes("INVALID_UNBAN_INPUT"), true, "Unban body must reject arbitrary target/state input");
assert.equal(api.includes('Object.keys(body as Record<string, unknown>).length === 0'), true, "Unban body must be empty when present");

assert.equal(api.includes('set banned = true'), true, "Ban must write native neon_auth.user.banned");
assert.equal(api.includes('"banReason" = ${input.reason}'), true, "Ban must write native banReason");
assert.equal(api.includes('"banExpires" = ${input.expiresAt}::timestamptz'), true, "Ban must write native banExpires");
assert.equal(api.includes('set banned = false, "banReason" = null, "banExpires" = null'), true, "Unban must clear native Better Auth ban state");
assert.equal(api.includes("create table"), false, "Ban/Unban must not create a parallel ban store");

const banWrite = api.indexOf("set banned = true");
const sessionDelete = api.indexOf("delete from neon_auth.session s");
assert.ok(banWrite >= 0 && sessionDelete > banWrite, "Ban must be committed before best-effort session revocation");
assert.equal(api.includes("catch {\n      sessionsRevoked = false;\n    }"), true, "session revoke failure must preserve the already-applied ban");
assert.equal(api.includes("sessionRevocation: { ok: sessionsRevoked, revokedCount }"), true, "partial session revoke state must be reported honestly");
assert.equal(api.includes("sessionsRevoked && auditRecorded ? 200 : 207"), true, "partial Ban completion must not be returned as a false full success");
assert.equal(api.includes("insert into neon_auth.session"), false, "Unban must never create a session");

assert.equal(api.includes('"USER_BANNED"'), true, "USER_BANNED audit event missing");
assert.equal(api.includes('"USER_UNBANNED"'), true, "USER_UNBANNED audit event missing");
assert.equal(api.includes("reason: input.reason"), true, "Ban audit should contain the validated optional reason");
assert.equal(api.includes("expiresAt: input.expiresAt"), true, "Ban audit should contain the validated optional expiry");

const safeResponse = api.slice(api.indexOf("function browserSafeCustomer"), api.indexOf("export async function handleAdminBanApi"));
for (const key of ["id", "banned", "reason", "expiresAt"]) assert.equal(safeResponse.includes(`${key}:`), true, `safe Ban response missing ${key}`);
for (const forbidden of ["token", "cookie", "authorization", "password", "userAgent", "ipAddress", "databaseUrl"]) {
  assert.equal(safeResponse.toLowerCase().includes(forbidden.toLowerCase()), false, `Ban browser response must not expose ${forbidden}`);
}

assert.equal(api.includes('"userId"'), false, "Ban/Unban must not accept an arbitrary auth userId body field");
assert.equal(api.includes('"role"'), false, "Ban/Unban must not accept a role body field");
assert.equal(api.includes('"banned"'), false, "Ban/Unban must not accept a free-form banned body field");

console.log("Admin Ban Unban regression: PASS");
