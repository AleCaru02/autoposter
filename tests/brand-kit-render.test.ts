import assert from "node:assert/strict";
import { composeDeterministicTypography } from "../api/_lib/deterministic-text-compositor.js";

const px = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQXQAAAABJRU5ErkJggg==";
const base = {
  backgroundPngBase64: px,
  width: 1080,
  height: 1080,
  brand: "Studio Mave",
  headline: "Consigli pratici per la tua attività",
  subheadline: null,
  style: {panelColor:"#FFFFFF",textColor:"#172430",brandColor:"#112233",panelOpacity:0.95},
};
const plain = await composeDeterministicTypography(base);
const branded = await composeDeterministicTypography({...base,logoDataUrl:"data:image/png;base64,"+px});
assert.equal(plain.mimeType,"image/png");
assert.equal(branded.mimeType,"image/png");
assert.equal(plain.logoApplied,false);
assert.equal(branded.logoApplied,true);
assert.notEqual(branded.base64,plain.base64,"approved logo must affect real rendered pixels");
assert.ok(branded.base64.length > 2500);
console.log("Brand Kit visual compositor: PASS — real PNG render changes when logo is approved.");
