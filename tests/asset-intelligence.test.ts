import assert from "node:assert/strict";
import fs from "node:fs";
import { findReusableAsset, visualFingerprint, type ReusableAssetCandidate } from "../api/_lib/asset-intelligence.js";

const brief = "Interno luminoso appartamento moderno soggiorno ordinato Milano";
const fingerprint = await visualFingerprint({ visualBrief: brief, aspectRatio: "1:1" });
const exact: ReusableAssetCandidate = {
  id: "11111111-1111-4111-8111-111111111111",
  source: "GOOGLE_GEMINI_IMAGE",
  kind: "IMAGE",
  name: "master.png",
  storage_url: "data:image/png;base64,AAA",
  mime_type: "image/png",
  tags: ["INSTAGRAM","POST","AI_GENERATED"],
  metadata: { visual_fingerprint: fingerprint, aspect_ratio: "1:1", visual_brief: brief },
  created_at: "2026-09-25T00:00:00Z",
};
const match = await findReusableAsset({ visualBrief: brief, aspectRatio: "1:1", candidates: [exact] });
assert.equal(match?.asset.id, exact.id);
assert.equal(match?.reason, "EXACT_VISUAL_FINGERPRINT");

const wrongAspect = await findReusableAsset({ visualBrief: brief, aspectRatio: "9:16", candidates: [exact] });
assert.equal(wrongAspect, null, "a square master must not be reused blindly as a story");

const real: ReusableAssetCandidate = {
  id: "22222222-2222-4222-8222-222222222222",
  source: "USER_UPLOAD",
  kind: "IMAGE",
  name: "interno luminoso appartamento moderno soggiorno ordinato milano.jpg",
  storage_url: "https://asset.example/real.jpg",
  mime_type: "image/jpeg",
  tags: ["interno","luminoso","appartamento","moderno","soggiorno","ordinato","milano"],
  metadata: {},
};
const realMatch = await findReusableAsset({ visualBrief: brief, aspectRatio: "1:1", candidates: [real] });
assert.equal(realMatch?.asset.id, real.id);
assert.equal(realMatch?.reason, "REAL_ASSET_MATCH");

const unrelated = await findReusableAsset({
  visualBrief: brief,
  aspectRatio: "1:1",
  candidates: [{ ...real, id: "33333333-3333-4333-8333-333333333333", name: "profumo elegante flacone nero", tags: ["profumo","fragranza","flacone","nero"] }],
});
assert.equal(unrelated, null);

const manual = fs.readFileSync("api/generate-image.ts", "utf8");
const worker = fs.readFileSync("cloudflare/worker.ts", "utf8");
const autopilot = fs.readFileSync("api/_lib/autopilot.ts", "utf8");
const store = fs.readFileSync("src/features/content/content-store.ts", "utf8");

for (const source of [manual, worker, autopilot]) {
  assert.match(source, /findReusableAsset/, "all live image paths must check reuse before provider generation");
  assert.ok(source.indexOf("findReusableAsset") < source.indexOf("generateRoutedImage"), "asset intelligence must run before paid image routing");
}
assert.match(manual, /estimatedCostUsd: 0/, "manual reuse must record zero provider spend");
assert.match(worker, /estimatedCostUsd: 0/, "Worker reuse must record zero provider spend");
assert.match(manual, /visual_fingerprint/, "new manual assets must be reusable deterministically");
assert.match(worker, /visual_fingerprint/, "new Worker assets must be reusable deterministically");
assert.match(autopilot, /visual_fingerprint/, "new Autopilot assets must be reusable deterministically");
assert.match(store, /content_variants"[\s\S]*image_asset_id/, "deleting content must check whether an asset is still shared before deletion");

console.log("Asset Intelligence reuse contract: PASS");
