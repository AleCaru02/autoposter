import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AUXILIARY_PROFILE_TABLES, TENANT_TABLES, classifyAnonymousProbe, evaluateAuxiliaryProfileIsolation, evaluateOwnerContract, evaluateTenantSecurity } from "../cloudflare/tenant-security.js";

const forceTenantMigration = await readFile("db/migrations/20260929_force_tenant_rls.sql", "utf8");
assert.match(forceTenantMigration, /^--[\s\S]*\nBEGIN;/, "tenant FORCE RLS migration must be transactional");
assert.match(forceTenantMigration, /COMMIT;\s*$/, "tenant FORCE RLS migration must commit");
assert.doesNotMatch(forceTenantMigration, /\b(?:DROP|DELETE|TRUNCATE|GRANT|REVOKE|CREATE POLICY|ALTER POLICY)\b/i, "tenant FORCE RLS migration must not weaken policy or privilege contracts");
for (const table of TENANT_TABLES) {
  assert.match(forceTenantMigration, new RegExp(`'${table}'`), `${table} must be included in the forced tenant boundary`);
}
for (const { table_name } of AUXILIARY_PROFILE_TABLES) {
  assert.doesNotMatch(forceTenantMigration, new RegExp(`'${table_name}'`), `${table_name} must remain outside the tenant FORCE RLS migration`);
}

const safeRows = TENANT_TABLES.map((table_name) => ({
  table_name,
  table_exists: true,
  rls_enabled: true,
  force_rls: true,
  policy_count: 2,
  open_policy_count: 0,
  auth_barrier_count: 1,
  anonymous_can_select: false,
  anonymous_can_insert: false,
  anonymous_can_update: false,
  anonymous_can_delete: false,
}));

const blockedStatus = classifyAnonymousProbe(401, false, { code: "42501", message: "permission denied" });
assert.equal(blockedStatus.blocked, true);
assert.equal(blockedStatus.outcome, "BLOCKED_STATUS");
assert.equal(blockedStatus.errorCode, "42501");

const emptyRows = classifyAnonymousProbe(200, true, []);
assert.equal(emptyRows.blocked, true);
assert.equal(emptyRows.outcome, "EMPTY_ROWS");
assert.equal(emptyRows.rowCount, 0);

const errorObject = classifyAnonymousProbe(200, true, { code: "42501", message: "permission denied" });
assert.equal(errorObject.blocked, true, "a structured Data API error contains no tenant rows and must count as blocked");
assert.equal(errorObject.outcome, "ERROR_OBJECT");

const visibleRows = classifyAnonymousProbe(200, true, [{ id: "redacted" }]);
assert.equal(visibleRows.blocked, false);
assert.equal(visibleRows.outcome, "ROWS_VISIBLE");
assert.equal(visibleRows.rowCount, 1);

const unexpected = classifyAnonymousProbe(200, true, { ok: true });
assert.equal(unexpected.blocked, false, "an unknown success payload must fail closed until understood");
assert.equal(unexpected.outcome, "UNEXPECTED");

const safe = evaluateTenantSecurity(safeRows, emptyRows);
assert.equal(safe.ready, true, "all tenant tables with RLS, restrictive auth barrier, no anonymous privileges and blocked anonymous reads must pass");
assert.equal(safe.expectedTables, TENANT_TABLES.length);
assert.equal(safe.authBarrierTables, TENANT_TABLES.length);
assert.equal(safe.forceRlsTables, TENANT_TABLES.length);
assert.equal(safe.openPolicies, 0);
assert.equal(safe.anonymousPrivilegedTables, 0);

const ownerSafe = evaluateOwnerContract({
  profiles_total: 20,
  profiles_with_owner: 20,
  profiles_without_owner: 0,
  profiles_with_multiple_owners: 0,
  profiles_auth_identity_unresolved: 0,
  profiles_owner_user_id_mismatch: 0,
});
assert.equal(ownerSafe.ready, true, "all profiles must have exactly one valid server-linked OWNER");
assert.equal(ownerSafe.profilesTotal, 20);
assert.equal(ownerSafe.profilesWithOwner, 20);
assert.equal(evaluateOwnerContract({ ...{
  profiles_total: 20,
  profiles_with_owner: 19,
  profiles_without_owner: 1,
  profiles_with_multiple_owners: 0,
  profiles_auth_identity_unresolved: 0,
  profiles_owner_user_id_mismatch: 0,
} }).ready, false, "one missing OWNER must fail closed");
assert.equal(evaluateOwnerContract({
  profiles_total: 20,
  profiles_with_owner: 20,
  profiles_without_owner: 0,
  profiles_with_multiple_owners: 0,
  profiles_auth_identity_unresolved: 0,
  profiles_owner_user_id_mismatch: 1,
}).ready, false, "one owner mapping mismatch must fail closed");

