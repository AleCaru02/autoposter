import assert from "node:assert/strict";
import { TENANT_TABLES, evaluateTenantSecurity } from "../cloudflare/tenant-security.js";

const safeRows = TENANT_TABLES.map((table_name) => ({
  table_name,
  table_exists: true,
  rls_enabled: true,
  force_rls: false,
  policy_count: 1,
  open_policy_count: 0,
  anonymous_can_select: false,
  anonymous_can_insert: false,
  anonymous_can_update: false,
  anonymous_can_delete: false,
}));

const safe = evaluateTenantSecurity(safeRows, true);
assert.equal(safe.ready, true, "all tenant tables with RLS, policies, no anonymous privileges and blocked anonymous reads must pass");
assert.equal(safe.expectedTables, TENANT_TABLES.length);
assert.equal(safe.openPolicies, 0);
assert.equal(safe.anonymousPrivilegedTables, 0);

const missingRls = safeRows.map((row, index) => index === 0 ? { ...row, rls_enabled: false } : row);
assert.equal(evaluateTenantSecurity(missingRls, true).ready, false, "a tenant table without RLS must fail closed");

const openPolicy = safeRows.map((row, index) => index === 1 ? { ...row, open_policy_count: 1 } : row);
assert.equal(evaluateTenantSecurity(openPolicy, true).ready, false, "an unconditional tenant policy must fail closed");

const anonymousPrivilege = safeRows.map((row, index) => index === 2 ? { ...row, anonymous_can_select: true } : row);
const privilegeFailure = evaluateTenantSecurity(anonymousPrivilege, true);
assert.equal(privilegeFailure.ready, false, "any anonymous tenant-table CRUD privilege must fail closed");
assert.equal(privilegeFailure.anonymousPrivilegedTables, 1);

assert.equal(evaluateTenantSecurity(safeRows, false).ready, false, "anonymous profile visibility must fail closed");

console.log("tenant security: PASS");
