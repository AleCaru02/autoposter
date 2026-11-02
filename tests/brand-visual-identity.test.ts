import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeBrandVisualIdentity } from "../api/_lib/brand-visual-identity.js";
import { findReusableAsset, type ReusableAssetCandidate } from "../api/_lib/asset-intelligence.js";

const observed=normalizeBrandVisualIdentity({observedColors:["#112233","#445566","#cc8844"],observedFonts:["DM Serif Display","Manrope"]},"Professional services");
assert.equal(observed.activeSocialPalette.source,"OBSERVED");
assert.equal(observed.activeSocialPalette.primary,"#112233");
assert.equal(observed.typography.source,"CONTROLLED_FALLBACK");
assert.deepEqual(observed.typography.observedFonts,["DM Serif Display","Manrope"]);
const fallback=normalizeBrandVisualIdentity({},"property management");
assert.equal(fallback.activeSocialPalette.source,"FALLBACK");
assert.equal(Object.values(fallback.activeSocialPalette).filter((value)=>typeof value==="string"&&value.startsWith("#")).length,4);
assert.equal(fallback.typography.renderableFont,"Inter");
const websiteObserved=normalizeBrandVisualIdentity({observedColors:["#171C21","#606971","#1B7E50","#FFFFFF"],observedFonts:["Plus Jakarta Sans"]},"property management");
assert.equal(websiteObserved.activeSocialPalette.source,"OBSERVED");
assert.deepEqual(websiteObserved.activeSocialPalette,{primary:"#171C21",secondary:"#606971",accent:"#1B7E50",neutral:"#FFFFFF",source:"OBSERVED"});
assert.deepEqual(websiteObserved.typography.observedFonts,["Plus Jakarta Sans"]);
assert.equal(websiteObserved.typography.source,"CONTROLLED_FALLBACK");

