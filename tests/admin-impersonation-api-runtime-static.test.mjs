import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/audit-viewer-runtime.yml", import.meta.url), "utf8");
const gate = readFileSync(new URL("../.github/workflows/gate.yml", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./admin-impersonation-api-runtime.mjs", import.meta.url), "utf8");
const adminTarget = readFileSync(new URL("./admin-impersonation-api-admin-target-runtime.mjs", import.meta.url), "utf8");
const controller = readFileSync(new URL("./audit-viewer-qa-controller.mjs", import.meta.url), "utf8");

assert.match(workflow, /^\s*workflow_dispatch:\s*$/m, "runtime must remain manual workflow_dispatch only");
for (const forbiddenTrigger of ["push:", "pull_request:", "schedule:"]) {
  assert.equal(workflow.includes(forbiddenTrigger), false, `runtime workflow must not include ${forbiddenTrigger}`);
}
assert.ok(workflow.includes("github.ref == 'refs/heads/verify/admin-impersonation-api-runtime'"), "runtime branch lock missing");
assert.ok(workflow.includes("name: admin-impersonation-api-runtime"), "runtime job name missing");
assert.ok(workflow.includes("concurrency:"), "existing concurrency contract missing");
assert.ok(workflow.includes("cancel-in-progress: false"), "runtime concurrency must not cancel an in-flight verifier");
assert.ok(workflow.includes("wrangler versions upload"), "isolated Preview upload missing");
assert.ok(workflow.includes("--preview-alias"), "Preview alias missing");
assert.equal(/\bwrangler\s+(?:versions\s+)?deploy\b/.test(workflow), false, "runtime verifier must never deploy to production");
assert.equal(workflow.includes("upload-artifact"), false, "runtime verifier must not upload artifacts");
assert.ok((workflow.match(/if: always\(\)/g) || []).length >= 3, "cleanup/post-cleanup/secret cleanup must run always");

for (const kind of ["customer@example.invalid", "customer-b@example.invalid", "admin@example.invalid"]) {
  assert.ok(workflow.includes(kind), `masked ephemeral ${kind} fixture missing`);
}
assert.ok(workflow.includes("node tests/admin-impersonation-api-runtime.mjs"), "main API runtime is not executed");
assert.ok(workflow.includes("node tests/admin-impersonation-api-admin-target-runtime.mjs"), "distinct Admin target runtime is not executed");
assert.ok(workflow.includes("node tests/admin-impersonation-api-runtime-static.test.mjs"), "static runtime gate must self-check before fixture creation");
assert.ok(workflow.includes("npm run test:admin-impersonation-api"), "production API regression must run before runtime fixtures");
assert.ok(workflow.includes("IMPERSONATION_API_PREVIEW_ISOLATION: PASS"));
assert.ok(workflow.includes("IMPERSONATION_API_PREFLIGHT: PASS"));
assert.ok(workflow.includes("IMPERSONATION_API_CLEANUP: PASS"));
assert.ok(workflow.includes("IMPERSONATION_API_POST_CLEANUP_PRODUCTION: PASS"));
assert.ok(workflow.includes("IMPERSONATION_API_EPHEMERAL_SECRET_CLEANUP: PASS"));
assert.ok(workflow.includes("qaAuditRows"), "cleanup must prove impersonation audit fixture removal");
assert.ok(workflow.includes("impersonation-state"), "cleanup must prove no active QA impersonation session remains");
assert.ok(workflow.includes("attachedToProduction:false"), "Preview isolation postcondition missing");

const requiredGateCoverage = [
  "npm run typecheck",
  "npm run test:auth-security",
  "npm run test:auth-proxy",
  "npm run test:auth-boundary-static",
  "npm run test:platform-rbac",
  "npm run test:admin-audit-viewer",
  "npm run test:admin-session-management",
  "npm run test:admin-ban-unban",
  "npm run test:admin-impersonation-api",
  "node tests/admin-impersonation-api-runtime-static.test.mjs",
  "npm run test:banned-user-rls",
  "npm run test:tenant-security",
  "npm run test:tenant-cross-security",
  "npm run build",
  "npx wrangler deploy --dry-run",
];
for (const command of requiredGateCoverage) {
  assert.ok(gate.includes(command), `verifier Gate coverage missing: ${command}`);
}
assert.ok(gate.includes("pull_request:"), "automatic verifier Gate must run on PRs to main");

for (const route of ["/api/admin/customers/", "/impersonate", "/api/admin/impersonation/stop"]) {
  assert.ok(runtime.includes(route), `product impersonation route coverage missing: ${route}`);
}
assert.ok(runtime.includes("CUSTOMER start was not denied"), "CUSTOMER start denial coverage missing");
assert.ok(runtime.includes("OWNER start was not denied"), "OWNER start denial coverage missing");
assert.ok(runtime.includes("normal CUSTOMER stop was not denied"), "normal CUSTOMER stop denial coverage missing");
assert.ok(runtime.includes("self Admin target was not denied"), "self-target denial coverage missing");
assert.ok(runtime.includes("banned target impersonation was not denied"), "banned target denial coverage missing");
assert.ok(runtime.includes("nested product impersonation"), "nested impersonation denial coverage missing");
assert.ok(runtime.includes("missing target was not denied with 404"), "missing target denial coverage missing");
assert.ok(runtime.includes("client-controlled target/session body was not denied"), "client target/session override denial coverage missing");
assert.ok(runtime.includes("foreign Origin impersonation start was not denied"), "foreign Origin denial coverage missing");
assert.ok(adminTarget.includes("ADMIN_TARGET_DENIED"), "distinct existing Admin target denial coverage missing");
assert.ok(controller.includes('"real-admin-target"'), "controller exact real Admin target action missing");

assert.ok(runtime.includes("impersonated CUSTOMER_A cannot read own tenant"), "tenant A access coverage missing");
assert.ok(runtime.includes("crossed into CUSTOMER_B tenant"), "tenant B isolation coverage missing");
assert.ok(runtime.includes("Admin APIs remained available to impersonated CUSTOMER"), "Admin API denial while impersonating missing");
assert.ok(runtime.includes("Admin identity was not restored"), "Admin restoration coverage missing");
assert.ok(runtime.includes("old impersonated cookie context remained active after stop"), "old context invalidation coverage missing");
assert.ok(runtime.includes('controller("audit-state")'), "audit persistence inspection missing");
assert.ok(runtime.includes("IMPERSONATION_STARTED"), "start audit event verification missing");
assert.ok(runtime.includes("IMPERSONATION_ENDED"), "stop audit event verification missing");
assert.ok(runtime.includes("NEON_MANAGED_AUTH"), "native provider audit metadata verification missing");
assert.ok(runtime.includes("assertSafeResponse"), "browser-safe response allowlist verification missing");
assert.ok(runtime.includes("browserCookieRoundTrip"), "real browser session cookie round-trip coverage missing");
assert.ok(runtime.includes("browserDirectNeonAuth"), "direct Neon browser request observation missing");
assert.ok(runtime.includes("IMPERSONATION_API_RUNTIME: PASS"), "final API runtime PASS marker missing");
assert.ok(runtime.includes("sensitiveFindings: 0"), "final sensitive finding assertion missing");
assert.ok(adminTarget.includes("IMPERSONATION_API_ADMIN_TARGET: DENIED"), "Admin-target safe marker missing");
assert.ok(adminTarget.includes("sensitiveFindings: 0"), "Admin-target sensitive finding assertion missing");

for (const source of [runtime, adminTarget, controller]) {
  assert.equal(/console\.(?:log|error)\([^\n]*(?:password|\.token|cookie\.header\(|authorization:\s*`Bearer)/i.test(source), false, "verifier must not log credential material");
  assert.equal(/console\.(?:log|error)\([^\n]*\.body\b/i.test(source), false, "verifier must not log raw provider/product response bodies");
}
for (const source of [workflow, runtime, adminTarget, controller]) {
  assert.equal(/console\.(?:log|error)\([^\n]*(?:CLOUDFLARE_API_TOKEN|DATABASE_URL|AUDIT_SMOKE_PASSWORD|AUDIT_SMOKE_TOKEN_VALUE)/i.test(source), false, "verifier must not print production or ephemeral secrets");
}
assert.equal(runtime.includes("storageState"), false, "API runtime must not persist browser auth state as an artifact");
assert.equal(workflow.includes("artifacts"), false, "workflow must not create credential-bearing artifacts");
assert.equal(workflow.includes("wrangler delete"), false, "verifier must not destructively delete the production Worker");

console.log("Admin impersonation API runtime static safety: PASS");
