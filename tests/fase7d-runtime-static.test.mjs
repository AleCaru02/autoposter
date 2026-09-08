import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/audit-viewer-runtime.yml", "utf8");
const runtime = fs.readFileSync("tests/audit-viewer-runtime.mjs", "utf8");
const controller = fs.readFileSync("tests/audit-viewer-qa-controller.mjs", "utf8");
const browserRuntime = fs.readFileSync("tests/audit-viewer-browser.mjs", "utf8");

assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m, "7D runtime must remain manual-only");
assert.doesNotMatch(workflow, /^\s+(push|pull_request):/m, "7D runtime must never run automatically");
assert.match(workflow, /wrangler\s+versions\s+upload\b/, "isolated preview upload missing");
assert.doesNotMatch(workflow, /\bwrangler\s+(deploy|versions\s+deploy|triggers\s+deploy)\b/i, "verifier must not mutate production deployment");
assert.match(workflow, /if:\s*always\(\)/, "always-run cleanup missing");
assert.doesNotMatch(workflow, /actions\/upload-artifact/i, "runtime evidence must not persist identity material");

assert.match(runtime, /appApi\("\/api\/content-review"/, "real content review endpoint is not exercised");
assert.match(runtime, /approval_status:\s*"APPROVED"/, "direct approval denial probe missing");
assert.match(runtime, /direct customer approval unexpectedly succeeded/, "direct approval must fail closed");
assert.match(runtime, /cross-tenant review expected 403/, "cross-tenant denial assertion missing");
assert.match(runtime, /stale approval replay expected 409/, "optimistic concurrency assertion missing");
assert.match(runtime, /contentStatus,\s*"APPROVED"/, "complete approval state assertion missing");
assert.match(runtime, /contentStatus,\s*"CHANGES_REQUESTED"/, "changes-requested state assertion missing");
assert.match(runtime, /review runtime must never publish content/, "publication side-effect denial missing");
assert.doesNotMatch(runtime, /\/api\/(?:social-publish|publication-attempt)/, "review verifier must not call publication endpoints");
assert.match(browserRuntime, /Cosa richiede attenzione oggi/, "customer browser smoke must assert the current dashboard contract");
assert.doesNotMatch(browserRuntime, /Sessione attiva/, "removed pre-6B dashboard copy must not gate the runtime");

for (const metric of ["qaContentItems", "qaContentVariants", "qaPublicationJobs", "qaPublicationAttempts"]) {
  assert.match(controller, new RegExp(metric), `controller cleanup metric ${metric} missing`);
  assert.match(workflow, new RegExp(metric), `workflow cleanup assertion ${metric} missing`);
}

console.log("FASE 7D authenticated review runtime static safety: PASS");
