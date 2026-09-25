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
console.log("Asset Intelligence reuse: PASS");