const missingRls = safeRows.map((row, index) => index === 0 ? { ...row, rls_enabled: false } : row);
assert.equal(evaluateTenantSecurity(missingRls, emptyRows).ready, false, "a tenant table without RLS must fail closed");
const missingForceRls = safeRows.map((row, index) => index === 0 ? { ...row, force_rls: false } : row);
assert.equal(evaluateTenantSecurity(missingForceRls, emptyRows).ready, false, "a tenant table without forced RLS must fail closed");

const missingBarrier = safeRows.map((row, index) => index === 1 ? { ...row, auth_barrier_count: 0 } : row);
assert.equal(evaluateTenantSecurity(missingBarrier, emptyRows).ready, false, "a tenant table without the restrictive authenticated identity barrier must fail closed");

const openPolicy = safeRows.map((row, index) => index === 2 ? { ...row, open_policy_count: 1 } : row);
assert.equal(evaluateTenantSecurity(openPolicy, emptyRows).ready, false, "an unconditional tenant policy must fail closed");

const anonymousPrivilege = safeRows.map((row, index) => index === 3 ? { ...row, anonymous_can_select: true } : row);
const privilegeFailure = evaluateTenantSecurity(anonymousPrivilege, emptyRows);
assert.equal(privilegeFailure.ready, false, "any anonymous tenant-table CRUD privilege must fail closed");
assert.equal(privilegeFailure.anonymousPrivilegedTables, 1);

assert.equal(evaluateTenantSecurity(safeRows, visibleRows).ready, false, "actual anonymous profile rows must fail closed");
assert.equal(evaluateTenantSecurity(safeRows, unexpected).ready, false, "unexpected anonymous success payloads must fail closed");

const safeAuxiliary = AUXILIARY_PROFILE_TABLES.map(({ table_name, access_mode }) => ({
  table_name,
  access_mode,
  table_exists: true,
  rls_enabled: true,
  force_rls: true,
  policy_count: access_mode === "CUSTOMER_READ" ? 1 : 0,
  open_policy_count: 0,
  owns_profile_policy_count: access_mode === "CUSTOMER_READ" ? 1 : 0,
  authenticated_can_select: access_mode === "CUSTOMER_READ",
  authenticated_can_insert: false,
  authenticated_can_update: false,
  authenticated_can_delete: false,
  anonymous_can_select: false,
  anonymous_can_insert: false,
  anonymous_can_update: false,
  anonymous_can_delete: false,
}));
const auxiliary = evaluateAuxiliaryProfileIsolation(safeAuxiliary);
assert.equal(auxiliary.ready, true, "all auxiliary profile-scoped tables must satisfy their customer-read or server-owned contract");
assert.equal(auxiliary.expectedTables, AUXILIARY_PROFILE_TABLES.length);
assert.equal(auxiliary.forceRlsTables, AUXILIARY_PROFILE_TABLES.length);
assert.equal(auxiliary.customerReadTables, 4);
assert.equal(auxiliary.serverOwnedTables, 6);

const auxForeignRead = safeAuxiliary.map((row) => row.access_mode === "SERVER_OWNED" && row.table_name === "social_oauth_callbacks"
  ? { ...row, authenticated_can_select: true }
  : row);
assert.equal(evaluateAuxiliaryProfileIsolation(auxForeignRead).ready, false, "server-owned OAuth callback state must never become customer-readable");

const auxMissingOwnerPolicy = safeAuxiliary.map((row) => row.table_name === "profile_entitlements"
  ? { ...row, owns_profile_policy_count: 0 }
  : row);
assert.equal(evaluateAuxiliaryProfileIsolation(auxMissingOwnerPolicy).ready, false, "customer-readable auxiliary data must remain owns_profile scoped");

const auxCustomerWrite = safeAuxiliary.map((row) => row.table_name === "activity_ai_budget_policies"
  ? { ...row, authenticated_can_update: true }
  : row);
assert.equal(evaluateAuxiliaryProfileIsolation(auxCustomerWrite).ready, false, "customer-readable isolation ledgers must not become directly writable");

console.log("tenant security: PASS");
