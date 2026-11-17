import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contentQaMediaPreflight } from "../api/_lib/content-qa.js";

const reel={ format:"REEL", image_asset_id:"cover", video_asset_id:"video" } as never;
const cover={id:"cover",width:1080,height:1920};
const video={
  id:"video",width:1080,height:1920,kind:"VIDEO",mime_type:"video/mp4",
  quality_status:"PASS",identity_status:"NOT_REQUIRED",
  storage_url:"https://abc123.public.blob.vercel-storage.com/reels/verified.mp4",
};
const check=(v:unknown=reel, media:unknown[]=[cover,video])=>
  contentQaMediaPreflight(v as never, [], media as never);
assert.equal(check(),null, "validated video + cover may proceed to full paid QA");
assert.equal(check({...reel, video_asset_id:null}),"CONTENT_QA_REEL_VIDEO_NOT_VERIFIED");
assert.equal(check(reel,[cover]),"CONTENT_QA_REEL_VIDEO_NOT_VERIFIED");
assert.equal(check(reel,[cover,{...video,quality_status:"PENDING"}]),"CONTENT_QA_REEL_VIDEO_NOT_VERIFIED");
assert.equal(check(reel,[cover,{...video,quality_status:"BLOCK"}]),"CONTENT_QA_REEL_VIDEO_NOT_VERIFIED");
assert.equal(check(reel,[cover,{...video,kind:"IMAGE"}]),"CONTENT_QA_REEL_VIDEO_NOT_VERIFIED");
assert.equal(check(reel,[cover,{...video,mime_type:"video/webm"}]),"CONTENT_QA_REEL_VIDEO_NOT_VERIFIED");
assert.equal(check(reel,[cover,{...video,identity_status:"PENDING"}]),"CONTENT_QA_REEL_VIDEO_NOT_VERIFIED");
assert.equal(check(reel,[cover,{...video,width:720}]),"CONTENT_QA_REEL_VIDEO_NOT_VERIFIED");
assert.equal(check(reel,[cover,{...video,storage_url:"https://evil.example/video.mp4"}]),"CONTENT_QA_REEL_VIDEO_URL_INVALID");
assert.equal(check(reel,[cover,{...video,storage_url:"http://abc123.public.blob.vercel-storage.com/reels/verified.mp4"}]),"CONTENT_QA_REEL_VIDEO_URL_INVALID");
assert.equal(check(reel,[cover,{...video,storage_url:"https://abc123.public.blob.vercel-storage.com/reels/verified.png"}]),"CONTENT_QA_REEL_VIDEO_URL_INVALID");
assert.equal(check({...reel, image_asset_id:null}),"CONTENT_QA_IMAGE_REQUIRED", "cover QA remains mandatory");

const source=readFileSync(new URL("../api/_lib/content-qa.ts",import.meta.url),"utf8");
assert.match(source,/video_asset_id::text/);
assert.match(source,/variants\[0\]\.video_asset_id/);
assert.match(source,/kind,provider,model,storage_url,mime_type/);
assert.match(source,/reelVideo:variant\.video_asset_id/);
assert.match(source,/const mediaProblem = contentQaMediaPreflight\(variant, slides, assets\)/);
const migration=readFileSync(new URL("../db/migrations/20261117_reel_video_qa_invalidation.sql",import.meta.url),"utf8");
assert.match(migration,/NEW\.image_asset_id,NEW\.video_asset_id,NEW\.eligible/);
assert.match(migration,/OLD\.image_asset_id,OLD\.video_asset_id,OLD\.eligible/);
console.log("REEL technical media, QA fingerprint and approval invalidation: PASS");
