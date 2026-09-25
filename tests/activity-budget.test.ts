import assert from "node:assert/strict";
import { forecastActivityBudget } from "../api/_lib/activity-budget.js";

const now = new Date("2026-09-25T12:00:00Z");
const forecast = forecastActivityBudget({ spendEur: 12, trailing7SpendEur: 5.6, now });
assert.ok(forecast.dailyAverageEur > 0);
assert.ok(forecast.trailing7DailyAverageEur > 0);
assert.equal(forecast.daysRemaining, 6);
assert.ok(forecast.forecastEndOfMonthEur >= 12);

const fast = forecastActivityBudget({ spendEur: 18, trailing7SpendEur: 14, now });
assert.ok(fast.forecastEndOfMonthEur > 18, "recent spend acceleration must affect forecast");

console.log("Per-activity budget forecast: PASS");