const sitePalette = ["#171C21", "#606971", "#1B7E50", "#FFFFFF"];
const manuallyBranded = normalizeBrandVisualIdentity({
  observedColors: sitePalette,
  manualColors: ["#A12244", "#E5DECF", "#336699", "#FAF8F5"],
}, "property management");
assert.equal(manuallyBranded.activeSocialPalette.source, "MANUAL");
assert.deepEqual(manuallyBranded.colors, ["#A12244", "#E5DECF", "#336699", "#FAF8F5"]);
assert.deepEqual(manuallyBranded.activeSocialPalette, {
  primary: "#A12244", secondary: "#E5DECF", accent: "#336699",
  neutral: "#FAF8F5", source: "MANUAL",
}, "the user palette must override scanned website CSS colors for all branded assets");
const ownerSingleColor = normalizeBrandVisualIdentity({ observedColors: sitePalette, manualColors: ["#E42535"] }, "property management");
assert.equal(ownerSingleColor.activeSocialPalette.primary, "#E42535", "one owner-confirmed primary color must not be discarded");
assert.equal(ownerSingleColor.activeSocialPalette.secondary, sitePalette[1]);
const observedTwo = normalizeBrandVisualIdentity({ observedColors: ["#123456", "#456789"] }, "software");
assert.equal(observedTwo.activeSocialPalette.source, "OBSERVED");
for (const color of [observedTwo.activeSocialPalette.primary, observedTwo.activeSocialPalette.secondary, observedTwo.activeSocialPalette.accent, observedTwo.activeSocialPalette.neutral]) {
  assert.ok(color && color.startsWith("#"), "every palette slot must be defined even for two detected colors");
}
const brandPage = readFileSync(new URL("../src/pages/brand-page.tsx", import.meta.url), "utf8");
assert.match(brandPage, /manualColorsSet: true/, "editing brand colors must explicitly set the owner override");
assert.match(brandPage, /manualColors: concreteColors\(draft.colors\)/);
assert.doesNotMatch(brandPage, /observedColors: concreteColors\(draft.colors\)/, "brand saves must not overwrite scan observations");
for (const entry of ["api/onboarding-analyze.ts", "cloudflare/onboarding-analyze.ts"]) {
  const source = readFileSync(new URL("../" + entry, import.meta.url), "utf8");
  assert.match(source, /const visualIdentity = \{\s*\/\/[^\n]*\n\s*\.\.\.existingVisualIdentity,/,
    entry + " must carry owner palette overrides forward on rescan");
}


const photoId = "11111111-1111-4111-8111-111111111111";
const unrelatedId = "22222222-2222-4222-8222-222222222222";
const styleBrand = normalizeBrandVisualIdentity({
  observedColors: ["#123456", "#abcdef"],
  observedFonts: ["Manrope"],
  manualFonts: ["Playfair Display"],
  preferredPhotoAssetIds: [photoId, "invalid-id", photoId],
  visualReferenceNotes: "Luce naturale, fotografia architettonica, niente stock.",
}, "Property management");
assert.deepEqual(styleBrand.fonts, ["Playfair Display"], "owner-picked font style wins over scanned CSS");
assert.equal(styleBrand.typography.requestedFont, "Playfair Display");
assert.equal(styleBrand.typography.renderableFont, "Inter", "renderer must never falsely claim that an uninstalled font is applied");
assert.equal(styleBrand.typography.source, "MANUAL_STYLE_REFERENCE");
assert.deepEqual(styleBrand.preferredPhotoAssetIds, [photoId], "only valid, distinct profile photo IDs can be pinned");
assert.match(styleBrand.visualReferenceNotes ?? "", /Luce naturale/);
const legacyBrand = normalizeBrandVisualIdentity({ observedFonts: ["Inter"] }, "Servizi");
assert.equal(legacyBrand.typography.source, "OBSERVED_RENDERABLE");
assert.deepEqual(legacyBrand.preferredPhotoAssetIds, []);
assert.equal(legacyBrand.visualReferenceNotes, null);

const sampleAsset = (id: string, props: Partial<ReusableAssetCandidate> = {}): ReusableAssetCandidate => ({
  id, name: "Foto reale di facciata con finiture moderne in zona urbana",
  kind: "IMAGE", source: "UPLOAD", provider: "REAL_ASSET",
  storage_url: "data:image/png;base64,AA==", mime_type: "image/png",
  tags: ["facciata", "moderna", "zona", "urbana"],
  metadata: { aspect_ratio: "1:1", description: "Foto reale di facciata moderna in zona urbana" },
  quality_status: "PASS", identity_status: "NOT_REQUIRED",
  ...props,
});
const brief = "Foto reale di facciata moderna in zona urbana";
const pinnedReal = sampleAsset(photoId);
assert.equal((await findReusableAsset({ visualBrief:brief, aspectRatio:"1:1", candidates:[pinnedReal] }))?.asset.id, photoId);
const unsuitable = sampleAsset(photoId, { name:"Spiaggia, palme e mare", tags:["mare","spiaggia"], metadata:{aspect_ratio:"9:16"}, quality_status:"BLOCK" });
assert.equal(await findReusableAsset({ visualBrief:brief, aspectRatio:"1:1", candidates:[unsuitable] }), null,
  "a pinned but unsuitable or blocked photo must not bypass asset QA");
const other = sampleAsset(unrelatedId);
assert.equal((await findReusableAsset({visualBrief:brief,aspectRatio:"1:1",candidates:[other]}))?.asset.id,unrelatedId,
  "standard profile asset reuse must still work without pinned matches");

const autopilotSource = readFileSync(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
assert.match(autopilotSource, /preferredCandidates=candidates.filter/, "pinned assets must be filtered inside the own-profile candidates");
assert.match(autopilotSource, /asset.provider==="REAL_ASSET" && asset.quality_status==="PASS"/);
assert.match(autopilotSource, /preferredReusable\?\?await findReusableAsset/, "unusable pinned photos must fall back to normal reuse, never force wrong material");
assert.match(autopilotSource, /brandVisual.visualReferenceNotes/, "reference notes must reach art direction");
assert.match(autopilotSource, /brandFonts:brandVisual.fonts/, "manual font style must reach the image agent");
assert.match(autopilotSource, /actualRenderFont:brandVisual.typography.renderableFont/, "audit must disclose the real font");
assert.match(autopilotSource, /'PENDING',\$\{approvalMode===/, "the Brand Kit must not auto-approve variants");

assert.match(brandPage, /manualFontsEdited: true/);
assert.match(brandPage, /manualFonts: draft.fontFamily.trim\(\)/);
assert.match(brandPage, /preferredPhotoAssetIds: draft.preferredPhotoAssetIds.slice/);
assert.match(brandPage, /visualReferenceNotes: draft.visualReferenceNotes.trim/);
assert.match(brandPage, /profileId=\$\{encodeURIComponent\(profileId\)\}&provider=REAL_ASSET/, "library list must be scoped to active profile");
assert.match(brandPage, /asset.provider === "REAL_ASSET" && asset.quality_status === "PASS"/);
assert.match(brandPage, /Libreria asset/, "reference images must come from the existing secure library");
for (const entry of ["api/onboarding-analyze.ts", "cloudflare/onboarding-analyze.ts"]) {
  const source=readFileSync(new URL("../"+entry, import.meta.url),"utf8");
  assert.match(source, /\.\.\.existingVisualIdentity/, entry+" must preserve owner font, photo and visual references after re-scan");
}

console.log("Brand visual identity: active palette and controlled typography fallback: PASS");
