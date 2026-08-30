import assert from "node:assert/strict";
import { evaluateCrossTenantChecks } from "../cloudflare/tenant-cross-test.js";

const required = [
  "A_can_read_own_profile",
  "B_can_read_own_profile",
  "A_cannot_read_B_profile",
  "A_cannot_read_B_membership",
  "A_cannot_read_B_brand",
  "B_cannot_read_A_profile",
  "B_cannot_read_A_membership",
  "B_cannot_read_A_brand",
  "A_cannot_update_B_profile",
  "A_cannot_update_B_brand",
  "A_cannot_delete_B_brand",
  "A_cannot_delete_B_profile",
  "B_cannot_update_A_profile",
  "B_cannot_update_A_brand",
  "B_cannot_delete_A_brand",
  "B_cannot_delete_A_profile",
];

const passing = required.map((name) => ({ name, pass: true }));
assert.equal(evaluateCrossTenantChecks(passing, true), true, "all A/B checks plus cleanup must pass");
assert.equal(evaluateCrossTenantChecks(passing, false), false, "cleanup failure must fail the security gate");
assert.equal(evaluateCrossTenantChecks(passing.map((item, index) => index === 4 ? { ...item, pass: false } : item), true), false, "one cross-tenant leak must fail the gate");
assert.equal(evaluateCrossTenantChecks(passing.slice(0, 13), true), false, "an incomplete test set must not pass");

console.log("tenant cross security regression: PASS");
