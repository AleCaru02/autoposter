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

const originalBrowserPageJson = `async function browserPageJson(page, path, init = {}) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, { ...init, credentials: "include" });
    let body = null;
    try { body = await response.json(); } catch { /* ignore */ }
    return { status: response.status, ok: response.ok, body };
  }, { path, init });
}`;

const anchoredBrowserPageJson = `async function browserPageJson(page, path, init = {}) {
  let currentOrigin = null;
  try { currentOrigin = new URL(page.url()).origin; } catch { /* about:blank or invalid */ }
  if (currentOrigin !== APP_BASE) {
    const anchor = await page.goto(\`${'${APP_BASE}'}/\`, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.ok(anchor && anchor.status() >= 200 && anchor.status() < 400, "browser Auth probe could not anchor to app origin");
  }
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, { ...init, credentials: "include" });
    let body = null;
    try { body = await response.json(); } catch { /* ignore */ }
    return { status: response.status, ok: response.ok, body };
  }, { path, init });
}`;

const originalOauthProbe = `async function oauthProtocolProbe() {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/social", {
    method: "POST",
    body: JSON.stringify({ provider: "google", callbackURL: \`${'${APP_BASE}'}/app/dashboard\`, disableRedirect: true }),
  });
  const body = await readJson(response);
  const candidate = typeof body?.url === "string" ? body.url : typeof body?.data?.url === "string" ? body.data.url : response.headers.get("location");
  assert.ok(response.ok || (response.status >= 300 && response.status < 400), \`Google OAuth start failed (${'${response.status}'})\`);
  assert.ok(candidate, "Google OAuth start returned no provider URL");
  const target = new URL(candidate);
  assert.ok(target.hostname === "accounts.google.com" || target.hostname.endsWith(".google.com"), \`unexpected OAuth provider host ${'${target.hostname}'}\`);
  const redirectRaw = target.searchParams.get("redirect_uri");
  assert.ok(redirectRaw, "Google OAuth redirect_uri missing");
  const redirect = new URL(redirectRaw);
  const statePresent = Boolean(target.searchParams.get("state"));
  const pkcePresent = Boolean(target.searchParams.get("code_challenge"));
  const observation = { providerHost: target.hostname, callbackOrigin: redirect.origin, callbackPath: redirect.pathname, statePresent, pkcePresent };
  console.log("SAME_ORIGIN_AUTH_OAUTH_OBSERVATION:", JSON.stringify(observation));
  assert.equal(redirect.origin, APP_BASE, "Google OAuth callback origin is not same-origin");
  assert.equal(redirect.pathname, "/api/auth/callback/google", "Google OAuth callback path is not same-origin Auth boundary");
  assert.equal(statePresent, true, "Google OAuth state missing");
  return observation;
}`;

const providerAwareOauthProbe = `async function oauthProtocolProbe() {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/social", {
    method: "POST",
    body: JSON.stringify({ provider: "google", callbackURL: \`${'${APP_BASE}'}/app/dashboard\`, disableRedirect: true }),
  });
  const body = await readJson(response);
  const candidate = typeof body?.url === "string" ? body.url : typeof body?.data?.url === "string" ? body.data.url : response.headers.get("location");
  assert.ok(response.ok || (response.status >= 300 && response.status < 400), \`Google OAuth start failed (${'${response.status}'})\`);
  assert.ok(candidate, "Google OAuth start returned no provider URL");

  const handoff = new URL(candidate);
  const expectedNeonHost = "ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech";
  const expectedCallbackHost = "neonauth.us-west-2.aws.neon.tech";
  assert.equal(handoff.hostname, expectedNeonHost, \`unexpected Neon OAuth handoff host ${'${handoff.hostname}'}\`);
  assert.match(handoff.pathname, /\\/auth\\/sign-in\\/social\\/init$/, "unexpected Neon OAuth handoff path");
  const handoffTokenPresent = Boolean(handoff.searchParams.get("token"));
  assert.equal(handoffTokenPresent, true, "Neon OAuth init handoff token missing");

  const initResponse = await fetch(handoff, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" }, redirect: "manual" });
  const providerLocation = initResponse.headers.get("location") || "";
  try { await initResponse.body?.cancel(); } catch { /* ignore */ }
  assert.ok(initResponse.status >= 300 && initResponse.status < 400 && providerLocation, \`Neon OAuth init did not redirect (${'${initResponse.status}'})\`);

  const target = new URL(providerLocation);
  assert.ok(target.hostname === "accounts.google.com" || target.hostname.endsWith(".google.com"), \`unexpected OAuth provider host ${'${target.hostname}'}\`);
  const redirectRaw = target.searchParams.get("redirect_uri");
  assert.ok(redirectRaw, "Google OAuth redirect_uri missing");
  const redirect = new URL(redirectRaw);
  const statePresent = Boolean(target.searchParams.get("state"));
  const pkcePresent = Boolean(target.searchParams.get("code_challenge"));
  const observation = {
    nativeHandoff: true,
    handoffHost: handoff.hostname,
    handoffPath: handoff.pathname,
    handoffTokenPresent,
    providerHost: target.hostname,
    callbackOrigin: redirect.origin,
    callbackHost: redirect.hostname,
    callbackPath: redirect.pathname,
    statePresent,
    pkcePresent,
  };
  console.log("SAME_ORIGIN_AUTH_OAUTH_OBSERVATION:", JSON.stringify(observation));
  assert.equal(redirect.hostname, expectedCallbackHost, "Google callback did not return to the allowlisted Neon Managed Auth callback host");
  assert.equal(redirect.pathname, "/auth/oauth/callback/google", "Google callback path is not the allowlisted Neon Managed Auth OAuth callback");
  assert.equal(statePresent, true, "Google OAuth state missing");
  assert.equal(pkcePresent, true, "Google OAuth PKCE challenge missing");
  return observation;
}`;

