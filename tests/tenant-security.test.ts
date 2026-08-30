import assert from "node:assert/strict";
import { TENANT_TABLES, classifyAnonymousProbe, evaluateTenantSecurity } from "../cloudflare/tenant-security.js";

const safeRows = TENANT_TABLES.map((table_name) => ({
  table_name,
  table_exists: true,
  rls_enabled: true,
  force_rls: false,
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
assert.equal(safe.openPolicies, 0);
assert.equal(safe.anonymousPrivilegedTables, 0);

const missingRls = safeRows.map((row, index) => index === 0 ? { ...row, rls_enabled: false } : row);
assert.equal(evaluateTenantSecurity(missingRls, emptyRows).ready, false, "a tenant table without RLS must fail closed");

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

console.log("tenant security: PASS");
