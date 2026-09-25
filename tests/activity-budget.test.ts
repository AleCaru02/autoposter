import assert from "node:assert/strict";
import fs from "node:fs";
import { forecastActivityBudget } from "../api/_lib/activity-budget.js";

const now = new Date("2026-09-25T12:00:00Z");
const forecast = forecastActivityBudget({ spendEur: 12, trailing7SpendEur: 5.6, now });
assert.ok(forecast.dailyAverageEur > 0);
assert.ok(forecast.trailing7DailyAverageEur > 0);
assert.equal(forecast.daysRemaining, 6);
assert.ok(forecast.forecastEndOfMonthEur >= 12);

const fast = forecastActivityBudget({ spendEur: 18, trailing7SpendEur: 14, now });
assert.ok(fast.forecastEndOfMonthEur > 18, "recent spend acceleration must affect forecast");

const budgetEngine = fs.readFileSync("api/_lib/activity-budget.ts", "utf8");
const manualText = fs.readFileSync("api/generate-text.ts", "utf8");
const workerText = fs.readFileSync("cloudflare/generate-text.ts", "utf8");
const manualImage = fs.readFileSync("api/generate-image.ts", "utf8");
const workerImage = fs.readFileSync("cloudflare/worker.ts", "utf8");
const autopilot = fs.readFileSync("api/_lib/autopilot.ts", "utf8");
const serialized = fs.readFileSync("api/_lib/autopilot-serialized.ts", "utf8");

assert.match(budgetEngine, /async preflight\(/, "budget engine must expose one canonical preflight");
assert.match(budgetEngine, /AI_BUDGET_HARD_STOP/);
assert.match(budgetEngine, /projectedOperationCostUsd/);
for (const source of [manualText, workerText, manualImage, workerImage, autopilot, serialized]) {
  assert.match(source, /ActivityBudgetEngine/, "every live billable path must use the activity-scoped budget engine");
}
assert.doesNotMatch(manualText, /OPENAI_TEXT_MONTHLY_BUDGET_USD|monthlyBudgetUsd/);
assert.doesNotMatch(manualImage, /OPENAI_IMAGE_MONTHLY_LIMIT|monthlyImageLimit/);
assert.doesNotMatch(autopilot, /textBudget\(|imageLimit\(/);
assert.match(serialized, /ACTIVITY_HARD_STOP/, "serialized autopilot must stop only the profile that exhausted its activity budget");

console.log("Per-activity budget forecast + live integration: PASS");
