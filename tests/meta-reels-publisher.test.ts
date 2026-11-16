import assert from "node:assert/strict";
import { classifyProviderFailure, validatedReelVideoUrl } from "../api/_lib/social.js";

const valid = {
  video_asset_id: "01234567-89ab-cdef-0123-456789abcdef",
  video_storage_url: "https://abc123.public.blob.vercel-storage.com/reels/example.mp4",
  video_mime_type: "video/mp4",
  video_quality_status: "PASS",
  video_identity_status: "NOT_REQUIRED",
  video_width: 1080,
  video_height: 1920,
};
assert.equal(validatedReelVideoUrl(valid), valid.video_storage_url);
assert.throws(() => validatedReelVideoUrl({ ...valid, video_quality_status: "PENDING" }), /REEL_MEDIA_NOT_VERIFIED/);
assert.throws(() => validatedReelVideoUrl({ ...valid, video_identity_status: "PENDING" }), /REEL_MEDIA_NOT_VERIFIED/);
assert.throws(() => validatedReelVideoUrl({ ...valid, video_width: 720 }), /REEL_MEDIA_NOT_VERIFIED/);
assert.throws(() => validatedReelVideoUrl({ ...valid, video_storage_url: "http://abc123.public.blob.vercel-storage.com/reels/video.mp4" }), /REEL_MEDIA_URL_UNTRUSTED/);
assert.throws(() => validatedReelVideoUrl({ ...valid, video_storage_url: "https://evil.example/reels/video.mp4" }), /REEL_MEDIA_URL_UNTRUSTED/);
assert.throws(() => validatedReelVideoUrl({ ...valid, video_storage_url: "https://abc123.public.blob.vercel-storage.com/reels/video.png" }), /REEL_MEDIA_URL_UNTRUSTED/);
const pending = classifyProviderFailure("INSTAGRAM", "REEL_PUBLISH", 400, true, { providerCode: 9007, providerSubcode: 2207027 });
assert.equal(pending.code, "INSTAGRAM_MEDIA_NOT_READY");
assert.equal(pending.retryable, true);
assert.equal(pending.outcomeUnknown, false);
const uncertain = classifyProviderFailure("INSTAGRAM", "REEL_PUBLISH", 400, true, { providerCode: 4, providerSubcode: 2207051 });
assert.equal(uncertain.code, "PROVIDER_OUTCOME_UNKNOWN");
assert.equal(uncertain.retryable, false);
assert.equal(uncertain.outcomeUnknown, true);
const timeout = classifyProviderFailure("FACEBOOK", "REEL_FINISH", null, true);
assert.equal(timeout.outcomeUnknown, true);
console.log("meta-reels-publisher: PASS");
