import assert from "node:assert/strict";
import { assetReusePriority, findReusableAsset, masterPlacementClass, rankReusableAssets, visualFingerprint } from "../api/_lib/asset-intelligence.js";

assert.equal(masterPlacementClass("INSTAGRAM", "STORY"), "VERTICAL_9_16");
assert.equal(masterPlacementClass("FACEBOOK", "POST"), "FEED_4_5");
assert.equal(masterPlacementClass("LINKEDIN", "POST"), "SQUARE_1_1");

const a = await visualFingerprint({ profileId: "11111111-1111-4111-8111-111111111111", provider: "INSTAGRAM", format: "POST", visualBrief: "  Casa   moderna " });
const b = await visualFingerprint({ profileId: "11111111-1111-4111-8111-111111111111", provider: "FACEBOOK", format: "POST", visualBrief: "casa moderna" });
const c = await visualFingerprint({ profileId: "22222222-2222-4222-8222-222222222222", provider: "FACEBOOK", format: "POST", visualBrief: "casa moderna" });
assert.equal(a, b, "IG and FB feed may share one 4:5 master visual");
assert.notEqual(a, c, "assets must remain profile isolated");

const real = { id:"r", profile_id:"p", source:"REAL_UPLOAD", kind:"IMAGE", storage_url:"data:image/png;base64,aaa", mime_type:"image/png", metadata:{ visual_fingerprint:a }, created_at:"2026-09-20" };
const generated = { id:"g", profile_id:"p", source:"GEMINI_FLASH", kind:"IMAGE", storage_url:"data:image/png;base64,bbb", mime_type:"image/png", metadata:{ visual_fingerprint:a }, created_at:"2026-09-25" };
assert.ok(assetReusePriority(real) < assetReusePriority(generated));
const ranked = rankReusableAssets([generated, real]);
assert.equal(ranked[0]?.id, "r");
assert.equal(findReusableAsset(ranked, a)?.id, "r");
assert.equal(findReusableAsset([{ ...real, metadata:{ visual_fingerprint:a, reuse_allowed:false } }], a), null);

console.log("Asset intelligence exact reuse: PASS");
