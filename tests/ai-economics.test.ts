import assert from "node:assert/strict";
import { assessMonthlyProviderExposure, commercialMargin, evaluateAiSpend, profileAiEconomicsPolicy, summarizeObservedAiCost, technicalContribution } from "../api/_lib/ai-economics.js";

const a = profileAiEconomicsPolicy({ aiEconomics: { monthlyRevenueEur: 300, monthlyAiBudgetUsd: 35, monthlyImageLimit: 30, maxGenerationsPerDay: 5, maxGenerationsPerWeek: 20 } });
const b = profileAiEconomicsPolicy({ aiEconomics: { monthlyRevenueEur: 500, monthlyAiBudgetUsd: 60, monthlyImageLimit: 50 } });
assert.equal(a.monthlyAiBudgetUsd, 35);
assert.equal(b.monthlyAiBudgetUsd, 60);
assert.notEqual(a.monthlyAiBudgetUsd, b.monthlyAiBudgetUsd, "profiles must not share one global budget");
assert.equal(a.generateImagesAfterApproval, true, "default should avoid paying for images before approval");

const ok = evaluateAiSpend(a, { textUsd: 10, imageUsd: 5, otherUsd: 0, images: 4, generationsToday: 2, generationsThisWeek: 8 }, 2);
assert.equal(ok.blocked, false);
const blocked = evaluateAiSpend(a, { textUsd: 30, imageUsd: 4, otherUsd: 0, images: 10, generationsToday: 2, generationsThisWeek: 8 }, 2);
assert.equal(blocked.blocked, true);
assert.equal(blocked.reason, "MONTHLY_AI_BUDGET");
const daily = evaluateAiSpend(a, { textUsd: 1, imageUsd: 1, otherUsd: 0, images: 1, generationsToday: 5, generationsThisWeek: 8 });
assert.equal(daily.reason, "DAILY_GENERATION_LIMIT");

const margin = commercialMargin({ monthlyRevenueEur: 300, attributedVariableCostsEur: 25 });
assert.equal(margin.grossMarginEur, 275);
assert.ok(Math.abs((margin.grossMarginPct ?? 0) - 91.6666666667) < 0.001);
assert.deepEqual(commercialMargin({ monthlyRevenueEur: null, attributedVariableCostsEur: 10 }), { grossMarginEur: null, grossMarginPct: null });

assert.deepEqual(summarizeObservedAiCost({ logicalUnits: 0, technicalEventCostsUsd: [] }), {
  status: "NO_DATA", logicalUnits: 0, technicalEvents: 0, knownCostUsd: 0, nullCostEvents: 0, averageCostPerLogicalUnitUsd: null,
}, "zero production events are no-data, not a zero-cost average");
assert.deepEqual(summarizeObservedAiCost({ logicalUnits: 1, technicalEventCostsUsd: [0.04, null] }), {
  status: "INCOMPLETE", logicalUnits: 1, technicalEvents: 2, knownCostUsd: 0.04, nullCostEvents: 1, averageCostPerLogicalUnitUsd: null,
}, "a missing technical subcall cost must invalidate the average");
assert.deepEqual(summarizeObservedAiCost({ logicalUnits: 2, technicalEventCostsUsd: [0.03, 0.05, 0.02] }), {
  status: "COMPLETE", logicalUnits: 2, technicalEvents: 3, knownCostUsd: 0.1, nullCostEvents: 0, averageCostPerLogicalUnitUsd: 0.05,
});

const currentExposure = assessMonthlyProviderExposure([
  { capabilityKey: "ai.content.generate_text", enabled: true, hardMonthlyProviderCostCapUsd: null },
  { capabilityKey: "brand.analyze", enabled: true, hardMonthlyProviderCostCapUsd: null },
  { capabilityKey: "ai.strategy.generate", enabled: true, hardMonthlyProviderCostCapUsd: null },
  { capabilityKey: "ai.image.generate", enabled: true, hardMonthlyProviderCostCapUsd: null },
]);
assert.equal(currentExposure.status, "UNBOUNDED", "logical quotas and estimated budgets do not bound billable failed/released provider attempts");
assert.equal(currentExposure.hardMonthlyProviderCostCapUsd, null);
assert.deepEqual(currentExposure.unboundedCapabilities, ["ai.content.generate_text", "brand.analyze", "ai.strategy.generate", "ai.image.generate"]);
assert.deepEqual(assessMonthlyProviderExposure([
  { capabilityKey: "ai", enabled: true, hardMonthlyProviderCostCapUsd: 10 },
  { capabilityKey: "disabled", enabled: false, hardMonthlyProviderCostCapUsd: null },
]), { status: "BOUNDED", hardMonthlyProviderCostCapUsd: 10, unboundedCapabilities: [] });

const contribution = technicalContribution({ monthlyRevenueEur: 60, providerCostUsd: 10, usdPerEur: 1.1622, otherTechnicalCostsEur: 0.5 });
assert.ok(Math.abs(contribution.technicalCogsEur - 9.1043710205) < 1e-9);
assert.ok(Math.abs((contribution.contributionEur ?? 0) - 50.8956289795) < 1e-9);
assert.equal(contribution.meetsTarget, true);
assert.ok(Math.abs(contribution.minimumRevenueForTargetEur - 59.1043710205) < 1e-9);
assert.equal(technicalContribution({ monthlyRevenueEur: null, providerCostUsd: 0, usdPerEur: 1.1622, otherTechnicalCostsEur: 0 }).meetsTarget, null);

console.log("AI economics regression: PASS");
