import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { autoReelPilotAllowed, enqueueAutoReelPilot, reviewAutoReelPilot } from "../api/_lib/reel/auto-reel.js";

const profileId = "73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
assert.equal(autoReelPilotAllowed({}), false, "default off");
assert.equal(autoReelPilotAllowed({ AUTO_REEL_PILOT_ENABLED:"true", DATABASE_URL:"db", OPENAI_API_KEY:"key" }), false, "profile required");
assert.equal(autoReelPilotAllowed({ AUTO_REEL_PILOT_ENABLED:"true", SOCIAL_PILOT_PROFILE_ID:profileId, DATABASE_URL:"db" }), false, "API key required");
assert.equal(autoReelPilotAllowed({ AUTO_REEL_PILOT_ENABLED:"true", SOCIAL_PILOT_PROFILE_ID:profileId, DATABASE_URL:"db", OPENAI_API_KEY:"key" }), true);
assert.deepEqual(await enqueueAutoReelPilot({}), { queued:false,reason:"AUTO_REEL_PILOT_DISABLED" });
assert.deepEqual(await reviewAutoReelPilot({}), { reviewed:0,reason:"AUTO_REEL_PILOT_DISABLED" });

const auto = readFileSync(new URL("../api/_lib/reel/auto-reel.ts", import.meta.url), "utf8");
assert.match(auto, /v\.approval_mode='MANUAL'/);
assert.match(auto, /v\.qa_status='PASS'/);
assert.match(auto, /v\.qa_fingerprint=v\.approved_fingerprint/);
assert.match(auto, /c\.status='ACTIVE'/);
assert.match(auto, /created_at > now\(\)-interval '7 days'/);
assert.match(auto, /budget\.remainingEur < 3 \|\| budget\.otherAiRemainingEur < 3/);
assert.match(auto, /and video\.quality_status='PASS'/);
assert.match(auto, /and video\.identity_status='NOT_REQUIRED'/);
assert.match(auto, /and v\.qa_status='PENDING'/);
assert.match(auto, /actorType: "AUTOPILOT"/);
assert.match(auto, /if \(qa\.overallStatus !== "PASS"\)/);
assert.doesNotMatch(auto, /auto_approve_content_variant/);
assert.doesNotMatch(auto, /insert into public\.publication_jobs/);
assert.match(auto, /REEL_QA_PASS_AWAITING_USER_REVIEW/);
assert.match(auto, /AUTO_REEL_PILOT_DISABLED/);

const jobs = readFileSync(new URL("../api/_lib/reel/render-jobs.ts", import.meta.url), "utf8");
assert.match(jobs, /'PENDING','REVIEW_REQUIRED','PENDING',\s*'MANUAL'/);
assert.doesNotMatch(jobs, /source\.approval_mode='AUTO'/);
assert.doesNotMatch(jobs, /then 'AUTO' else 'MANUAL' end/);
assert.match(jobs, /'MANUAL'/);
const route = readFileSync(new URL("../api/render.ts", import.meta.url), "utf8");
assert.match(route, /if \(!cronAuthorized\(req\)\) return res\.status\(401\)/);
assert.match(route, /const autoQa = await reviewAutoReelPilot\(process\.env\)/);
assert.match(route, /const autoEnqueue = await enqueueAutoReelPilot\(process\.env\)/);
console.log("Bounded weekly Reel generation and mandatory owner review: PASS");
