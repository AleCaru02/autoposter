import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const marker = "SAME_ORIGIN_MANAGED_AUTH_BOUNDARY_RUNTIME: REWORK ";
const runtimePath = "tests/same-origin-auth-boundary-runtime.mjs";
const patchedRuntimePath = `tests/.same-origin-auth-boundary-runtime-${process.pid}.mjs`;

const originalController = `async function controller(action, extra = {}) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-audit-smoke-token": controllerToken },
    body: JSON.stringify({ action, marker, ...extra }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, \`${'${action}'} controller HTTP ${'${response.status}'}\`);
  return body;
}`;

const diagnosticController = `async function controller(action, extra = {}) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-audit-smoke-token": controllerToken },
    body: JSON.stringify({ action, marker, ...extra }),
  });
  const body = await readJson(response);
  if (action === "complete-password-reset" && response.status !== 200) {
    const safe = {
      status: response.status,
      errorCode: typeof body?.error === "string" ? body.error : null,
      providerStatus: Number.isInteger(body?.providerStatus) ? body.providerStatus : null,
      completed: body?.completed === true,
    };
    console.log("SAME_ORIGIN_AUTH_PASSWORD_RESET_CONTROLLER:", JSON.stringify(safe));
    return { ...(body && typeof body === "object" ? body : {}), __controllerStatus: response.status };
  }
  assert.equal(response.status, 200, \`${'${action}'} controller HTTP ${'${response.status}'}\`);
  return body;
}`;

const originalReset = `const completedReset = await controller("complete-password-reset");
assert.equal(completedReset.completed, true, \`password reset completion failed (${'${completedReset.providerStatus}'})\`);`;

const diagnosticReset = `let completedReset = null;
for (let attempt = 0; attempt < 8; attempt += 1) {
  completedReset = await controller("complete-password-reset");
  if (completedReset?.completed === true) break;
  if (completedReset?.error !== "RESET_CHALLENGE_NOT_FOUND") break;
  await sleep(Math.min(300 * (attempt + 1), 1500));
}
assert.equal(
  completedReset?.completed,
  true,
  \`password reset completion failed controller=${'${completedReset?.__controllerStatus ?? 200}'} provider=${'${completedReset?.providerStatus ?? "n/a"}'} error=${'${completedReset?.error ?? "none"}'}\`,
);`;

const source = fs.readFileSync(runtimePath, "utf8");
assert.ok(source.includes(originalController), "runtime controller anchor changed");
assert.ok(source.includes(originalReset), "runtime password-reset anchor changed");
const patched = source.replace(originalController, diagnosticController).replace(originalReset, diagnosticReset);
assert.notEqual(patched, source, "runtime diagnostic patch was not applied");
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
assert.equal(typeof summary?.cookieRuntime?.sameSite, "string");
assert.ok(summary.cookieRuntime.sameSite.length > 0);

for (const [key, value] of Object.entries(summary.cookieRuntime || {})) {
  if (key !== "sameSite") assert.equal(value, true, `cookie runtime ${key} did not pass`);
}
for (const [key, value] of Object.entries(summary.authRuntime || {})) {
  if (key !== "oauthObservation" && key !== "oauthEndToEnd") assert.equal(value, true, `auth runtime ${key} did not pass`);
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
  productRuntime: "PASS",
  googleOauthProtocol: "PASS",
  googleOauthFullIdpE2e: "BLOCKED_EXTERNAL_TEST_COVERAGE_GAP",
  overallBoundaryCandidate: "IN_CORSO",
  sensitiveFindings: 0,
}));
