import assert from "node:assert/strict";
import { commercialMargin, evaluateAiSpend, profileAiEconomicsPolicy } from "../api/_lib/ai-economics.js";

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

console.log("AI economics regression: PASS");
