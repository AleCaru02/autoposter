import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/audit-viewer-runtime.yml", "utf8");
const controller = fs.readFileSync("tests/provider-cost-budget-qa-controller.ts", "utf8");
const runtime = fs.readFileSync("tests/provider-cost-budget-runtime.mjs", "utf8");
const wrangler = fs.readFileSync("tests/wrangler.provider-cost-runtime.jsonc", "utf8");

assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
assert.doesNotMatch(workflow, /^\s+push:/m);
assert.doesNotMatch(workflow, /^\s+pull_request:/m);
assert.match(workflow, /verify\/fase4f-provider-budget-runtime/);
assert.match(workflow, /f0abee9eb7f881c8a5d24993c9c9eee23d0937e2/);
assert.match(workflow, /wrangler\s+versions\s+upload\b/);
assert.doesNotMatch(workflow, /\bwrangler\s+(deploy|delete)\b/i);
assert.doesNotMatch(workflow, /\bwrangler\s+versions\s+deploy\b/i);
assert.match(workflow, /if:\s*always\(\)/);
assert.match(workflow, /production deployment set changed during provider-cost runtime/);
assert.doesNotMatch(workflow, /actions\/upload-artifact/i);

for (const meter of ["TextGenerationMetering", "BrandAnalysisMetering", "StrategyPlannerMetering", "ImageGenerationMetering"]) assert.match(controller, new RegExp(meter));
assert.match(controller, /PROVIDER_COST_BUDGET_REACHED/);
assert.match(controller, /apply_entitlement_package/);
assert.match(controller, /cost-smoke-/);
assert.match(controller, /cleanup-residue/);
assert.match(runtime, /providerStartsAfterDenial/);
assert.match(runtime, /tenantIsolation/);
assert.match(runtime, /directCustomerLedgerAccess/);

assert.match(wrangler, /"preview_urls"\s*:\s*true/);
assert.doesNotMatch(wrangler, /"routes"\s*:/);

console.log("FASE 4F provider-cost runtime static safety: PASS");
