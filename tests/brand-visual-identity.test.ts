import assert from "node:assert/strict";
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
console.log("Brand visual identity: active palette and controlled typography fallback: PASS");
