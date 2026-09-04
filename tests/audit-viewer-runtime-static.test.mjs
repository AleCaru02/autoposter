import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/audit-viewer-runtime.yml", "utf8");
const controller = fs.readFileSync("tests/audit-viewer-qa-controller.mjs", "utf8");
const wrangler = fs.readFileSync("tests/wrangler.audit-runtime.jsonc", "utf8");

assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m, "runtime must remain workflow_dispatch-only");
assert.doesNotMatch(workflow, /^\s+push:/m, "runtime must not run on push");
assert.doesNotMatch(workflow, /^\s+pull_request:/m, "runtime must not run on pull_request");
assert.match(workflow, /group:\s*audit-viewer-authenticated-runtime\s*$/m, "stable concurrency group missing");
assert.match(workflow, /cancel-in-progress:\s*false\s*$/m, "security runtime must finish cleanup rather than cancel in progress");

assert.match(workflow, /wrangler\s+versions\s+upload\b/, "preview-only version upload missing");
assert.doesNotMatch(workflow, /\bwrangler\s+delete\b/i, "destructive Worker deletion is forbidden");
assert.doesNotMatch(workflow, /\bwrangler\s+deploy\b/i, "production deploy is forbidden");
assert.doesNotMatch(workflow, /\bwrangler\s+versions\s+deploy\b/i, "version promotion is forbidden");
assert.doesNotMatch(workflow, /\bwrangler\s+triggers\s+deploy\b/i, "route mutation is forbidden");
assert.match(workflow, /workers\/scripts\/autoposter\/deployments/, "read-only deployment isolation check missing");
assert.match(workflow, /EPHEMERAL_CONTROLLER_VERSION_ID/, "ephemeral version ID comparison missing");
assert.match(workflow, /(?:AUDIT_PREVIEW_ISOLATION|BRAND_ANALYZE_PREVIEW_ISOLATION):\s*PASS/, "preview isolation assertion missing");
assert.match(workflow, /(?:production deployment set changed during Audit runtime|production deployment changed during verifier)/, "deployment immutability comparison missing");
assert.match(workflow, /if:\s*always\(\)/, "always cleanup missing");
assert.match(workflow, /shred -u \.(?:audit|brand-analyze)-runtime-secrets\.env/, "local token material cleanup missing");
assert.doesNotMatch(workflow, /actions\/upload-artifact/i, "ephemeral runtime material must not become an artifact");
assert.doesNotMatch(workflow, /ADMIN_SMOKE_(EMAIL|PASSWORD)|CUSTOMER_SMOKE_(EMAIL|PASSWORD)/, "permanent smoke credentials are forbidden");

assert.match(controller, /cleanup-residue/, "stale QA residue recovery action missing");
assert.match(controller, /recognizedSmokeEmail/, "exact smoke fixture recognition missing");
assert.match(controller, /audit-smoke-/, "smoke fixture namespace missing");
assert.match(controller, /example\\\.invalid/, "smoke fixture domain must remain non-routable");

assert.match(wrangler, /"preview_urls"\s*:\s*true/, "preview URLs must stay enabled for the one-shot controller");
assert.doesNotMatch(wrangler, /"routes"\s*:/, "QA controller must not configure production routes");

console.log("Audit Viewer ephemeral runtime static safety: PASS");
