import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(".github/workflows/audit-viewer-runtime.yml", "utf8");
const controller = readFileSync("tests/audit-viewer-qa-controller.mjs", "utf8");
const runtime = readFileSync("tests/admin-impersonation-provider-runtime.mjs", "utf8");

assert.match(workflow, /name:\s*Audit Viewer Authenticated Runtime/);
assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /pull_request:|push:|schedule:/);
assert.match(workflow, /group:\s*audit-viewer-authenticated-runtime/);
assert.match(workflow, /cancel-in-progress:\s*false/);
assert.match(workflow, /name:\s*admin-impersonation-provider-runtime/);
assert.match(workflow, /github\.ref == 'refs\/heads\/verify\/admin-impersonation-provider-runtime'/);
assert.match(workflow, /wrangler versions upload[\s\S]*--preview-alias/);
assert.doesNotMatch(workflow, /\bwrangler\s+deploy\b|\bwrangler\s+versions\s+deploy\b|\bwrangler\s+triggers\s+deploy\b/);
assert.match(workflow, /if:\s*always\(\)/);
assert.match(workflow, /IMPERSONATION_PROVIDER_CLEANUP: PASS/);
assert.match(workflow, /IMPERSONATION_PROVIDER_POST_CLEANUP_PRODUCTION: PASS/);
assert.match(workflow, /IMPERSONATION_PROVIDER_EPHEMERAL_SECRET_CLEANUP: PASS/);
assert.doesNotMatch(workflow, /upload-artifact|actions\/upload-artifact/);
assert.match(workflow, /audit-smoke-\$\{marker\}-customer@example\.invalid/);
assert.match(workflow, /audit-smoke-\$\{marker\}-customer-b@example\.invalid/);
assert.match(workflow, /audit-smoke-\$\{marker\}-admin@example\.invalid/);
assert.match(workflow, /node --check tests\/admin-impersonation-provider-runtime\.mjs/);
assert.match(workflow, /npm run test:banned-user-rls/);
assert.match(workflow, /npm run test:tenant-cross-security/);

assert.match(controller, /customer\|customer-b\|admin/);
assert.match(controller, /impersonation-state/);
assert.match(controller, /impersonatedBy/);
assert.match(controller, /actorMatchesAdmin/);
assert.match(controller, /recognizedSmokeEmail/);
assert.match(controller, /cleanup-residue/);
assert.match(controller, /superAdmins/);
assert.match(controller, /profilesWithoutOwner/);
assert.doesNotMatch(controller, /@gmail\.com|@outlook\.com|@hotmail\.com|@icloud\.com/);

assert.match(runtime, /\/admin\/impersonate-user/);
assert.match(runtime, /\/admin\/stop-impersonating/);
assert.match(runtime, /session\.impersonatedBy|impersonatedBy/);
assert.match(runtime, /CUSTOMER native impersonation start/);
assert.match(runtime, /OWNER native impersonation start/);
assert.match(runtime, /normal CUSTOMER stop impersonating/);
assert.match(runtime, /nested impersonation/);
assert.match(runtime, /global Admin API remained available while impersonating/);
assert.match(runtime, /crossed tenant boundary into CUSTOMER_B/);
assert.match(runtime, /old impersonated cookie context remained usable after stop/);
assert.match(runtime, /old impersonated storage state remained active after stop/);
assert.match(runtime, /page\.reload/);
assert.match(runtime, /\/app\/profili/);
assert.match(runtime, /bannedTargetBehavior/);
assert.match(runtime, /selfBehavior/);
assert.match(runtime, /NATIVE_ALLOWED_PRODUCT_MUST_DENY/);
assert.match(runtime, /SECRET_DO_NOT_EXPOSE/);
assert.match(runtime, /responseFieldShape/);
assert.match(runtime, /sensitiveLogFindings:\s*0/);
assert.match(runtime, /IMPERSONATION_PROVIDER_CONTRACT_RUNTIME: PASS/);
assert.doesNotMatch(runtime, /console\.log\([^\n]*(\.body|\.token|\.cookie|password)/i);
assert.doesNotMatch(runtime, /console\.error\([^\n]*(\.body|\.token|\.cookie|password)/i);
assert.doesNotMatch(runtime, /@gmail\.com|@outlook\.com|@hotmail\.com|@icloud\.com/);

const syntax = spawnSync(process.execPath, ["--check", "tests/admin-impersonation-provider-runtime.mjs"], { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || "provider runtime syntax check failed");

console.log("Audit Viewer ephemeral runtime static safety: PASS");
