import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {brandTextStyle,confirmedBrandLogoId,verifiedBrandLogoDataUrl} from "../api/_lib/brand-visual-assets.js";

const logoId="00000000-0000-4000-8000-000000000042";
assert.equal(confirmedBrandLogoId({brandKitApproved:true,logoAssetId:logoId}),logoId);
assert.equal(confirmedBrandLogoId({brandKitApproved:false,logoAssetId:logoId}),null);
assert.equal(confirmedBrandLogoId({brandKitApproved:true,logoAssetId:"invalid"}),null);
const logo="data:image/png;base64,"+"AA".repeat(40);
assert.equal(verifiedBrandLogoDataUrl({storage_url:logo,mime_type:"image/png"}),logo);
assert.equal(verifiedBrandLogoDataUrl({storage_url:logo,mime_type:"image/svg+xml"}),null);
assert.equal(verifiedBrandLogoDataUrl({storage_url:"https://localhost/logo.png",mime_type:"image/png"}),null);
assert.equal(verifiedBrandLogoDataUrl({storage_url:"data:image/png;base64,<svg>",mime_type:"image/png"}),null);
const light=brandTextStyle({primary:"#112233",secondary:"#445566",accent:"#AA8822",neutral:"#FFFFFF"});
assert.equal(light.panelColor,"#FFFFFF");
assert.equal(light.brandColor,"#112233");
assert.equal(light.textColor,"#172430");
const dark=brandTextStyle({primary:"#FFFFFF",secondary:"#777777",accent:"#111111",neutral:"#000000"});
assert.equal(dark.panelColor,"#000000");
assert.equal(dark.textColor,"#FFFFFF");
const all=["api/generate-image.ts","cloudflare/worker.ts","api/_lib/autopilot.ts"];
for(const path of all) {
  const source=readFileSync(new URL("../"+path,import.meta.url),"utf8");
  assert.match(source,/confirmedBrandLogoId/);
  assert.match(source,/verifiedBrandLogoDataUrl/);
  assert.match(source,/brandTextStyle/);
  assert.match(source,/logoDataUrl/);
  assert.match(source,/profile_id/);
}
for(const path of ["api/onboarding-analyze.ts","cloudflare/onboarding-analyze.ts"]){
  const source=readFileSync(new URL("../"+path,import.meta.url),"utf8");
  assert.match(source,/brandKitApproved && Array\.isArray\(existingVisualIdentity\.observedColors\)/);
  assert.match(source,/brandKitApproved && Array\.isArray\(existingVisualIdentity\.observedFonts\)/);
}
const page=readFileSync(new URL("../src/pages/brand-page.tsx",import.meta.url),"utf8");
assert.match(page,/Brand Kit per post e caroselli/);
assert.match(page,/Conferma Brand Kit/);
assert.match(page,/logoAssetId/);
assert.match(page,/brandKitApproved/);
const composer=readFileSync(new URL("../api/_lib/deterministic-text-compositor.ts",import.meta.url),"utf8");
assert.match(composer,/logoMarkup/);
assert.match(composer,/logoDataUrl/);
console.log("Brand Kit: PASS — approved palette, same-profile logo, visual compositor and rescan protection.");
