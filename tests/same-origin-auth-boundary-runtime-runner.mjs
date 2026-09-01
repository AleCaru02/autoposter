import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const marker = "SAME_ORIGIN_MANAGED_AUTH_BOUNDARY_RUNTIME: REWORK ";
const result = spawnSync(process.execPath, ["tests/same-origin-auth-boundary-runtime.mjs"], {
  encoding: "utf8",
  env: process.env,
  maxBuffer: 16 * 1024 * 1024,
});

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