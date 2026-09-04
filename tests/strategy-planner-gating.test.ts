import assert from "node:assert/strict";
import fs from "node:fs";
import {
  STRATEGY_GENERATE_CAPABILITY,
  STRATEGY_TECHNICAL_OPERATIONS,
  deriveStrategyPlannerOperationKey,
} from "../api/_lib/strategy-planner-metering.js";

const planner = fs.readFileSync("api/_lib/openai-strategy-planner.ts", "utf8");
const refresh = fs.readFileSync("api/_lib/openai-strategy-planner-refresh.ts", "utf8");
const metering = fs.readFileSync("api/_lib/strategy-planner-metering.ts", "utf8");
const vercel = fs.readFileSync("api/editorial-agents.ts", "utf8");
const worker = fs.readFileSync("cloudflare/editorial-agents.ts", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
const serialized = fs.readFileSync("api/_lib/autopilot-serialized.ts", "utf8");

assert.equal(STRATEGY_GENERATE_CAPABILITY, "ai.strategy.generate");
assert.deepEqual(STRATEGY_TECHNICAL_OPERATIONS, ["AGENT_STRATEGIST", "AGENT_PLANNER"]);

const profileA = "11111111-1111-4111-8111-111111111111";
const profileB = "22222222-2222-4222-8222-222222222222";
const day = new Date("2026-09-04T12:00:00.000Z");
const nextDay = new Date("2026-09-05T12:00:00.000Z");
assert.equal(deriveStrategyPlannerOperationKey(profileA, "STRATEGY_PLAN", day), deriveStrategyPlannerOperationKey(profileA, "STRATEGY_PLAN", day));
assert.notEqual(deriveStrategyPlannerOperationKey(profileA, "STRATEGY_PLAN", day), deriveStrategyPlannerOperationKey(profileB, "STRATEGY_PLAN", day));
assert.notEqual(deriveStrategyPlannerOperationKey(profileA, "STRATEGY_PLAN", day), deriveStrategyPlannerOperationKey(profileA, "PLAN", day));
assert.notEqual(deriveStrategyPlannerOperationKey(profileA, "STRATEGY_PLAN", day), deriveStrategyPlannerOperationKey(profileA, "STRATEGY_PLAN", nextDay));

for (const source of [planner, refresh]) {
  assert.match(source, /StrategyPlannerMetering/);
  assert.match(source, /meter\.reserve\(\{\s*profileId/);
  assert.ok(source.indexOf("await meter.reserve") < source.indexOf("await generateOpenAIStrategy"), "provider callable before entitlement reserve");
  assert.ok(source.indexOf("await meter.markProviderStarted") < source.indexOf("await generateOpenAIStrategy"), "provider start must be recorded before OpenAI");
  assert.ok(source.indexOf("await meter.persistTechnicalUsage") < source.indexOf("insert into public.content_strategies"), "technical usage must be durable before product persistence");
  assert.ok(source.indexOf("await meter.storeResult") < source.indexOf("await meter.commit"), "cached result must precede logical commit");
  assert.match(source, /meter\.release/);
  assert.match(source, /STRATEGY_GENERATION_IN_PROGRESS/);
  assert.doesNotMatch(source, /insert into public\.ai_usage_events/);
}

assert.match(metering, /CAPABILITY_DISABLED/);
assert.match(metering, /CAPABILITY_LIMIT_REACHED/);
assert.match(metering, /PENDING_RECONCILIATION/);
assert.match(metering, /logical_usage_event_id/);
assert.match(metering, /where not exists/);
for (const source of [vercel, worker]) {
  assert.match(source, /CAPABILITY_DISABLED/);
  assert.match(source, /CAPABILITY_LIMIT_REACHED/);
  assert.match(source, /STRATEGY_GENERATION_IN_PROGRESS/);
  assert.match(source, /METERING_FAILED/);
}
assert.match(entry, /path === "\/api\/editorial-agents\/strategy-plan"\) return handleWorkerStrategyPlanner/);
assert.match(serialized, /ensureOpenAIStrategyPlannerFresh/);

console.log("Strategy planner server-side gating regression: PASS");
