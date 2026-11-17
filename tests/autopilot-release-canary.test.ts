import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTO_ELIGIBLE_PROFILE_SQL, breakerOneRetestAllowed } from "../api/_lib/autopilot-serialized.js";

assert.match(AUTO_ELIGIBLE_PROFILE_SQL, /conn\.status='ACTIVE'/);
assert.match(AUTO_ELIGIBLE_PROFILE_SQL, /conn\.token_reference is not null/);
assert.match(AUTO_ELIGIBLE_PROFILE_SQL, /conn\.provider_account_id is not null/);
assert.match(AUTO_ELIGIBLE_PROFILE_SQL, /length\(btrim\(conn\.provider_account_id\)\)>0/);
assert.match(AUTO_ELIGIBLE_PROFILE_SQL, /conn\.last_validated_at > now\(\)-interval '48 hours'/);
assert.match(AUTO_ELIGIBLE_PROFILE_SQL, /conn\.provider='GBP' or conn\.expires_at is null or conn\.expires_at>now\(\)/);
assert.match(AUTO_ELIGIBLE_PROFILE_SQL, /\(\$1::uuid is null or p\.id=\$1::uuid\)/);
const profileId = "73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
const other = "4b65abfd-cf91-4556-881d-9be448690fae";
const cutoffUtc = "2026-11-17T00:00:00.000Z";
const now = new Date("2026-11-17T01:01:00.000Z");
const original = [
  { state:"RELEASED",reason:"OPENAI_EDITORIAL_QUALITY_BLOCKED",created_at:"2026-11-16T16:00:00.000Z" },
  { state:"RELEASED",reason:"AUTOPILOT_REPETITION_BLOCKED:NARRATIVE_STRUCTURE_OVERUSED",created_at:"2026-11-16T15:00:00.000Z" },
  { state:"RELEASED",reason:"OPENAI_UNEXPECTED_CAROUSEL_SLIDES",created_at:"2026-11-16T14:00:00.000Z" },
];
const args = {profileId,configuredProfileId:profileId,cutoffUtc,recent:original,now};
assert.equal(breakerOneRetestAllowed(args), true, "one canary after code repair");
assert.equal(breakerOneRetestAllowed({...args, configuredProfileId:other}), false,"another account never inherits the bypass");
assert.equal(breakerOneRetestAllowed({...args, cutoffUtc:"bad"}), false,"invalid release timestamp blocked");
assert.equal(breakerOneRetestAllowed({...args, cutoffUtc:"2026-11-17T02:00:00.000Z"}), false,"future cutoff blocked");
assert.equal(breakerOneRetestAllowed({...args, now:new Date("2026-11-19T00:00:00.000Z")}), false,"release override expires");
assert.equal(breakerOneRetestAllowed({...args, recent:[{...original[0],created_at:"2026-11-17T00:30:00.000Z"},...original.slice(1)]}), false,"one real attempt immediately consumes canary");
assert.equal(breakerOneRetestAllowed({...args, recent:[{...original[0],state:"COMMITTED"},...original.slice(1)]}), false,"ordinary breaker closes on success");
assert.equal(breakerOneRetestAllowed({...args, recent:[original[0]]}), false,"insufficient history does not need a bypass");
const serialized = readFileSync(new URL("../api/_lib/autopilot-serialized.ts", import.meta.url), "utf8");
assert.match(serialized, /breakerOneRetestAllowed\(/);
assert.match(serialized, /if\(failureBreakerOpen\(recentAttempts\.rows\)&&!breakerOneRetestAllowed/);
assert.match(serialized, /AUTOPILOT_FAILURE_BREAKER_OPEN/);
const cron = readFileSync(new URL("../api/cron.ts",import.meta.url),"utf8");
assert.match(cron,/AUTOPILOT_RETEST_PROFILE_ID: process\.env\.AUTOPILOT_RETEST_PROFILE_ID/);
assert.match(cron,/errorCodes:/);
assert.doesNotMatch(cron,/console\.log\([^)]*autopilot\.errors\)/);
console.log("Verified only + single safe post-release AI retest: PASS");
