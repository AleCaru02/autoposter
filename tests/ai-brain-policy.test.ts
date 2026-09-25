import assert from "node:assert/strict";
import {
  ACTIVITY_BUDGET_EUR,
  activityBudgetBand,
  brainDecision,
  detectClaimRisk,
  publicationGate,
} from "../api/_lib/ai-brain-policy.js";

assert.equal(ACTIVITY_BUDGET_EUR.hardCap, 30);
assert.equal(activityBudgetBand(0), "NORMAL");
assert.equal(activityBudgetBand(17.99), "NORMAL");
assert.equal(activityBudgetBand(18), "TARGET_REACHED");
assert.equal(activityBudgetBand(20), "RESERVE");
assert.equal(activityBudgetBand(25), "PROTECTED_RESERVE");
assert.equal(activityBudgetBand(28), "EMERGENCY_ONLY");
assert.equal(activityBudgetBand(30), "HARD_STOP");

const legal = detectClaimRisk("Dal 2027 cambia questa legge e la commissione sale al 15%.");
assert.equal(legal.timeSensitive, true);
assert.equal(legal.numeric, true);
assert.equal(legal.legalOrRegulatory, true);
assert.equal(legal.pricingOrFee, true);
assert.equal(legal.material, true);

const normal = brainDecision({ spendEur: 4, task: "IMAGE_PREMIUM", importance: "PREMIUM", text: "Campagna premium" });
assert.equal(normal.allowBillableAi, true);
assert.equal(normal.allowPremium, true);
assert.equal(normal.preferReuse, false);

const reserve = brainDecision({ spendEur: 23, task: "IMAGE_PREMIUM", importance: "STANDARD", text: "Post standard" });
assert.equal(reserve.budgetBand, "RESERVE");
assert.equal(reserve.allowPremium, false);
assert.equal(reserve.preferReuse, true);

const hardStop = brainDecision({ spendEur: 30, task: "COPY_DRAFT", importance: "CRITICAL" });
assert.equal(hardStop.allowBillableAi, false);

const factual = brainDecision({
  spendEur: 3,
  task: "COPY_FINAL",
  importance: "IMPORTANT",
  researchMode: "BALANCED",
  text: "Airbnb introduce una nuova commissione dal 2027.",
});
assert.equal(factual.researchRequired, true);
assert.equal(factual.factCheckRequired, true);
assert.equal(factual.minimumIndependentSources, 2);

assert.deepEqual(publicationGate({
  qaVerdict: "PASS",
  factCheckRequired: true,
  factCheckVerdict: "PASS",
  sourceCount: 2,
  minimumIndependentSources: 2,
}), { allowed: true, reason: null });

assert.equal(publicationGate({
  qaVerdict: "PASS",
  factCheckRequired: true,
  factCheckVerdict: "PASS",
  sourceCount: 1,
  minimumIndependentSources: 2,
}).reason, "INSUFFICIENT_SOURCES");

assert.equal(publicationGate({
  qaVerdict: "PASS",
  factCheckRequired: true,
  factCheckVerdict: "NEEDS_RESEARCH",
  sourceCount: 2,
  minimumIndependentSources: 2,
}).reason, "FACT_CHECK_BLOCKED");

console.log("AI Brain central policy: PASS");
