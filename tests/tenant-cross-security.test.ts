import assert from "node:assert/strict";
import { evaluateCrossTenantChecks } from "../cloudflare/tenant-cross-test.js";

const required = [
  "A_can_read_own_profile",
  "A_can_read_own_membership",
  "A_can_read_own_brand",
  "A_can_update_own_profile",
  "A_can_update_own_brand",
  "A_can_delete_own_permitted_brand",
  "B_can_read_own_profile",
  "B_can_read_own_membership",
  "B_can_read_own_brand",
  "B_can_update_own_profile",
  "B_can_update_own_brand",
  "B_can_delete_own_permitted_brand",
  "A_cannot_read_B_profile_by_hostile_tenant_id",
  "A_cannot_read_B_membership_by_altered_profile_id",
  "A_cannot_read_B_membership_by_known_resource_id",
  "A_cannot_read_B_brand_by_altered_profile_id",
  "B_cannot_read_A_profile_by_hostile_tenant_id",
  "B_cannot_read_A_membership_by_altered_profile_id",
  "B_cannot_read_A_membership_by_known_resource_id",
  "B_cannot_read_A_brand_by_altered_profile_id",
  "A_cannot_update_B_profile_by_direct_api",
  "A_cannot_update_B_brand_by_direct_api",
  "A_cannot_delete_B_brand_by_direct_api",
  "A_cannot_delete_B_profile_by_direct_api",
  "B_cannot_update_A_profile_by_direct_api",
  "B_cannot_update_A_brand_by_direct_api",
  "B_cannot_delete_A_brand_by_direct_api",
  "B_cannot_delete_A_profile_by_direct_api",
];

const passing = required.map((name) => ({ name, pass: true }));
assert.equal(passing.length, 28, "the regression must keep the full minimum security contract");
assert.equal(evaluateCrossTenantChecks(passing, true), true, "all own-access, hostile A/B checks and cleanup must pass");
assert.equal(evaluateCrossTenantChecks(passing, false), false, "cleanup failure must fail the security gate");
assert.equal(evaluateCrossTenantChecks(passing.map((item, index) => index === 14 ? { ...item, pass: false } : item), true), false, "one cross-tenant leak must fail the gate");
assert.equal(evaluateCrossTenantChecks(passing.slice(0, 27), true), false, "an incomplete test set must not pass");

console.log("tenant cross security regression: PASS");