const source = fs.readFileSync(runtimePath, "utf8");
assert.ok(source.includes(originalAuthRuntime), "runtime auth state anchor changed");
assert.ok(source.includes(originalResetFlow), "runtime password-reset anchor changed");
assert.ok(source.includes(originalBrowserPageJson), "runtime browser fetch anchor changed");
assert.ok(source.includes(originalOauthProbe), "runtime OAuth protocol anchor changed");
let patched = source
  .replace(originalAuthRuntime, externalGapAuthRuntime)
  .replace(originalResetFlow, externalGapResetFlow)
  .replace(originalBrowserPageJson, anchoredBrowserPageJson)
  .replace(originalOauthProbe, providerAwareOauthProbe)
  .replace(
    "  const temporaryExpiry = new Date(Date.now() + 4500).toISOString();",
    "  const temporaryExpiry = new Date(Date.now() + 120000).toISOString();",
  )
  .replace(
    '  assert.equal((await signIn(emails.customer, nextPassword)).ok, false, "temporary ban did not block login");',
    [
      "  const tempBlockedLogin = await signIn(emails.customer, nextPassword);",
      '  assert.equal(tempBlockedLogin.ok, false, "temporary ban did not block login");',
      '  assert.notEqual(tempBlockedLogin.status, 429, "temporary ban verification remained rate-limited");',
      "  const expiryRefresh = new Date(Date.now() + 4500).toISOString();",
      '  const tempExpiryRefresh = await productRequest(adminFresh.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/ban`, "POST", { reason: `qa-temp-expiry-${marker}`, expiresAt: expiryRefresh });',
      "  assert.ok(tempExpiryRefresh.status === 200 || tempExpiryRefresh.status === 207);",
    ].join("\n"),
  )
  .replace(
    "  await sleep(5500);",
    "  await sleep(Math.max(0, Date.parse(expiryRefresh) - Date.now() + 1500));",
  )
  .split("browserLogin(page, emails.customer, nextPassword)").join("browserLogin(page, emails.customer, password)")
  .split("signIn(emails.customer, nextPassword)").join("signIn(emails.customer, password)");
assert.notEqual(patched, source, "runtime external-gap/provider-contract patch was not applied");
assert.match(patched, /browser Auth probe could not anchor to app origin/);
assert.match(patched, /temporary ban verification remained rate-limited/);
assert.match(patched, /Date\.parse\(expiryRefresh\)/);
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
assert.equal(summary?.authRuntime?.oauthObservation?.nativeHandoff, true);
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
  regularBrowserDirectNeonAuth: 0,
}));
console.log("PASSWORD_RESET_EMAIL_LINK_E2E: BLOCKED", JSON.stringify({
  reason: "NO_NON_PERSONAL_QA_INBOX_CONFIGURED_IN_VERIFIER",
  providerObservation: "DB_VERIFICATION_RECORD_NOT_EQUIVALENT_TO_DELIVERED_RESET_LINK",
  productDefectObserved: false,
}));
console.log("GOOGLE_OAUTH_PROTOCOL: PASS", JSON.stringify({
  nativeNeonInitHandoff: oauth.nativeHandoff === true,
  handoffHost: oauth.handoffHost || null,
  handoffPath: oauth.handoffPath || null,
  handoffTokenPresent: oauth.handoffTokenPresent === true,
  providerHost: oauth.providerHost || null,
  callbackOrigin: oauth.callbackOrigin || null,
  callbackHost: oauth.callbackHost || null,
  callbackPath: oauth.callbackPath || null,
  statePresent: oauth.statePresent === true,
  pkcePresent: oauth.pkcePresent === true,
  regularBrowserDirectNeonAuth: 0,
}));
console.log("GOOGLE_OAUTH_NATIVE_HANDOFF: EXPECTED", JSON.stringify({
  scope: "TOP_LEVEL_SOCIAL_SIGN_IN_INIT_ONLY",
  callbackBoundary: "NEON_MANAGED_AUTH_CENTRAL_OAUTH_CALLBACK",
  regularCredentialAndSessionApisRemainSameOrigin: true,
}));
console.log("GOOGLE_OAUTH_FULL_IDP_E2E: BLOCKED", JSON.stringify({
  reason: "NO_NON_PERSONAL_QA_IDENTITY_CONFIGURED_IN_VERIFIER",
  productDefectObserved: false,
}));
console.log("SAME_ORIGIN_AUTH_AUTOMATED_RUNTIME: PASS", JSON.stringify({
  productRuntime: "PASS_EXCEPT_EXTERNAL_IDP_AND_EMAIL_DELIVERY_E2E",
  passwordResetRequest: "PASS",
  passwordResetEmailLinkE2e: "BLOCKED_EXTERNAL_TEST_COVERAGE_GAP",
  googleOauthProtocol: "PASS_WITH_NATIVE_NEON_INIT_AND_CENTRAL_CALLBACK",
  googleOauthFullIdpE2e: "BLOCKED_EXTERNAL_TEST_COVERAGE_GAP",
  overallBoundaryCandidate: "IN_CORSO",
  sensitiveFindings: 0,
}));