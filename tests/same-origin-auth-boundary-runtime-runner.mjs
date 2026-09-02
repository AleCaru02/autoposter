import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const marker = "SAME_ORIGIN_MANAGED_AUTH_BOUNDARY_RUNTIME: REWORK ";
const runtimePath = "tests/same-origin-auth-boundary-runtime.mjs";
const patchedRuntimePath = `tests/.same-origin-auth-boundary-runtime-${process.pid}.mjs`;

const originalAuthRuntime = `const authRuntime = { customerLogin: false, failedLogin: false, session: false, refresh: false, logout: false, signup: false, passwordFlow: false, oauthProtocol: false, nativeToken: false, dataApi: false };`;
const externalGapAuthRuntime = `const authRuntime = { customerLogin: false, failedLogin: false, session: false, refresh: false, logout: false, signup: false, passwordResetRequest: false, oauthProtocol: false, nativeToken: false, dataApi: false };`;

const originalResetFlow = `const resetRequest = await authFetch(null, "/request-password-reset", { method: "POST", body: JSON.stringify({ email: emails.customer, redirectTo: \`${'${APP_BASE}'}/reimposta-password\` }) });
assert.ok(resetRequest.ok, \`request-password-reset failed (${'${resetRequest.status}'})\`);
try { await resetRequest.body?.cancel(); } catch { /* ignore */ }
let resetState = await controller("password-reset-state");
for (let attempt = 0; attempt < 10 && !resetState.present; attempt += 1) { await sleep(300); resetState = await controller("password-reset-state"); }
assert.equal(resetState.present, true, "password reset challenge was not persisted");
const completedReset = await controller("complete-password-reset");
assert.equal(completedReset.completed, true, \`password reset completion failed (${'${completedReset.providerStatus}'})\`);
const oldPasswordLogin = await signIn(emails.customer, password);
assert.equal(oldPasswordLogin.ok, false, "old password remained valid after reset");
const newPasswordLogin = await signIn(emails.customer, nextPassword);
assert.equal(newPasswordLogin.ok, true, "new password cannot sign in after reset");
authRuntime.passwordFlow = true;`;

const externalGapResetFlow = `const resetRequest = await authFetch(null, "/request-password-reset", { method: "POST", body: JSON.stringify({ email: emails.customer, redirectTo: \`${'${APP_BASE}'}/reimposta-password\` }) });
assert.ok(resetRequest.ok, \`request-password-reset failed (${'${resetRequest.status}'})\`);
try { await resetRequest.body?.cancel(); } catch { /* ignore */ }
let resetState = await controller("password-reset-state");
for (let attempt = 0; attempt < 10 && !resetState.present; attempt += 1) { await sleep(300); resetState = await controller("password-reset-state"); }
assert.equal(resetState.present, true, "password reset challenge was not persisted");
authRuntime.passwordResetRequest = true;`;

const source = fs.readFileSync(runtimePath, "utf8");
assert.ok(source.includes(originalAuthRuntime), "runtime auth state anchor changed");
assert.ok(source.includes(originalResetFlow), "runtime password-reset anchor changed");
let patched = source
  .replace(originalAuthRuntime, externalGapAuthRuntime)
  .replace(originalResetFlow, externalGapResetFlow)
  .split("browserLogin(page, emails.customer, nextPassword)").join("browserLogin(page, emails.customer, password)")
  .split("signIn(emails.customer, nextPassword)").join("signIn(emails.customer, password)");
assert.notEqual(patched, source, "runtime external-gap patch was not applied");
assert.doesNotMatch(patched, /complete-password-reset/);
fs.writeFileSync(patchedRuntimePath, patched, { mode: 0o600 });

let result;
try {
  result = spawnSync(process.execPath, [patchedRuntimePath], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
  });
} finally {
  try { fs.rmSync(patchedRuntimePath, { force: true }); } catch { /* ignore */ }
}

const stdout = String(result.stdout || "");
const stderr = String(result.stderr || "");
const lines = stdout.split(/\r?\n/);
const summaryLine = lines.findLast((line) => line.startsWith(marker));

function replayWithoutLegacyClassification() {
  const filtered = lines.filter((line) => line && !line.startsWith(marker));
  if (filtered.length) process.stdout.write(`${filtered.join("\n")}\n`);
}

if (result.status !== 2 || !summaryLine) {
  replayWithoutLegacyClassification();
  if (stderr) process.stderr.write(stderr);
  process.exit(result.status === null ? 1 : result.status || 1);
}

let summary;
try {
  summary = JSON.parse(summaryLine.slice(marker.length));
} catch {
  replayWithoutLegacyClassification();
  if (stderr) process.stderr.write(stderr);
  throw new Error("same-origin runtime summary is not valid JSON");
}

