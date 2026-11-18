import assert from "node:assert/strict";
import { dashboardSchedule } from "../src/lib/dashboard-schedule.js";

const now = Date.parse("2026-11-18T10:00:00Z");
const job = (id: string, state: string, scheduled_at: string, next_attempt_at: string | null = null) => ({ id, state, scheduled_at, next_attempt_at });
const jobs = [
  job("late", "SCHEDULED", "2026-09-24T10:00:00Z"),
  job("blocked", "BLOCKED_APPROVAL", "2026-09-26T10:00:00Z"),
  job("retry", "QUEUED", "2026-09-24T10:00:00Z", "2026-11-18T11:00:00+00:00"),
  job("now", "SCHEDULED", "2026-11-18T11:00:00+01:00"),
  job("future", "SCHEDULED", "2026-11-19T10:00:00Z"),
  job("fourth", "SCHEDULED", "2026-11-20T10:00:00Z"),
  job("published", "PUBLISHED", "2026-09-24T10:00:00Z"),
  job("failed", "FAILED", "2026-09-24T10:00:00Z"),
  job("cancelled", "CANCELLED", "2026-11-19T10:00:00Z"),
];
const view = dashboardSchedule(jobs, now);
assert.deepEqual(view.upcoming.map(({ id }) => id), ["now", "retry", "future", "fourth"]);
assert.deepEqual(view.overdue.map(({ id }) => id), ["late", "blocked"]);
assert.equal(jobs[0].id, "late", "sorting must not mutate source jobs");
assert.deepEqual(dashboardSchedule([], now), { upcoming: [], overdue: [] });
console.log("dashboard schedule: PASS (past dates, retries, timezones, states and full counts)");
