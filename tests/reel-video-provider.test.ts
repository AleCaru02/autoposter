import assert from "node:assert/strict";
import {
  pollHiggsfieldReel, reelMediaPreflight, submitHiggsfieldReel,
  validateReelProviderQuote, type ReelClipRequest
} from "../api/_lib/reel-video-provider.js";

const clip:ReelClipRequest={prompt:"Una ripresa cinematografica verticale di un interno contemporaneo, senza elementi aziendali inventati.",durationSeconds:5,resolution:"720p",quotedCostUsd:2,authorizedMaxCostUsd:3};
assert.doesNotThrow(()=>validateReelProviderQuote(clip));
assert.throws(()=>validateReelProviderQuote({...clip,quotedCostUsd:0}),/QUOTE_REQUIRED/);
assert.throws(()=>validateReelProviderQuote({...clip,authorizedMaxCostUsd:1}),/BUDGET_NOT_APPROVED/);
assert.throws(()=>validateReelProviderQuote({...clip,durationSeconds:31}),/DURATION_INVALID/);
let calls=0;
const fetcher:typeof fetch=async(input,init)=>{
  calls++;
  const url=new URL(String(input));
  assert.equal(url.origin,"https://api.higgsfield.ai");
  assert.equal(init?.headers && (init.headers as Record<string,string>).Authorization,"Key key:secret");
  if(init?.method==="POST"){
    assert.equal(url.pathname,"/kling-video/v4.0/text-to-video");
    const body=JSON.parse(String(init.body));
    assert.equal(body.aspect_ratio,"9:16");
    assert.equal(body.duration,5);
    assert.equal(body.resolution,"720p");
    assert.deepEqual(Object.keys(body).sort(),["prompt","duration","resolution","aspect_ratio"].sort());
    return Response.json({request_id:"reel_job_1",status:"queued",status_url:"https://attacker.invalid/status"});
  }
  assert.equal(url.pathname,"/requests/reel_job_1/status");
  return Response.json({status:"completed",video:{url:"https://video.higgsfield.ai/clip.mp4"}});
};
await assert.rejects(()=>submitHiggsfieldReel({env:{HF_CREDENTIALS:"key:secret"},clip,fetcher}),/PROVIDER_DISABLED/);
await assert.rejects(()=>submitHiggsfieldReel({env:{HF_VIDEO_ENABLED:"true"},clip,fetcher}),/NOT_CONFIGURED/);
assert.equal(calls,0,"no request before explicit flags and credential");
const env={HF_VIDEO_ENABLED:"true",HF_CREDENTIALS:"key:secret"};
const task=await submitHiggsfieldReel({env,clip,fetcher});
assert.equal(task.requestId,"reel_job_1");
assert.equal(task.statusUrl,"https://api.higgsfield.ai/requests/reel_job_1/status");
const result=await pollHiggsfieldReel({env,requestId:task.requestId,fetcher});
assert.equal(result.status,"completed");
assert.equal(result.videoUrl,"https://video.higgsfield.ai/clip.mp4");
assert.equal(calls,2);
await assert.rejects(()=>pollHiggsfieldReel({env,requestId:"https://attacker.invalid/",fetcher}),/JOB_ID_INVALID/);
assert.equal(reelMediaPreflight({mimeType:"video/mp4",durationSeconds:5,width:1080,height:1920,videoCodec:"h264",audioCodec:"aac",sizeBytes:1_000_000}).ready,true);
assert.equal(reelMediaPreflight({mimeType:"video/webm",durationSeconds:2,width:4000,height:1920,videoCodec:"vp9",audioCodec:"opus",sizeBytes:0}).ready,false);
console.log("Higgsfield Reel provider: PASS — explicit spend approval, 9:16 submit, safe polling and media checks; no live paid API call.");
