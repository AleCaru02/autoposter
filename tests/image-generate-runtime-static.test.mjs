import assert from "node:assert/strict";
import fs from "node:fs";
const workflow=fs.readFileSync(".github/workflows/audit-viewer-runtime.yml","utf8");
const controller=fs.readFileSync("tests/image-generate-qa-controller.mjs","utf8");
const wrangler=fs.readFileSync("tests/wrangler.image-generate-runtime.jsonc","utf8");
assert.match(workflow,/verify\/image-generate-gating-runtime/);assert.match(workflow,/dbb20019c0e2d75780284b66584cf07845b21515/);assert.match(workflow,/IMAGE_GENERATE_PREVIEW_ISOLATION: PASS/);assert.match(workflow,/Image generation authenticated runtime/);assert.match(workflow,/if:\s*always\(\)/);assert.doesNotMatch(workflow,/\bwrangler\s+deploy\b/i);assert.doesNotMatch(workflow,/actions\/upload-artifact/i);
assert.match(controller,/api\/generate-image/);assert.match(controller,/api\/autopilot\/run/);assert.match(controller,/IMAGE_GENERATE_QA_TOKEN/);assert.match(controller,/promptLogging:\s*false/);assert.match(controller,/ASSET_FAILURE/);
assert.match(wrangler,/"preview_urls"\s*:\s*true/);assert.doesNotMatch(wrangler,/"routes"\s*:/);
console.log("Image generate runtime static safety: PASS");
