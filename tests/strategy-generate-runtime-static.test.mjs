import assert from "node:assert/strict";
import fs from "node:fs";
const workflow=fs.readFileSync(".github/workflows/audit-viewer-runtime.yml","utf8");
const controller=fs.readFileSync("tests/strategy-generate-qa-controller.mjs","utf8");
const wrangler=fs.readFileSync("tests/wrangler.strategy-generate-runtime.jsonc","utf8");
assert.match(workflow,/verify\/strategy-generate-gating-runtime/);assert.match(workflow,/6d9489cc79141dde1d243ce8a6e4703fd1b1ae27/);assert.match(workflow,/STRATEGY_GENERATE_PREVIEW_ISOLATION: PASS/);assert.match(workflow,/Strategy generation authenticated runtime/);assert.match(workflow,/if:\s*always\(\)/);assert.doesNotMatch(workflow,/\bwrangler\s+deploy\b/i);assert.doesNotMatch(workflow,/actions\/upload-artifact/i);
assert.match(controller,/editorial-agents\/strategy-plan|STRATEGY_GENERATE_QA_TOKEN/);assert.match(controller,/promptLogging:\s*false/);
assert.match(wrangler,/"preview_urls"\s*:\s*true/);assert.doesNotMatch(wrangler,/"routes"\s*:/);
console.log("Strategy generate runtime static safety: PASS");
