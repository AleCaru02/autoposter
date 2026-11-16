import assert from "node:assert/strict";
import { classifyProviderFailure, validatedReelVideoUrl, publishInstagramReel, publishFacebookReel } from "../api/_lib/social.js";

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

const variant = {
  ...valid,
  format: "REEL", hook: "Consigli immobiliari", caption: "Tre consigli pratici per proprietari a Milano",
  cta: "Segui per approfondire", hashtags: ["#milano"], provider: "INSTAGRAM",
};
const connection = { provider_account_id: "123456" };
const bundle = { accessToken: "fake-test-token" };
const env = { META_GRAPH_VERSION: "v26.0" };
const originalFetch = globalThis.fetch;
let requests: string[] = [];
let boundaryCalls = 0;
try {
  globalThis.fetch = (async (url: URL | string) => {
    const u = new URL(String(url));
    requests.push(u.hostname + u.pathname);
    if (u.pathname === "/v26.0/123456/media") return Response.json({ id: "555" });
    if (u.pathname === "/v26.0/555") return Response.json({ status_code: "FINISHED" });
    if (u.pathname === "/v26.0/123456/media_publish") return Response.json({ id: "777" });
    throw new Error("Unexpected Instagram endpoint: " + u.pathname);
  }) as typeof fetch;
  const published = await publishInstagramReel(variant as never, connection as never, bundle, env, async () => { boundaryCalls++; });
  assert.equal(published.externalId, "777");
  assert.equal(boundaryCalls, 1, "only one externally visible publication claim");
  assert.equal(requests.filter(p => p.endsWith("/media_publish")).length, 1);

  requests = [];
  boundaryCalls = 0;
  globalThis.fetch = (async (url: URL | string) => {
    const u = new URL(String(url));
    requests.push(u.hostname + u.pathname);
    if (u.pathname === "/v26.0/123456/video_reels" && requests.length === 1)
      return Response.json({ video_id: "444", upload_url: "https://rupload.facebook.com/video-upload/v26.0/444" });
    if (u.hostname === "rupload.facebook.com") return Response.json({ success: true });
    if (u.pathname === "/v26.0/123456/video_reels") return Response.json({ success: true, post_id: "999" });
    throw new Error("Unexpected Facebook endpoint: " + u.pathname);
  }) as typeof fetch;
  const fb = await publishFacebookReel({ ...variant, provider: "FACEBOOK" } as never, connection as never, bundle, env, async () => { boundaryCalls++; });
  assert.equal(fb.externalId, "999");
  assert.equal(boundaryCalls, 1);
  assert.equal(requests.filter(p => p.endsWith("/video_reels")).length, 2, "start and finish exactly once");

  requests = [];
  boundaryCalls = 0;
  globalThis.fetch = (async (url: URL | string) => {
    const u = new URL(String(url));
    requests.push(u.pathname);
    if (u.pathname === "/v26.0/123456/media") return Response.json({ id: "555" });
    if (u.pathname === "/v26.0/555") return Response.json({ status_code: "FINISHED" });
    if (u.pathname === "/v26.0/123456/media_publish")
      return Response.json({ error: { code: 4, error_subcode: 2207051 } }, { status: 400 });
    throw new Error("Unexpected endpoint");
  }) as typeof fetch;
  await assert.rejects(
    publishInstagramReel(variant as never, connection as never, bundle, env, async () => { boundaryCalls++; }),
    (err: unknown) => Boolean(err && typeof err === "object" && "outcomeUnknown" in err && err.outcomeUnknown === true),
    "published-but-rejected Meta response must require reconciliation rather than a duplicate retry"
  );
  assert.equal(boundaryCalls, 1);
  assert.equal(requests.filter(p => p.endsWith("/media_publish")).length, 1);
} finally {
  globalThis.fetch = originalFetch;
}
console.log("meta-reels mocked official API end-to-end: PASS");

console.log("meta-reels-publisher: PASS");
