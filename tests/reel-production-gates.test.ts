import assert from "node:assert/strict";
import {prepareReelForReview,approveReelForPublishing} from "../api/_lib/reel-production-gates.js";
const strategy={profileId:"p1",audience:"Italian small businesses",topic:"Your website loses clients",
 problem:"Slow pages reduce enquiries",solution:"Show a fast mobile demo",callToAction:"Request a free preview",
 caption:"See the free preview",narrationVoice:"it-IT"};
const assets=Object.fromEntries([1,2,3,4].map(n=>["scene-"+n,{licensed:true,available:true}]));
const base={strategy,assets,monthlySpentEur:27,estimatedAdditionalEur:2,narrationReady:true,subtitlesReady:true};
const ready=prepareReelForReview(base);
assert.equal(ready.status,"AWAITING_APPROVAL");
assert.equal(ready.plan.scenes.length,4);
assert.equal(approveReelForPublishing({status:ready.status,explicitHumanApproval:false,videoQaPassed:true,budgetReconciled:true}),false);
assert.equal(approveReelForPublishing({status:ready.status,explicitHumanApproval:true,videoQaPassed:true,budgetReconciled:true}),true);
assert.equal(prepareReelForReview({...base,monthlySpentEur:29}).status,"BLOCKED");
assert.equal(prepareReelForReview({...base,narrationReady:false}).status,"BLOCKED");
assert.equal(prepareReelForReview({...base,subtitlesReady:false}).status,"BLOCKED");
assert.equal(prepareReelForReview({...base,assets:{}}).status,"BLOCKED");
console.log("Reel production gates: PASS");
