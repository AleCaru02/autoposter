import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluateReferenceImage,
  imageDimensions,
  MIN_REFERENCE_COUNT,
  MAX_REFERENCE_COUNT,
} from "../api/_lib/personal-brand-reference.js";

const png = new Uint8Array(24);
png.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],0);
const view = new DataView(png.buffer);
view.setUint32(16, 1200);
view.setUint32(20, 1200);
assert.deepEqual(imageDimensions(png,"image/png"), { width:1200, height:1200 });
const quality = evaluateReferenceImage(new Uint8Array([...png, ...new Uint8Array(40000)]),"image/png");
assert.equal(quality.status,"PASS");
assert.equal(quality.width,1200);
assert.equal(quality.height,1200);
assert.equal(MIN_REFERENCE_COUNT,3);
assert.equal(MAX_REFERENCE_COUNT,12);

const handler = fs.readFileSync("cloudflare/personal-brand-reference.ts","utf8");
assert.match(handler,/owner_auth_user_id/, "reference runtime must remain owner scoped");
assert.match(handler,/profile_type='PERSONAL_BRAND'/, "reference runtime must be Personal Brand only");
assert.match(handler,/requiresExplicitConfirmation:\s*true/, "Soul ID preflight must require explicit confirmation");
assert.match(handler,/providerCallExecuted:\s*false/, "preflight must prove no provider call occurred");
assert.doesNotMatch(handler,/createHiggsfieldSoulId\(/, "non-billable preflight must not create a Soul ID");
assert.doesNotMatch(handler,/api\.higgsfield\.ai/, "reference/preflight route must not call Higgsfield directly");
assert.match(handler,/projectedOperationCostUsd:\s*2\.5/, "Soul ID preflight must account for the expected provider reserve");
assert.match(handler,/costBucket:\s*"HIGGSFIELD"/, "Soul ID preflight must use the Higgsfield budget bucket");

const ui = fs.readFileSync("src/components/personal-brand-visual-identity-panel.tsx","utf8");
assert.match(ui,/reference-images/, "Personal Brand UI must manage reference images");
assert.match(ui,/soul-id\/preflight/, "Personal Brand UI must expose non-billable Soul ID readiness");
assert.doesNotMatch(ui,/soul-id\/create|createHiggsfieldSoulId/, "UI must not expose billable Soul ID creation yet");

const entry = fs.readFileSync("cloudflare/entry.ts","utf8");
assert.match(entry,/\/api\/personal-brand\/reference-images/);
assert.match(entry,/\/api\/personal-brand\/soul-id\/preflight/);

console.log("Personal Brand reference + Soul ID preflight: PASS");
