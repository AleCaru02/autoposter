import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolveGbpDailyDraftConfig} from "../api/_lib/gbp-daily-draft.js";

const id="73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
assert.deepEqual(resolveGbpDailyDraftConfig({GBP_DAILY_DRAFT_ENABLED:"false",GBP_DAILY_PROFILE_ID:id,SOCIAL_PILOT_PROFILE_ID:id}),{allowed:false,reason:"DISABLED"});
assert.deepEqual(resolveGbpDailyDraftConfig({GBP_DAILY_DRAFT_ENABLED:"true",GBP_DAILY_PROFILE_ID:id,SOCIAL_PILOT_PROFILE_ID:"other"}),{allowed:false,reason:"INVALID_PROFILE_SCOPE"});
assert.deepEqual(resolveGbpDailyDraftConfig({GBP_DAILY_DRAFT_ENABLED:"true",GBP_DAILY_PROFILE_ID:"unknown",SOCIAL_PILOT_PROFILE_ID:"unknown"}),{allowed:false,reason:"INVALID_PROFILE_SCOPE"});
assert.deepEqual(resolveGbpDailyDraftConfig({GBP_DAILY_DRAFT_ENABLED:"true",GBP_DAILY_PROFILE_ID:id,SOCIAL_PILOT_PROFILE_ID:id}),{allowed:true,profileId:id});

const cron=readFileSync("api/cron-gbp-daily.ts","utf8");
assert.match(cron,/providerFilter:"GBP"/);
assert.match(cron,/maxGenerations:1/);
assert.match(cron,/generateImagesBeforeApproval:true/);
assert.match(cron,/dailyGbpSchedule:true/);
assert.match(cron,/pendingOwnerReview/);
assert.doesNotMatch(cron, /processDuePublications|executeProviderPublish/);
const strategy=readFileSync("api/_lib/autopilot.ts","utf8");
assert.match(strategy,/REQUIRE_OWNER_REVIEW = true/);
assert.match(strategy,/posts_per_week=7,timezone='Europe\/Rome'/);
assert.match(strategy,/provider='GBP'/);
assert.match(strategy,/provider::text=/);
const serialized=readFileSync("api/_lib/autopilot-serialized.ts","utf8");
assert.match(serialized,/and \(\$2::text is null or conn.provider::text=\$2::text\)/);
assert.match(serialized,/options.generateImagesBeforeApproval===true/);

const vercel=JSON.parse(readFileSync("vercel.json","utf8"));
assert.equal(vercel.crons.filter((x:{path:string})=>x.path==="/api/cron-gbp-daily").length,1);
console.log("GBP daily draft isolation and owner-review tests: PASS");