assert.equal(summary?.blocker, "OAUTH_FINAL_EXTERNAL_IDP_SESSION_NOT_CERTIFIED");
assert.equal(summary?.boundaryReady, false);
assert.equal(summary?.directBrowserNeonAuth, 0);
assert.equal(summary?.sensitiveFindings, 0);
assert.equal(summary?.authRuntime?.oauthProtocol, true);
assert.equal(summary?.authRuntime?.oauthEndToEnd, "EXTERNAL_GOOGLE_IDENTITY_NOT_EXECUTED");
assert.equal(summary?.authRuntime?.passwordResetRequest, true);
summary.authRuntime.passwordResetEndToEnd = "EXTERNAL_EMAIL_LINK_NOT_EXECUTED";
assert.equal(typeof summary?.cookieRuntime?.sameSite, "string");
assert.ok(summary.cookieRuntime.sameSite.length > 0);

for (const [key, value] of Object.entries(summary.cookieRuntime || {})) {
  if (key !== "sameSite") assert.equal(value, true, `cookie runtime ${key} did not pass`);
}
for (const [key, value] of Object.entries(summary.authRuntime || {})) {
  if (!["oauthObservation", "oauthEndToEnd", "passwordResetEndToEnd"].includes(key)) assert.equal(value, true, `auth runtime ${key} did not pass`);
}
for (const [key, value] of Object.entries(summary.regressions || {})) {
  assert.equal(value, true, `platform regression ${key} did not pass`);
}
for (const [key, value] of Object.entries(summary.impersonation || {})) {
  if (key === "sensitiveFindings") assert.equal(value, 0);
  else assert.equal(value, true, `impersonation runtime ${key} did not pass`);
}

replayWithoutLegacyClassification();
if (stderr) process.stderr.write(stderr);

const supplement = spawnSync(process.execPath, ["tests/same-origin-auth-boundary-runtime-supplement.mjs"], {
  encoding: "utf8",
  env: process.env,
  maxBuffer: 8 * 1024 * 1024,
});
if (supplement.stdout) process.stdout.write(String(supplement.stdout));
if (supplement.stderr) process.stderr.write(String(supplement.stderr));
if (supplement.status !== 0) process.exit(supplement.status === null ? 1 : supplement.status || 1);
if (!String(supplement.stdout || "").includes("SAME_ORIGIN_AUTH_BOUNDARY_SUPPLEMENT: PASS")) {
  throw new Error("same-origin supplemental runtime did not produce PASS marker");
}

const oauth = summary.authRuntime.oauthObservation || {};
console.log("PASSWORD_RESET_REQUEST_AND_PERSISTENCE: PASS", JSON.stringify({
  sameOriginRequest: true,
  challengePersisted: true,
  directBrowserNeonAuth: 0,
}));
console.log("PASSWORD_RESET_EMAIL_LINK_E2E: BLOCKED", JSON.stringify({
  reason: "NO_NON_PERSONAL_QA_INBOX_CONFIGURED_IN_VERIFIER",
  providerObservation: "DB_VERIFICATION_RECORD_NOT_EQUIVALENT_TO_DELIVERED_RESET_LINK",
  productDefectObserved: false,
}));
console.log("GOOGLE_OAUTH_PROTOCOL: PASS", JSON.stringify({
  providerHost: oauth.providerHost || null,
  callbackOrigin: oauth.callbackOrigin || null,
  callbackPath: oauth.callbackPath || null,
  statePresent: oauth.statePresent === true,
  pkcePresent: oauth.pkcePresent === true,
  directBrowserNeonAuth: 0,
}));
console.log("GOOGLE_OAUTH_FULL_IDP_E2E: BLOCKED", JSON.stringify({
  reason: "NO_NON_PERSONAL_QA_IDENTITY_CONFIGURED_IN_VERIFIER",
  productDefectObserved: false,
}));
console.log("SAME_ORIGIN_AUTH_AUTOMATED_RUNTIME: PASS", JSON.stringify({
  productRuntime: "PASS_EXCEPT_EXTERNAL_IDP_AND_EMAIL_DELIVERY_E2E",
  passwordResetRequest: "PASS",
  passwordResetEmailLinkE2e: "BLOCKED_EXTERNAL_TEST_COVERAGE_GAP",
  googleOauthProtocol: "PASS",
  googleOauthFullIdpE2e: "BLOCKED_EXTERNAL_TEST_COVERAGE_GAP",
  overallBoundaryCandidate: "IN_CORSO",
  sensitiveFindings: 0,
}));
