import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const workflow = fs.readFileSync(".github/workflows/audit-viewer-runtime.yml", "utf8");
const controller = fs.readFileSync("tests/audit-viewer-qa-controller.mjs", "utf8");
const wrangler = fs.readFileSync("tests/wrangler.audit-runtime.jsonc", "utf8");
const banUiRuntimePath = "tests/admin-ban-unban-ui-runtime.mjs";
const banUiRuntime = fs.readFileSync(banUiRuntimePath, "utf8");

assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m, "runtime must remain workflow_dispatch-only");
assert.doesNotMatch(workflow, /^\s+push:/m, "runtime must not run on push");
assert.doesNotMatch(workflow, /^\s+pull_request:/m, "runtime must not run on pull_request");
assert.match(workflow, /group:\s*audit-viewer-authenticated-runtime\s*$/m, "stable concurrency group missing");
assert.match(workflow, /cancel-in-progress:\s*false\s*$/m, "security runtime must finish cleanup rather than cancel in progress");
assert.match(workflow, /github\.ref\s*==\s*'refs\/heads\/verify\/admin-ban-unban-ui-runtime'/, "Ban UI runtime must be branch locked");

assert.match(workflow, /wrangler\s+versions\s+upload\b/, "preview-only version upload missing");
assert.doesNotMatch(workflow, /\bwrangler\s+delete\b/i, "destructive Worker deletion is forbidden");
assert.doesNotMatch(workflow, /\bwrangler\s+deploy\b/i, "production deploy is forbidden");
assert.doesNotMatch(workflow, /\bwrangler\s+versions\s+deploy\b/i, "version promotion is forbidden");
assert.doesNotMatch(workflow, /\bwrangler\s+triggers\s+deploy\b/i, "route mutation is forbidden");
assert.match(workflow, /workers\/scripts\/autoposter\/deployments/, "read-only deployment isolation check missing");
assert.match(workflow, /EPHEMERAL_CONTROLLER_VERSION_ID/, "ephemeral version ID comparison missing");
assert.match(workflow, /AUDIT_PREVIEW_ISOLATION:\s*PASS/, "preview isolation assertion missing");
assert.match(workflow, /production deployment set changed during UI runtime/, "deployment immutability comparison missing");
assert.match(workflow, /if:\s*always\(\)/, "always cleanup missing");
assert.match(workflow, /shred -u \.audit-runtime-secrets\.env/, "local token material cleanup missing");
assert.doesNotMatch(workflow, /actions\/upload-artifact/i, "ephemeral runtime material must not become an artifact");
assert.doesNotMatch(workflow, /ADMIN_SMOKE_(EMAIL|PASSWORD)|CUSTOMER_SMOKE_(EMAIL|PASSWORD)/, "permanent smoke credentials are forbidden");
assert.match(workflow, /node tests\/admin-ban-unban-ui-runtime\.mjs/, "Ban UI browser runtime command missing");
assert.match(workflow, /npm run test:admin-ban-unban-ui/, "Ban UI static regression must run before runtime");

assert.match(controller, /cleanup-residue/, "stale QA residue recovery action missing");
assert.match(controller, /recognizedSmokeEmail/, "exact smoke fixture recognition missing");
assert.match(controller, /audit-smoke-/, "smoke fixture namespace missing");
assert.match(controller, /example\\\.invalid/, "smoke fixture domain must remain non-routable");
assert.match(controller, /ban-state/, "fixed-scope Ban state probe missing");
assert.doesNotMatch(controller, /fetch\([^)]*autoposter\.02alessandrocaruso\.workers\.dev/, "controller must not call production product mutations");

assert.match(banUiRuntime, /audit-smoke-\$\{marker\}-customer@example\.invalid/, "runtime customer must use exact non-routable QA namespace");
assert.match(banUiRuntime, /audit-smoke-\$\{marker\}-admin@example\.invalid/, "runtime admin must use exact non-routable QA namespace");
assert.match(banUiRuntime, /getByRole\("button", \{ name: "Blocca account"/, "runtime must click the real Ban UI");
assert.match(banUiRuntime, /getByRole\("button", \{ name: "Conferma blocco"/, "runtime must explicitly confirm Ban UI");
assert.match(banUiRuntime, /getByRole\("button", \{ name: "Conferma riattivazione"/, "runtime must explicitly confirm Unban UI");
assert.match(banUiRuntime, /\/api\/admin\/me.*403|r\.path === "\/api\/admin\/me" && r\.status === 403/s, "CUSTOMER/OWNER browser denial assertion missing");
assert.match(banUiRuntime, /Ban\/Unban non disponibile per account SUPER_ADMIN\./, "SUPER_ADMIN self-target protection assertion missing");
assert.match(banUiRuntime, /controller\("ban-state"\)/, "runtime must independently verify canonical ban state");
assert.match(banUiRuntime, /customerState\.sessions, 0/, "runtime must verify session revocation after UI Ban");
assert.match(banUiRuntime, /page\.reload/, "runtime must verify persisted read model after mutation");
assert.match(banUiRuntime, /viewport: \{ width: 390, height: 844 \}/, "mobile Ban UI runtime missing");
assert.doesNotMatch(banUiRuntime, /console\.log\([^\n]*(password|token)/i, "runtime must not log credential material");
assert.doesNotMatch(banUiRuntime, /@gmail\.|@outlook\.|@hotmail\.|@yahoo\./i, "runtime must not use routable personal email fixtures");
execFileSync(process.execPath, ["--check", banUiRuntimePath], { stdio: "pipe" });

assert.match(wrangler, /"preview_urls"\s*:\s*true/, "preview URLs must stay enabled for the one-shot controller");
assert.doesNotMatch(wrangler, /"routes"\s*:/, "QA controller must not configure production routes");

console.log("Audit Viewer ephemeral runtime static safety: PASS");
