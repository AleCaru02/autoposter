import assert from "node:assert/strict";
import fs from "node:fs";

const sql = fs.readFileSync("db/migrations/20260925_activity_ai_budget_engine.sql", "utf8");

for (const fragment of [
  "activity_ai_budget_policies",
  "hard_cap_eur numeric NOT NULL DEFAULT 30",
  "ordinary_target_eur numeric NOT NULL DEFAULT 18",
  "reserve_start_eur numeric NOT NULL DEFAULT 20",
  "protected_reserve_start_eur numeric NOT NULL DEFAULT 25",
  "emergency_only_start_eur numeric NOT NULL DEFAULT 28",
  "profiles_activity_ai_budget_policy",
  "activity_ai_budget_snapshot",
  "activity-ai-budget:",
  "fx_usd_to_eur_rate",
]) assert.ok(sql.includes(fragment), `missing activity budget invariant: ${fragment}`);

assert.match(sql, /profile_id=p_logical_usage_event_id|v_logical\.profile_id|profile_id=v_logical\.profile_id/, "provider cost gating must derive the budget owner from the logical usage event");
assert.match(sql, /v_accounted_eur\+\(v_reserve\*v_policy\.usd_to_eur_rate\)>v_policy\.hard_cap_eur/, "the 30 EUR activity hard cap must be enforced before provider start");
assert.match(sql, /WHERE package_key='personal_operator' AND version=1/, "personal operator secondary cap must be updated without changing other packages");
assert.match(sql, /FOR SELECT TO authenticated USING \(public\.owns_profile\(profile_id\)\)/, "budget read access must remain profile-scoped");
assert.match(sql, /REVOKE INSERT,UPDATE,DELETE ON public\.activity_ai_budget_policies FROM authenticated/, "customers must not be able to raise their own hard cap");
assert.doesNotMatch(sql, /email|owner_email|02alessandro/i, "budget isolation must never depend on identity special-cases");

console.log("Per-activity budget migration: PASS");
