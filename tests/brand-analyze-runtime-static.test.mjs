import assert from "node:assert/strict";
import fs from "node:fs";
const workflow=fs.readFileSync(".github/workflows/audit-viewer-runtime.yml","utf8");
const controller=fs.readFileSync("tests/brand-analyze-qa-controller.mjs","utf8");
const wrangler=fs.readFileSync("tests/wrangler.brand-analyze-runtime.jsonc","utf8");
assert.match(workflow,/verify\/brand-analyze-gating-runtime/);assert.match(workflow,/e2f2c7ffa20720ec304fda7a533c5e088b11edfa/);assert.match(workflow,/BRAND_ANALYZE_PREVIEW_ISOLATION: PASS/);assert.match(workflow,/Brand analysis authenticated runtime/);assert.match(workflow,/if:\s*always\(\)/);assert.doesNotMatch(workflow,/\bwrangler\s+deploy\b/i);assert.doesNotMatch(workflow,/actions\/upload-artifact/i);
assert.match(controller,/onboarding-analyze|BRAND_ANALYZE_QA_TOKEN/);assert.match(controller,/promptLogging:\s*false/);
assert.match(wrangler,/"preview_urls"\s*:\s*true/);assert.doesNotMatch(wrangler,/"routes"\s*:/);
console.log("Brand analyze runtime static safety: PASS");
