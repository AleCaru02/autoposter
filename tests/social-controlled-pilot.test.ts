import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pilotPublicationDecision, publicationDateIsFresh } from "../api/_lib/social.js";

const profileId = "73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
const settings = { profileId, maxDaily: 1, dueProfileIds: [profileId], publishedToday: 0 };
assert.deepEqual(pilotPublicationDecision(settings), { ok: true, limit: 1 });
assert.deepEqual(pilotPublicationDecision({ ...settings, publishedToday: 1 }), { ok: false, reason: "PILOT_DAILY_LIMIT_REACHED" });
assert.deepEqual(pilotPublicationDecision({ ...settings, dueProfileIds: ["ef09dc2a-9d83-4ce5-8d3d-82d1acf85f4b"] }),
  { ok: false, reason: "PILOT_OUT_OF_SCOPE_DUE_JOB" });
assert.deepEqual(pilotPublicationDecision({ ...settings, profileId: "" }), { ok: false, reason: "PILOT_PROFILE_NOT_CONFIGURED" });
assert.deepEqual(pilotPublicationDecision({ ...settings, maxDaily: 0 }), { ok: false, reason: "PILOT_DAILY_LIMIT_INVALID" });
assert.deepEqual(pilotPublicationDecision({ ...settings, maxDaily: 999 }), { ok: false, reason: "PILOT_DAILY_LIMIT_INVALID" });
assert.deepEqual(pilotPublicationDecision({ ...settings, publishedToday: -1 }), { ok: false, reason: "PILOT_COUNT_INVALID" });

const now = Date.parse("2026-11-17T16:00:00.000Z");
assert.equal(publicationDateIsFresh("2026-11-17T15:30:00.000Z", now), true);
assert.equal(publicationDateIsFresh("2026-11-16T16:00:00.000Z", now), true);
assert.equal(publicationDateIsFresh("2026-11-16T15:59:59.000Z", now), false, "older than 24h must never publish");
assert.equal(publicationDateIsFresh("2026-09-24T10:30:00.000Z", now), false);
assert.equal(publicationDateIsFresh("invalid", now), false);
assert.equal(publicationDateIsFresh("2026-11-17T18:00:00.000Z", now), false, "future posting not due yet");

const source = readFileSync(new URL("../api/_lib/social.ts", import.meta.url), "utf8");
assert.match(source, /if \(job\.profile_id !== env\.SOCIAL_PILOT_PROFILE_ID\) throw terminalPublishError/);
assert.ok(source.indexOf("if (!publicationDateIsFresh(job.scheduled_at))") < source.indexOf('const meter = new EntitlementUsageService(env.DATABASE_URL!)', source.indexOf("async function processJob")),
  "Reject stale jobs before reserving any provider publication entitlement");
assert.match(source, /where state='SCHEDULED' and attempt_count<3 and scheduled_at<=now\(\)/);
assert.match(source, /state='PUBLISHED'/);
const cron = readFileSync(new URL("../api/cron-social.ts", import.meta.url), "utf8");
assert.match(cron, /SOCIAL_PILOT_PROFILE_ID: process\.env\.SOCIAL_PILOT_PROFILE_ID/);
assert.match(cron, /SOCIAL_PILOT_MAX_DAILY: process\.env\.SOCIAL_PILOT_MAX_DAILY/);
assert.match(cron, /socialSafeModeState\(env\)/);
console.log("Production social pilot: scope, daily cap and stale-post protection PASS");
