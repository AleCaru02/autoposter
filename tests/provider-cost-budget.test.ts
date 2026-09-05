import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../db/migrations/20260905_fase4f_provider_cost_budget.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.provider_cost_attempts/i);
assert.match(migration, /logical_usage_event_id uuid NOT NULL UNIQUE/i);
assert.match(migration, /pg_advisory_xact_lock/i);
assert.match(migration, /sum\(GREATEST\(reserved_usd,COALESCE\(actual_usd,0\)\)\)/i);
assert.match(migration, /v_accounted\+v_reserve > v_cap/i);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.begin_provider_cost_attempt\(uuid\) FROM PUBLIC, authenticated/i);
assert.match(migration, /UPDATE public\.entitlement_packages SET lifecycle='ACTIVE'/i);

const service = readFileSync(new URL("../api/_lib/entitlement-usage.ts", import.meta.url), "utf8");
assert.ok(service.indexOf("beginProviderCostAttempt(eventId)") < service.indexOf('execution_state: "PROVIDER_STARTED"'));
assert.match(service, /if \(!budget\.allowed\) throw new Error\("PROVIDER_COST_BUDGET_REACHED"\)/);

for (const path of [
  "../api/_lib/text-generation-metering.ts",
  "../api/_lib/brand-analysis-metering.ts",
  "../api/_lib/strategy-planner-metering.ts",
  "../api/_lib/image-generation-metering.ts",
]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source, /return this\.usage\.markProviderStarted\(eventId\)/, `${path} bypasses central provider budget`);
  assert.match(source, /reconcileProviderCostAttempt\(eventId\)/, `${path} does not reconcile known technical cost`);
}

for (const path of [
  "../api/generate-text.ts",
  "../cloudflare/generate-text.ts",
  "../api/generate-image.ts",
  "../cloudflare/worker.ts",
  "../api/onboarding-analyze.ts",
  "../cloudflare/onboarding-analyze.ts",
  "../api/editorial-agents.ts",
  "../cloudflare/editorial-agents.ts",
]) {
  assert.match(readFileSync(new URL(path, import.meta.url), "utf8"), /PROVIDER_COST_BUDGET_REACHED/, `${path} lacks explicit budget denial semantics`);
}

console.log("FASE 4F provider cost budget regression: PASS");
