import assert from "node:assert/strict";
import fs from "node:fs";
import {
  evaluateReferenceImage,
  imageDimensions,
  MIN_REFERENCE_COUNT,
  MAX_REFERENCE_COUNT,
  ONBOARDING_REFERENCE_COUNT,
  referenceReadiness,
  SOUL_ID_PRODUCTION_REFERENCE_COUNT,
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
assert.equal(ONBOARDING_REFERENCE_COUNT,3);
assert.equal(MIN_REFERENCE_COUNT,20);
assert.equal(SOUL_ID_PRODUCTION_REFERENCE_COUNT,20);
assert.equal(MAX_REFERENCE_COUNT,80);
assert.equal(referenceReadiness({validCount:2,totalCount:2}),"REFERENCES_INSUFFICIENT");
assert.equal(referenceReadiness({validCount:3,totalCount:3}),"ONBOARDING_MINIMUM");
assert.equal(referenceReadiness({validCount:19,totalCount:19}),"ONBOARDING_MINIMUM");
assert.equal(referenceReadiness({validCount:20,totalCount:20}),"READY_FOR_SOUL_ID");
assert.equal(referenceReadiness({validCount:18,totalCount:20,rejectedCount:2}),"REFERENCES_QUALITY_REVIEW");

const handler = fs.readFileSync("cloudflare/personal-brand-reference.ts","utf8");
assert.match(handler,/owner_auth_user_id/, "reference runtime must remain owner scoped");
assert.match(handler,/profile_type='PERSONAL_BRAND'/, "reference runtime must be Personal Brand only");
assert.match(handler,/requiresExplicitConfirmation:\s*true/, "Soul ID preflight must require explicit confirmation");
assert.match(handler,/SOUL_ID_PRODUCTION_REFERENCE_COUNT/, "Soul ID runtime must enforce the 20-real-photo production gate");
assert.match(handler,/syntheticReferenceExpansionAllowed:\s*false/, "runtime must never fabricate synthetic training references to reach 20");
assert.match(handler,/providerCallExecuted:\s*false/, "preflight must prove no provider call occurred");
const preflightSource = handler.slice(handler.indexOf("export async function handleSoulIdPreflight"), handler.indexOf("export async function handleSoulIdCreate"));
assert.doesNotMatch(preflightSource,/createHiggsfieldSoulId\(/, "non-billable preflight must not create a Soul ID");
assert.match(handler,/export async function handleSoulIdCreate/, "billable Soul ID creation route must exist behind explicit confirmation");
assert.match(handler,/body\.confirmed !== true/, "billable Soul ID creation must require explicit confirmation");
assert.match(handler,/model_version:\s*"v2"/, "Soul ID metering metadata must record v2");
assert.match(handler,/usage\.markProviderStarted/, "billable call must reserve provider cost before provider execution");
assert.match(handler,/usage\.reconcileProviderCostAttempt/, "provider cost must reconcile after Soul ID creation");
assert.match(handler,/usage\.commitUsage/, "successful Soul ID creation must commit logical usage");
assert.doesNotMatch(preflightSource,/api\.higgsfield\.ai|createHiggsfieldSoulId/, "preflight must remain non-billable and provider-free");
assert.match(handler,/projectedOperationCostUsd:\s*HIGGSFIELD_SOUL_TRAINING_RESERVE_USD/, "Soul ID preflight must account for the expected provider reserve");
assert.match(handler,/costBucket:\s*"HIGGSFIELD"/, "Soul ID preflight must use the Higgsfield budget bucket");

const ui = fs.readFileSync("src/components/personal-brand-visual-identity-panel.tsx","utf8");
assert.match(ui,/reference-images/, "Personal Brand UI must manage reference images");
assert.match(ui,/3 foto reali servono solo per completare l’onboarding/, "UI must explain that 3 photos are onboarding only");
assert.match(ui,/almeno \{required\} foto reali valide/, "UI must communicate the production-ready threshold");
assert.match(ui,/Non vengono generate foto artificiali/, "UI must explicitly reject synthetic reference expansion");
assert.match(ui,/soul-id\/preflight/, "Personal Brand UI must expose non-billable Soul ID readiness");
assert.doesNotMatch(ui,/soul-id\/create|createHiggsfieldSoulId/, "UI must not expose billable Soul ID creation yet");

const entry = fs.readFileSync("cloudflare/entry.ts","utf8");
assert.match(entry,/\/api\/personal-brand\/reference-images/);
assert.match(entry,/\/api\/personal-brand\/soul-id\/preflight/);
assert.match(entry,/\/api\/personal-brand\/soul-id\/create/);

console.log("Personal Brand reference + Soul ID preflight: PASS");
