import assert from "node:assert/strict";
import {reviewPremiumCloudReel} from "../api/_lib/premium-cloud-reel-policy.js";
const scene=(id:string,assetKind:"AI_VIDEO"|"STILL",durationSeconds:number)=>({
 id,durationSeconds,assetKind,assetReady:true,commercialRightsVerified:true,visualQaPassed:true});
const good={scenes:[scene("a","AI_VIDEO",12),scene("b","AI_VIDEO",12),scene("c","STILL",6)],
 voiceReady:true,captionsReady:true,approved:true,actualCostEur:1.5,reservedCostEur:2,monthCommittedEur:29};
assert.equal(reviewPremiumCloudReel(good).ready,true);
assert.ok(reviewPremiumCloudReel({...good,scenes:[scene("a","STILL",30)]}).errors.includes("NOT_PREMIUM_VIDEO_MOTION"));
assert.ok(reviewPremiumCloudReel({...good,approved:false}).errors.includes("HUMAN_APPROVAL_REQUIRED"));
assert.ok(reviewPremiumCloudReel({...good,actualCostEur:3}).errors.includes("COST_NOT_RECONCILED"));
assert.ok(reviewPremiumCloudReel({...good,monthCommittedEur:31}).errors.includes("COST_NOT_RECONCILED"));
assert.ok(reviewPremiumCloudReel({...good,voiceReady:false}).errors.includes("VOICE_NOT_READY"));
console.log("Premium cloud Reel policy passed");
