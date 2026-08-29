import assert from "node:assert/strict";
import { buildPlanDrivenTopicRequest, selectPlanItem } from "../api/_lib/autopilot-ai-plan.js";
import { strategyPlannerRefreshDecision } from "../api/_lib/openai-strategy-planner-refresh.js";
import { readFile } from "node:fs/promises";

const platformStrategy = {
  aiEditorialPlan: { horizonDays: 14, items: [
    { dayOffset: 2, provider: "INSTAGRAM", contentType: "STORYTELLING", intent: "PROBLEM_SOLUTION", topicDirection: "Tre errori nella gestione", objective: "Lead", funnelStage: "AWARENESS" },
    { dayOffset: 4, provider: "GBP", contentType: "SINGLE_POST", intent: "NEWS", topicDirection: "Aggiornamento locale verificato", objective: "Fiducia", funnelStage: "CONSIDERATION" },
  ] },
  aiEditorialPlanGeneratedAt: "2026-08-28T00:00:00Z",
  aiStrategy: { summary: "s", primaryObjective: "Lead", contentPillars: ["a","b","c"] },
  aiStrategyGeneratedAt: "2026-08-20T00:00:00Z",
};
const now = new Date("2026-08-29T00:00:00Z");
const item = selectPlanItem(platformStrategy, "INSTAGRAM", "2026-08-31T00:00:00Z", now);
assert.equal(item?.contentType, "STORYTELLING");
assert.equal(item?.format, "CAROUSEL");
assert.match(buildPlanDrivenTopicRequest(item!, ["Tema vecchio"]), /Tre errori nella gestione/);
const gbp = selectPlanItem(platformStrategy, "GBP", "2026-09-02T00:00:00Z", now);
assert.equal(gbp?.format, "POST");
assert.equal(gbp?.intent, "NEWS");

assert.deepEqual(strategyPlannerRefreshDecision(platformStrategy, { strategyRefreshDays: 30, planRefreshDays: 14 }, now), { refreshStrategy: false, refreshPlan: false });
assert.deepEqual(strategyPlannerRefreshDecision({ ...platformStrategy, aiEditorialPlanGeneratedAt: "2026-08-01T00:00:00Z" }, { strategyRefreshDays: 30, planRefreshDays: 14 }, now), { refreshStrategy: false, refreshPlan: true });
assert.deepEqual(strategyPlannerRefreshDecision({ ...platformStrategy, aiStrategyGeneratedAt: "2026-07-01T00:00:00Z" }, { strategyRefreshDays: 30, planRefreshDays: 14 }, now), { refreshStrategy: true, refreshPlan: true });

const autopilot = await readFile(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
assert.match(autopilot, /selectPlanItem\(strategy\?\.platform_strategy,provider,scheduledAt\)/);
assert.match(autopilot, /planItem\?\.intent==="NEWS"\?"NEWS"/);
assert.match(autopilot, /planner_driven:Boolean\(planItem\)/);
const serialized = await readFile(new URL("../api/_lib/autopilot-serialized.ts", import.meta.url), "utf8");
assert.match(serialized, /ensureOpenAIStrategyPlannerFresh/);
assert.match(serialized, /PLANNER_REFRESH_RESERVE/);
assert.match(serialized, /usage=await usageSnapshot\(client,profileId\)/);
console.log("Autopilot AI-plan runtime regression: PASS");
