import assert from "node:assert/strict";
import { findReusableAsset, visualFingerprint, type ReusableAssetCandidate } from "../api/_lib/asset-intelligence.js";

const brief = "Interno luminoso appartamento moderno soggiorno ordinato Milano";
const fingerprint = await visualFingerprint({ visualBrief: brief, aspectRatio: "1:1" });
const exact: ReusableAssetCandidate = { id: "asset-1", source: "AI_IMAGE", kind: "IMAGE", name: "master.png", storage_url: "data:image/png;base64,AAA", mime_type: "image/png", tags: ["interno", "Milano"], metadata: { visual_fingerprint: fingerprint, aspect_ratio: "1:1", visual_brief: brief } };
assert.equal((await findReusableAsset({ visualBrief: brief, aspectRatio: "1:1", candidates: [exact] }))?.reason, "EXACT_VISUAL_FINGERPRINT");
assert.equal(await findReusableAsset({ visualBrief: brief, aspectRatio: "2:3", candidates: [exact] }), null, "square assets must not be reused as Stories");

const real: ReusableAssetCandidate = { id: "asset-2", source: "USER_UPLOAD", kind: "IMAGE", name: "interno luminoso appartamento moderno soggiorno ordinato milano.jpg", storage_url: "https://asset.example/real.jpg", mime_type: "image/jpeg", tags: ["interno", "luminoso", "appartamento", "moderno", "soggiorno", "ordinato", "milano"], metadata: { aspect_ratio: "1:1" } };
assert.equal((await findReusableAsset({ visualBrief: brief, aspectRatio: "1:1", candidates: [real] }))?.reason, "REAL_ASSET_MATCH");
assert.equal(await findReusableAsset({ visualBrief: brief, aspectRatio: "1:1", candidates: [{ ...real, id: "asset-3", name: "profumo elegante flacone nero", tags: ["profumo", "flacone", "nero"] }] }), null);
assert.equal(await findReusableAsset({ visualBrief: brief, aspectRatio: "9:16", candidates: [exact] }), null, "square assets must not be reused as 9:16 Stories");
const storyFingerprint = await visualFingerprint({ visualBrief: brief, aspectRatio: "9:16" });
const story: ReusableAssetCandidate = { ...exact, id: "asset-4", metadata: { visual_fingerprint: storyFingerprint, aspect_ratio: "9:16", visual_brief: brief } };
assert.equal((await findReusableAsset({ visualBrief: brief, aspectRatio: "9:16", candidates: [story] }))?.reason, "EXACT_VISUAL_FINGERPRINT", "9:16 assets generated for Stories must be reusable with the same ratio the generator stores");
const unclassifiedReal: ReusableAssetCandidate = { ...real, id: "asset-5", metadata: {} };
assert.equal((await findReusableAsset({ visualBrief: brief, aspectRatio: "4:5", candidates: [unclassifiedReal] }))?.reason, "REAL_ASSET_MATCH", "unclassified real photos stay usable for 4:5 feed posts");
assert.equal(await findReusableAsset({ visualBrief: brief, aspectRatio: "9:16", candidates: [unclassifiedReal] }), null, "unclassified real photos are never used for vertical Stories/Reels");
console.log("Asset Intelligence reuse: PASS");
