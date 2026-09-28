import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("db/migrations/20260928_global_ai_budget_hardening.sql", "utf8");
const worker = fs.readFileSync("cloudflare/worker.ts", "utf8");
const entitlement = fs.readFileSync("api/_lib/entitlement-usage.ts", "utf8");
const settings = fs.readFileSync("src/pages/settings-page.tsx", "utf8");
const textRoute = fs.readFileSync("api/generate-text.ts", "utf8");
const imageRoute = fs.readFileSync("api/generate-image.ts", "utf8");

for (const fragment of [
  "account_ai_budget_policies",
  "set_account_ai_budget",
  "set_activity_ai_budget",
  "customer_ai_budget_overview",
  "account-ai-budget:",
  "activity-ai-budget:",
  "ACTIVITY_AI_BUDGET_EXCEEDS_ACCOUNT_CAP",
  "provider_cost_reserve_usd",
]) assert.ok(migration.includes(fragment), `missing global budget invariant: ${fragment}`);

assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('account-ai-budget:/, "account lock must serialize concurrent spending");
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('activity-ai-budget:/, "activity lock must serialize concurrent spending");
assert.match(migration, /v_account_eur\+\(v_reserve\*v_activity\.usd_to_eur_rate\)>v_account\.hard_cap_eur/, "global account cap must be checked before provider start");
assert.match(migration, /v_activity_eur\+\(v_reserve\*v_activity\.usd_to_eur_rate\)>v_activity\.hard_cap_eur/, "activity cap must be checked before provider start");
assert.match(migration, /IF NOT public\.owns_profile\(p_profile_id\)/, "customer budget reads/writes must be profile-owned");
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_account_ai_budget\(numeric\) TO authenticated/, "user must be able to explicitly change global budget");
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_activity_ai_budget\(uuid,numeric\) TO authenticated/, "user must be able to explicitly change activity budget");

assert.doesNotMatch(worker, /OPENAI_TEXT_MONTHLY_BUDGET_USD|DEFAULT_MONTHLY_TEXT_BUDGET_USD|ownerTextSpendUsd|monthlyTextBudgetUsd/, "Cloudflare text path must not keep a second independent budget");
assert.match(worker, /TextGenerationMetering/, "Cloudflare text generation must use canonical metering");
assert.match(worker, /markProviderStarted\(eventId, upperUsd\)/, "Cloudflare text must reserve projected upper bound");
assert.match(textRoute, /markProviderStarted\(eventId, requestUpperBoundUsd\)/, "Vercel text must reserve projected upper bound");
assert.match(imageRoute, /markProviderStarted\(eventId, 0\.25\)/, "Vercel image must reserve image upper bound");
assert.match(entitlement, /providerCostReserveUsd/, "provider ledger must accept a projected reservation override");

assert.match(settings, /Budget globale account/);
assert.match(settings, /Budget attività/);
assert.match(settings, /set_account_ai_budget/);
assert.match(settings, /set_activity_ai_budget/);
assert.match(settings, /customer_ai_budget_overview/);
assert.match(settings, /Il budget dell’attività non può superare il budget globale/);

console.log("Global + activity AI budget hardening: PASS");
