import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/audit-viewer-runtime.yml", import.meta.url), "utf8");
const runtime = readFileSync(new URL("./admin-impersonation-ui-runtime.mjs", import.meta.url), "utf8");
const controller = readFileSync(new URL("./audit-viewer-qa-controller.mjs", import.meta.url), "utf8");
const gate = readFileSync(new URL("../.github/workflows/gate.yml", import.meta.url), "utf8");

assert.match(workflow, /^\s*workflow_dispatch:\s*$/m, "UI runtime must remain workflow_dispatch only");
for (const forbidden of ["push:", "pull_request:", "schedule:"]) assert.equal(workflow.includes(forbidden), false, `UI runtime must not include ${forbidden}`);
assert.ok(workflow.includes("github.ref == 'refs/heads/verify/admin-impersonation-ui-runtime'"), "UI runtime branch lock missing");
assert.ok(workflow.includes("name: admin-impersonation-ui-runtime"), "UI runtime job name missing");
assert.ok(workflow.includes("wrangler versions upload") && workflow.includes("--preview-alias"), "isolated Preview upload missing");
assert.equal(/\bwrangler\s+(?:versions\s+)?deploy\b/.test(workflow), false, "UI verifier must never deploy product/controller to production");
assert.equal(workflow.includes("upload-artifact"), false, "UI runtime must not persist auth artifacts");
assert.ok((workflow.match(/if: always\(\)/g) || []).length >= 3, "cleanup, production invariant and secret cleanup must always run");
assert.ok(workflow.includes("AUDIT_PREVIEW_ISOLATION: PASS"), "Preview isolation marker missing");
assert.ok(workflow.includes("IMPERSONATION_UI_PREFLIGHT: PASS"), "UI preflight marker missing");
assert.ok(workflow.includes("IMPERSONATION_UI_CLEANUP: PASS"), "UI cleanup marker missing");
assert.ok(workflow.includes("IMPERSONATION_UI_POST_CLEANUP_PRODUCTION: PASS"), "post-cleanup production marker missing");
assert.ok(workflow.includes("IMPERSONATION_UI_EPHEMERAL_SECRET_CLEANUP: PASS"), "ephemeral secret cleanup marker missing");
assert.ok(workflow.includes("qaAuditRows") && workflow.includes("impersonation-state"), "cleanup must prove audit and native impersonation residue zero");
assert.ok(workflow.includes("npm run test:admin-impersonation-ui"), "product UI regression missing from verifier static gate");
assert.ok(workflow.includes("npm run test:admin-impersonation-api"), "certified API regression missing from verifier static gate");
assert.ok(workflow.includes("npm run test:auth-boundary-static"), "same-origin Auth regression missing from verifier static gate");
assert.ok(workflow.includes("npm run test:banned-user-rls"), "Banned RLS regression missing from verifier static gate");
assert.ok(workflow.includes("node tests/admin-impersonation-ui-runtime-static.test.mjs"), "UI verifier static self-check missing");
assert.ok(gate.includes("Admin Impersonation UI runtime verifier static safety"), "Gate must execute UI verifier static safety");

for (const fixture of ["customer@example.invalid", "customer-b@example.invalid", "admin@example.invalid"]) assert.ok(workflow.includes(fixture), `ephemeral ${fixture} fixture missing`);
assert.ok(controller.includes("customer-b|admin"), "controller must recognize exact CUSTOMER_B fixture namespace");
assert.ok(controller.includes('"audit-state"') && controller.includes('"impersonation-state"'), "controller audit/session inspection actions missing");
assert.ok(controller.includes("cleanup-residue"), "controller stale residue cleanup missing");

assert.ok(runtime.includes("1440, height: 900"), "desktop viewport 1440x900 missing");
assert.ok(runtime.includes("width: 390, height: 844"), "mobile viewport 390x844 missing");
assert.ok(runtime.includes("Visualizza come cliente"), "UI CTA runtime coverage missing");
assert.ok(runtime.includes("Visualizza come questo cliente?"), "confirmation modal runtime coverage missing");
assert.ok(runtime.includes("Stai visualizzando l'account di"), "persistent banner runtime coverage missing");
assert.ok(runtime.includes("Termina visualizzazione"), "stop CTA runtime coverage missing");
assert.ok(runtime.includes("/api/auth/get-session") && runtime.includes("/api/auth/token"), "native session/token checks missing");
assert.ok(runtime.includes("/api/admin/impersonation/stop"), "product stop API UI coverage missing");
assert.ok(runtime.includes("QA_INJECTED_STOP_FAILURE"), "stop failure fail-closed UI coverage missing");
assert.ok(runtime.includes("page.reload"), "refresh persistence coverage missing");
for (const route of ["/app/dashboard", "/app/profili", "/app/brand", "/app/sito", "/app/contenuti", "/app/approvazioni", "/app/calendario", "/app/social", "/app/analytics", "/app/apprendimento", "/app/impostazioni"]) assert.ok(runtime.includes(route), `banner route coverage missing: ${route}`);
assert.ok(runtime.includes(".admin-sidebar") && runtime.includes("Admin navigation remained mounted"), "Admin navigation absence coverage missing");
for (const adminPath of ["/api/admin/me", "/api/admin/customers", "/api/admin/audit?page=1&limit=25", "/sessions", "/ban"]) assert.ok(runtime.includes(adminPath), `Admin denial runtime coverage missing: ${adminPath}`);
assert.ok(runtime.includes("tenant B became accessible") && runtime.includes("CUSTOMER_A tenant unavailable"), "tenant isolation runtime coverage missing");
assert.ok(runtime.includes("bannedTargetCta") && runtime.includes("adminTargetCta"), "CTA visibility denial markers missing");
assert.ok(runtime.includes('controller("audit-state")'), "UI audit runtime inspection missing");
assert.ok(runtime.includes("IMPERSONATION_STARTED") && runtime.includes("IMPERSONATION_ENDED"), "UI start/end audit coverage missing");
assert.ok(runtime.includes("browserDirectNeon") && runtime.includes("privilegeBleed: 0") && runtime.includes("sensitiveFindings: 0"), "final security markers missing");
assert.ok(runtime.includes("IMPERSONATION_UI_RUNTIME: PASS"), "final UI runtime PASS marker missing");

for (const source of [runtime, controller]) {
  assert.equal(/console\.(?:log|error)\([^\n]*(?:password|\.token|cookie\.header\(|authorization:\s*`Bearer)/i.test(source), false, "UI verifier must not log credentials");
  assert.equal(/console\.(?:log|error)\([^\n]*\.body\b/i.test(source), false, "UI verifier must not log raw auth/product payloads");
}
assert.equal(runtime.includes("storageState"), false, "UI verifier must not persist browser auth state");
assert.equal(workflow.includes("artifacts"), false, "workflow must not create credential-bearing artifacts");

console.log("Admin impersonation UI runtime static safety: PASS");
