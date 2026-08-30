import assert from "node:assert/strict";
import { TENANT_TABLES, evaluateTenantSecurity } from "../cloudflare/tenant-security.js";

const safeRows = TENANT_TABLES.map((table_name) => ({
  table_name,
  table_exists: true,
  rls_enabled: true,
  force_rls: false,
  policy_count: 1,
  open_policy_count: 0,
}));

const safe = evaluateTenantSecurity(safeRows, true);
assert.equal(safe.ready, true, "all tenant tables with RLS, policies and blocked anonymous reads must pass");
assert.equal(safe.expectedTables, TENANT_TABLES.length);
assert.equal(safe.openPolicies, 0);

const missingRls = safeRows.map((row, index) => index === 0 ? { ...row, rls_enabled: false } : row);
assert.equal(evaluateTenantSecurity(missingRls, true).ready, false, "a tenant table without RLS must fail closed");

const openPolicy = safeRows.map((row, index) => index === 1 ? { ...row, open_policy_count: 1 } : row);
assert.equal(evaluateTenantSecurity(openPolicy, true).ready, false, "an unconditional tenant policy must fail closed");

assert.equal(evaluateTenantSecurity(safeRows, false).ready, false, "anonymous profile visibility must fail closed");

console.log("tenant security: PASS");
