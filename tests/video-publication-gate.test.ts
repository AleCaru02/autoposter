import assert from "node:assert/strict";
import { buildVideoPlan } from "../api/_lib/video-studio.js";
import { videoPublicationBlockers } from "../api/_lib/video-publication-gate.js";
const plan=buildVideoPlan({profileId:"profile-1",topic:"Siti web",problem:"Poche richieste",solution:"Una landing chiara",callToAction:"Bozza gratuita"});
const evidence={
  mp4Url:"https://example.com/rendered.mp4",mp4MimeType:"video/mp4",
  renderedDurationMs:30000,videoWidth:1080,videoHeight:1920,
  reviewApproved:true,reviewedPlanFingerprint:"sha256:123",currentPlanFingerprint:"sha256:123",
  socialAccountConnected:true,budgetSpentEur:0,assets:{}
};
assert.deepEqual(videoPublicationBlockers(plan,evidence),[]);
assert.ok(videoPublicationBlockers(plan,{...evidence,reviewApproved:false}).includes("MANUAL_APPROVAL_REQUIRED"));
assert.ok(videoPublicationBlockers(plan,{...evidence,reviewedPlanFingerprint:"old"}).includes("APPROVAL_STALE"));
assert.ok(videoPublicationBlockers(plan,{...evidence,mp4Url:"file:///private.mp4"}).includes("PUBLIC_MP4_URL_REQUIRED"));
assert.ok(videoPublicationBlockers(plan,{...evidence,videoWidth:720}).includes("INVALID_RENDER_RESOLUTION"));
assert.ok(videoPublicationBlockers(plan,{...evidence,budgetSpentEur:30,assets:{},socialAccountConnected:false}).includes("INSTAGRAM_CONNECTION_REQUIRED"));
assert.ok(videoPublicationBlockers(plan,{...evidence,scheduledAt:"2000-01-01T00:00:00Z"}).includes("INVALID_SCHEDULE"));
console.log("Video publication gates: passed");
