import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePlatformRole } from "../cloudflare/platform-rbac.js";

const api = readFileSync(new URL("../cloudflare/admin-impersonation-api.ts", import.meta.url), "utf8");
const entry = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");

assert.equal(normalizePlatformRole("OWNER"), "CUSTOMER", "workspace OWNER must remain a CUSTOMER at the platform boundary");
assert.equal(normalizePlatformRole("admin"), "SUPER_ADMIN");

assert.equal(api.includes('path.match(/^\\/api\\/admin\\/customers\\/([^/]+)\\/impersonate$/)'), true, "start route contract missing");
assert.equal(api.includes('path === "/api/admin/impersonation/stop"'), true, "stop route contract missing");
assert.equal(api.includes('request.method !== "POST"'), true, "impersonation mutations must be POST-only");
assert.equal(api.includes("sameOriginMutation(request, env)"), true, "impersonation mutations must enforce same-origin browser context");
assert.equal(api.includes('return json({ error: "ORIGIN_NOT_ALLOWED" }, 403)'), true, "foreign/missing Origin must fail closed");
assert.equal(api.includes("validEmptyBody(request)"), true, "impersonation API must reject client-supplied target/session state");
assert.equal(api.includes('Object.keys(body as Record<string, unknown>).length === 0'), true, "impersonation request body must be empty when present");

const startBlock = api.slice(api.indexOf("if (startMatch)"), api.indexOf("const currentSessionCall"));
assert.equal(startBlock.includes("requireSuperAdmin(request, env)"), true, "only SUPER_ADMIN may start impersonation");
assert.equal(startBlock.includes('return json({ error: "SELF_IMPERSONATION_DENIED" }, 400)'), true, "self-target must be denied");
assert.equal(startBlock.includes('return json({ error: "CUSTOMER_NOT_FOUND" }, 404)'), true, "missing target must be denied");
assert.equal(startBlock.includes('return json({ error: "ADMIN_TARGET_DENIED" }, 400)'), true, "Admin target must be denied");
assert.equal(startBlock.includes('return json({ error: "BANNED_TARGET_DENIED" }, 409)'), true, "banned target must be denied");
assert.equal(startBlock.includes('return json({ error: "NESTED_IMPERSONATION_DENIED" }, 409)'), true, "nested impersonation must be denied");
assert.equal(startBlock.includes('before.userId !== auth.user.authUserId'), true, "Bearer actor and Better Auth session actor must match");
assert.equal(startBlock.includes('before.role !== "admin"'), true, "native session must still be Admin before start");
assert.equal(startBlock.includes('"/admin/impersonate-user", { userId: targetAuthUserId }'), true, "native provider start must use the path-resolved target only");
assert.equal(startBlock.includes("after.userId !== targetAuthUserId"), true, "start postcondition must verify exact target identity");
assert.equal(startBlock.includes("after.impersonatedBy !== auth.user.authUserId"), true, "start postcondition must verify native impersonatedBy actor");
assert.equal(startBlock.includes("rollbackStart(impersonatedCookie, env)"), true, "failed start postcondition must attempt native rollback before returning failure");

const stopBlock = api.slice(api.indexOf("const currentSessionCall"));
assert.equal(stopBlock.includes("current.impersonatedBy"), true, "stop authorization must derive actor from native session.impersonatedBy");
assert.equal(stopBlock.includes("resolveNativeUser(sql, current.impersonatedBy)"), true, "stop must resolve the original actor server-side");
assert.equal(stopBlock.includes('return json({ error: "NOT_IMPERSONATING" }, 403)'), true, "normal CUSTOMER stop must be denied");
assert.equal(stopBlock.includes('"/admin/stop-impersonating", {}'), true, "stop must call native provider stop");
assert.equal(stopBlock.includes("restored.userId !== actor!.auth_user_id"), true, "stop postcondition must verify Admin restoration");
assert.equal(stopBlock.includes("restored.impersonatedBy"), true, "stop postcondition must verify impersonation marker is cleared");
assert.equal(stopBlock.includes("requireSuperAdmin(request, env)"), false, "stop must not authorize using the impersonated CUSTOMER Bearer role");

assert.equal(api.includes('"IMPERSONATION_STARTED"'), true, "IMPERSONATION_STARTED audit event missing");
assert.equal(api.includes('"IMPERSONATION_ENDED"'), true, "IMPERSONATION_ENDED audit event missing");
assert.equal(api.includes("actor_auth_user_id, action, target_type, target_id, metadata"), true, "audit must persist actor/target/minimal metadata");
assert.equal(api.includes('provider: "NEON_MANAGED_AUTH"'), true, "audit must identify native provider source without credentials");
assert.equal(api.includes("sessionBound: true"), true, "audit should record session-bound execution without session identifiers");

assert.equal(api.includes("SAME_ORIGIN_AUTH_PROXY_CONTRACT.upstream"), true, "product API must reuse the fixed Managed Auth upstream boundary");
assert.equal(api.includes("create table"), false, "impersonation must not create a parallel state store");
assert.equal(api.includes("insert into neon_auth.session"), false, "impersonation must not create custom sessions");
assert.equal(api.includes("localStorage"), false, "impersonation state must not be client storage based");
assert.equal(api.includes("jwt.decode"), false, "impersonation must not decode JWT claims as authority");
assert.equal(api.includes("atob("), false, "impersonation must not decode JWT payloads as authority");
assert.equal(api.includes("reason instanceof Error ? reason.message"), false, "provider/internal exception messages must not be logged");
assert.equal(api.includes("started.body"), false, "raw native start payload must never be returned");
assert.equal(api.includes("stopped.body"), false, "raw native stop payload must never be returned");

const safeIdentity = api.slice(api.indexOf("function safeIdentity"), api.indexOf("async function rollbackStart"));
for (const key of ["id", "email", "name"]) assert.equal(safeIdentity.includes(`${key}:`), true, `browser-safe target identity missing ${key}`);
for (const forbidden of ["token", "cookie", "authorization", "password", "sessionId", "userAgent", "ipAddress"]) {
  assert.equal(safeIdentity.toLowerCase().includes(forbidden.toLowerCase()), false, `browser-safe target identity must not expose ${forbidden}`);
}

const adminRouter = entry.slice(entry.indexOf('if (path.startsWith("/api/admin/"))'));
assert.equal(adminRouter.includes("handleAdminImpersonationApi(request, env)"), true, "Impersonation API must route through Admin Worker boundary");
assert.ok(adminRouter.indexOf("handleAdminImpersonationApi(request, env)") < adminRouter.indexOf("handleAdminBanApi(request, env)"), "Impersonation router must run before Ban/Session/generic Admin handlers");
assert.ok(adminRouter.indexOf("handleAdminImpersonationApi(request, env)") < adminRouter.indexOf("handleAdminApi(request, env)"), "generic GET-only Admin API must not intercept impersonation mutations");

console.log("Admin impersonation API regression: PASS");
