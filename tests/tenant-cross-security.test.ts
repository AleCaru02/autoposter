import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateCrossTenantChecks } from "../cloudflare/tenant-cross-test.js";

const required = [
  "A_can_read_own_profile",
  "A_can_read_own_owner_membership",
  "A_can_read_own_brand",
  "A_can_update_own_profile",
  "A_can_update_own_brand",
  "A_can_delete_own_permitted_brand",
  "B_can_read_own_profile",
  "B_can_read_own_owner_membership",
  "B_can_read_own_brand",
  "B_can_update_own_profile",
  "B_can_update_own_brand",
  "B_can_delete_own_permitted_brand",
  "A_cannot_read_B_profile_by_hostile_tenant_id",
  "A_cannot_read_B_membership_by_altered_profile_id",
  "A_cannot_read_B_membership_by_known_resource_id",
  "A_cannot_read_B_brand_by_altered_profile_id",
  "A_cannot_read_B_brand_by_known_resource_id",
  "B_cannot_read_A_profile_by_hostile_tenant_id",
  "B_cannot_read_A_membership_by_altered_profile_id",
  "B_cannot_read_A_membership_by_known_resource_id",
  "B_cannot_read_A_brand_by_altered_profile_id",
  "B_cannot_read_A_brand_by_known_resource_id",
  "A_cannot_update_B_profile_by_direct_api",
  "A_cannot_update_B_brand_by_direct_api",
  "A_cannot_delete_B_brand_by_direct_api",
  "A_cannot_delete_B_profile_by_direct_api",
  "A_cannot_create_resource_with_B_profile_id",
  "B_cannot_update_A_profile_by_direct_api",
  "B_cannot_update_A_brand_by_direct_api",
  "B_cannot_delete_A_brand_by_direct_api",
  "B_cannot_delete_A_profile_by_direct_api",
  "B_cannot_create_resource_with_A_profile_id",
  "A_cannot_join_B_profile",
  "A_cannot_add_arbitrary_user_membership",
  "A_cannot_escalate_own_membership_role",
  "A_cannot_move_membership_to_B_profile",
  "A_cannot_modify_B_membership",
  "A_cannot_delete_B_membership",
  "A_cannot_delete_own_owner_membership",
  "A_cannot_replace_server_derived_owner_user_id",
  "B_cannot_join_A_profile",
  "B_cannot_add_arbitrary_user_membership",
  "B_cannot_escalate_own_membership_role",
  "B_cannot_move_membership_to_A_profile",
  "B_cannot_modify_A_membership",
  "B_cannot_delete_A_membership",
  "B_cannot_delete_own_owner_membership",
  "B_cannot_replace_server_derived_owner_user_id",
];

const passing = required.map((name) => ({ name, pass: true }));
assert.equal(passing.length, 48, "the regression must keep the full owner, cross-tenant and membership-escalation contract");
assert.equal(evaluateCrossTenantChecks(passing, true), true, "all own-access, hostile A/B, escalation and cleanup checks must pass");
assert.equal(evaluateCrossTenantChecks(passing, false), false, "cleanup failure must fail the security gate");
assert.equal(evaluateCrossTenantChecks(passing.map((item, index) => index === 14 ? { ...item, pass: false } : item), true), false, "one cross-tenant leak must fail the gate");
assert.equal(evaluateCrossTenantChecks(passing.map((item, index) => index === 34 ? { ...item, pass: false } : item), true), false, "one membership escalation must fail the gate");
assert.equal(evaluateCrossTenantChecks(passing.slice(0, 47), true), false, "an incomplete test set must not pass");

const migration = readFileSync("db/migrations/20260830_profile_owner_membership_contract.sql", "utf8");
assert.match(migration, /OWNER_AUTH_MAPPING_UNSAFE/, "backfill must fail closed when ownership cannot be proven");
assert.match(migration, /sync_profile_owner_membership/, "owner membership creation must live in a versioned database function");
assert.match(migration, /BEFORE INSERT ON public\.profiles/, "profile owner identity must be derived before the profile row is accepted");
assert.match(migration, /AFTER INSERT ON public\.profiles/, "OWNER membership must be created in the same database transaction as the profile");
assert.match(migration, /ALTER COLUMN owner_user_id SET NOT NULL/, "the internal owner link must not remain nullable after safe backfill");
assert.match(migration, /CREATE POLICY profile_members_owner_read[\s\S]*FOR SELECT/, "CUSTOMER membership access must be read-only through RLS");
assert.doesNotMatch(migration, /CREATE POLICY profile_members_owner_read[\s\S]*FOR ALL/, "the replacement membership policy must not restore customer writes");

const insertPolicyFix = readFileSync("db/migrations/20260830_profile_owner_insert_policy_fix.sql", "utf8");
assert.match(insertPolicyFix, /CREATE POLICY profiles_owner_insert[\s\S]*FOR INSERT[\s\S]*owner_auth_user_id = public\.current_auth_user_id\(\)/, "new profile INSERT must remain bound to the authenticated owner identity");
assert.match(insertPolicyFix, /CREATE POLICY profiles_owner_update[\s\S]*FOR UPDATE[\s\S]*owner_user_id = public\.current_app_user_id\(\)/, "profile UPDATE must keep the server-derived owner link immutable to another app user");
assert.match(insertPolicyFix, /CREATE POLICY profiles_owner_select[\s\S]*FOR SELECT/, "owner profile reads must remain isolated");
assert.match(insertPolicyFix, /CREATE POLICY profiles_owner_delete[\s\S]*FOR DELETE/, "owner profile deletes must remain isolated");
assert.doesNotMatch(insertPolicyFix, /CREATE POLICY profiles_owner_isolation[\s\S]*FOR ALL/, "the statement-order regression must not be reintroduced through a single FOR ALL policy");

const onboarding = readFileSync("src/pages/onboarding-page.tsx", "utf8");
assert.match(onboarding, /profiles\.length > 0 && !creatingAnother && stage === "FORM"/, "refreshing normal onboarding with an existing profile must redirect instead of creating another workspace");
assert.match(onboarding, /const submitLock = useRef\(false\)/, "onboarding must use a synchronous submission lock against rapid duplicate submits");
assert.match(onboarding, /if \(submitLock\.current\) return/, "a second concurrent submit must be rejected before createProfile runs");
assert.match(onboarding, /if \(creatingAnother\) navigate\("\/onboarding", \{ replace: true \}\)/, "the explicit ?new=1 intent must be consumed after one profile creation so refresh cannot repeat it");
assert.match(onboarding, /disabled=\{submitting\}/, "the UI must expose a coherent disabled state while profile creation is running");

console.log("tenant cross security regression: PASS");
