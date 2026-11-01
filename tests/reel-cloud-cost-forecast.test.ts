import assert from "node:assert/strict";
import {estimateCloudReelBatch} from "../api/_lib/reel-cloud-cost-forecast.js";
const input={reelCount:15,secondsPerReel:5,clipsPerReel:1,usdPerSecond:.05,
  voiceUsd:1,imagesUsd:8,editingUsd:2,retryAllowanceUsd:3,usdToEur:.92};
const forecast=estimateCloudReelBatch(input);
assert.equal(forecast.videoUsd,3.75);
assert.equal(forecast.productionAuthorized,false);
assert.equal(forecast.withinThirtyEur,true);
assert.equal(estimateCloudReelBatch({...input,clipsPerReel:5}).withinThirtyEur,false);
assert.throws(()=>estimateCloudReelBatch({...input,usdToEur:0}),/INVALID_VIDEO_FORECAST/);
console.log("Cloud Reel cost forecast tests passed");
