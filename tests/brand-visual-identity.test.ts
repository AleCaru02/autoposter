import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeBrandVisualIdentity } from "../api/_lib/brand-visual-identity.js";

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

console.log("Brand visual identity: active palette and controlled typography fallback: PASS");
