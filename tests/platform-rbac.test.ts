import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bearerToken, normalizePlatformRole, requireAuthenticatedUser, requireSuperAdmin } from "../cloudflare/platform-rbac.js";

const entry = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
const adminApi = readFileSync(new URL("../cloudflare/admin-api.ts", import.meta.url), "utf8");
const rbacSource = readFileSync(new URL("../cloudflare/platform-rbac.ts", import.meta.url), "utf8");
const adminClientSource = readFileSync(new URL("../src/lib/admin-api.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../src/pages/admin-pages.tsx", import.meta.url), "utf8");
const ownerMigration = readFileSync(new URL("../db/migrations/20260830_profile_owner_membership_contract.sql", import.meta.url), "utf8");
const adminAuditMigration = readFileSync(new URL("../db/migrations/20260830_platform_admin_audit.sql", import.meta.url), "utf8");

assert.equal(normalizePlatformRole("admin"), "SUPER_ADMIN");
assert.equal(normalizePlatformRole("ADMIN"), "SUPER_ADMIN");
assert.equal(normalizePlatformRole("user"), "CUSTOMER");
assert.equal(normalizePlatformRole("OWNER"), "CUSTOMER", "workspace OWNER must never imply global SUPER_ADMIN");
assert.equal(normalizePlatformRole(null), "CUSTOMER");

const noAuth = new Request("https://example.test/api/admin/me");
assert.equal(bearerToken(noAuth), null);
const fakeBearer = new Request("https://example.test/api/admin/me", { headers: { authorization: "Bearer browser-supplied-role-does-not-matter" } });
assert.equal(bearerToken(fakeBearer), "browser-supplied-role-does-not-matter");
const unauthenticated = await requireAuthenticatedUser(noAuth, {});
assert.equal(unauthenticated.ok, false);
if (!unauthenticated.ok) assert.equal(unauthenticated.response.status, 401);
const unauthorizedAdmin = await requireSuperAdmin(noAuth, {});
assert.equal(unauthorizedAdmin.ok, false);
if (!unauthorizedAdmin.ok) assert.equal(unauthorizedAdmin.response.status, 401);

assert.equal(rbacSource.includes("/rpc/current_auth_user_id"), true, "platform identity must be verified by the same Neon Data API boundary used by customer RLS");
assert.equal(rbacSource.includes("authToken: token"), false, "platform RBAC must not assume the normal SQL endpoint validates the Data API JWT");
assert.equal(rbacSource.includes("JSON.parse(Buffer") || rbacSource.includes("atob("), false, "Worker must not authorize by merely decoding unverified JWT claims");
assert.equal(rbacSource.indexOf("verifiedAuthUserId(token)") < rbacSource.indexOf("from neon_auth.user"), true, "verified identity must be established before privileged role lookup");
assert.equal(entry.includes('path.startsWith("/api/admin/")'), true, "all platform admin API routes must enter the central admin handler");
assert.equal(adminApi.includes("requireSuperAdmin(request, env)"), true, "admin handler must authorize through central requireSuperAdmin");
assert.equal(adminApi.indexOf("requireSuperAdmin(request, env)") < adminApi.indexOf('if (path === "/api/admin/me")'), true, "authorization must happen before every admin endpoint branch");
assert.equal(adminApi.includes("request.json("), false, "read-only FASE 3 admin APIs must not accept a browser-supplied role/body");
assert.equal(adminApi.includes("profile_members") && adminApi.includes("platform_role"), true, "admin detail may report workspace membership but platform role remains separate");
assert.equal(adminClientSource.includes("authClient.token()"), true, "Admin UI must request the Managed Auth JWT using the documented token() API");
assert.equal(adminClientSource.includes("getJWTToken"), false, "Admin UI must not rely on a nonexistent optional getJWTToken bridge");
assert.equal(adminClientSource.includes('authorization: `Bearer ${token}`'), true, "Admin UI must forward the verified Managed Auth JWT as a Bearer token to the Worker");
assert.equal(adminClientSource.includes("localStorage") || adminClientSource.includes("sessionStorage"), false, "Admin API client must not derive authorization from browser storage");
assert.equal(ownerMigration.includes("profile_members_owner_read"), true, "workspace OWNER membership must remain customer read-only");
assert.equal(ownerMigration.includes("FOR SELECT"), true, "workspace membership policy must not become a role-escalation write path");
assert.equal(adminAuditMigration.includes("REVOKE ALL ON TABLE public.platform_admin_audit FROM authenticated"), true, "customers must not be able to write global admin audit data");
assert.equal(app.includes('path="/admin/*"'), true, "admin UI must have a dedicated route");
assert.equal(adminUi.includes('adminRequest<AdminMe>("/api/admin/me")'), true, "admin UI gate must verify server authorization");
assert.equal(adminUi.includes("localStorage") || adminUi.includes("sessionStorage"), false, "admin authorization must not be stored in browser storage");
assert.equal(adminUi.includes("SUPER_ADMIN") && adminUi.includes("OWNER"), false, "admin UI must not derive platform admin from workspace OWNER");

console.log("platform RBAC regression: PASS");
