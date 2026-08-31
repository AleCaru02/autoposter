import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24, "ephemeral smoke password missing");

const emails = {
  owner: `audit-smoke-${marker}-customer@example.invalid`,
  customerB: `audit-smoke-${marker}-customer-b@example.invalid`,
  admin: `audit-smoke-${marker}-admin@example.invalid`,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    const list = headers.getSetCookie?.() || [];
    for (const raw of list) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { invalidJson: true }; }
}

async function authFetch(jar, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("origin", APP_BASE);
  headers.set("referer", `${APP_BASE}/`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const cookie = jar?.header?.() || "";
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" });
  jar?.absorb?.(response.headers);
  return response;
}

function decodeSub(token) {
  const payload = token.split(".")[1];
  assert.ok(payload, "JWT payload missing");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const body = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  assert.equal(typeof body.sub, "string");
  return body.sub;
}

async function identityToken(jar) {
  const response = await authFetch(jar, "/token");
  const body = await readJson(response);
  const token = body?.token || body?.data?.token || "";
  assert.ok(response.ok && token.length > 40, `Managed Auth token unavailable (${response.status})`);
  return token;
}

async function signIn(email) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  assert.ok(response.ok, `Managed Auth sign-in failed (${response.status})`);
  const token = await identityToken(jar);
  return { jar, token, id: decodeSub(token) };
}

async function signUp(email, name) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
  assert.ok(response.ok, `Managed Auth sign-up failed (${response.status})`);
  const token = await identityToken(jar);
  return { jar, token, id: decodeSub(token) };
}

async function getSession(jar) {
  const response = await authFetch(jar, "/get-session");
  const body = await readJson(response);
  const session = body?.session || body?.data?.session || null;
  const user = body?.user || body?.data?.user || null;
  return { response, body, session, user, active: Boolean(response.ok && session && user?.id) };
}

async function dataIdentity(token, expectedId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${DATA_API}/rpc/current_auth_user_id`, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    const body = await readJson(response);
    const value = typeof body === "string" ? body : Array.isArray(body) ? body[0]?.current_auth_user_id || body[0]?.auth_user_id : body?.current_auth_user_id || body?.auth_user_id;
    if (response.ok && value === expectedId) return;
    await sleep(500);
  }
  throw new Error("Data API auth readiness failed");
}

async function productApi(method, path, token, expected) {
  let lastStatus = 0;
  let body = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${APP_BASE}${path}`, {
      method,
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    lastStatus = response.status;
    body = await readJson(response);
    if (lastStatus === expected) return body;
    if (lastStatus === 401 && [200, 403, 404].includes(expected)) {
      await sleep(500);
      continue;
    }
    break;
  }
  assert.equal(lastStatus, expected, `${method} ${path} expected ${expected}, got ${lastStatus}`);
  return body;
}

async function adminPluginList(adminJar, userId) {
  const response = await authFetch(adminJar, "/admin/list-user-sessions", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
  const body = await readJson(response);
  assert.ok(response.ok, `Admin Plugin session list failed (${response.status})`);
  const sessions = Array.isArray(body) ? body : Array.isArray(body?.sessions) ? body.sessions : Array.isArray(body?.data) ? body.data : body?.data?.sessions;
  assert.ok(Array.isArray(sessions), "Admin Plugin session list missing array");
  return sessions;
}

function exactSafeSessionKeys(session) {
  assert.ok(session && typeof session === "object" && !Array.isArray(session), "browser session must be an object");
  assert.deepEqual(Object.keys(session).sort(), ["createdAt", "expiresAt", "id", "ipAddress", "updatedAt", "userAgent"].sort());
}

function secretFindings(value, secrets, path = "root", findings = []) {
  const forbiddenKeys = new Set([
    "token", "sessiontoken", "jwt", "authorization", "cookie", "password", "databaseurl",
    "controller", "controllerToken", "userid", "impersonatedby", "activeorganizationid",
  ].map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
  if (Array.isArray(value)) {
    value.forEach((child, index) => secretFindings(child, secrets, `${path}[${index}]`, findings));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (forbiddenKeys.has(normalized)) findings.push(`${path}.${key}`);
      secretFindings(child, secrets, `${path}.${key}`, findings);
    }
    return findings;
  }
  if (typeof value === "string") {
    for (const secret of secrets) if (secret && value.includes(secret)) findings.push(path);
    if (/\bbearer\s+[a-z0-9._-]+/i.test(value)) findings.push(path);
    if (/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/.test(value)) findings.push(path);
    if (/\bpostgres(?:ql)?:\/\//i.test(value)) findings.push(path);
  }
  return findings;
}

const ownerPrimary = await signIn(emails.owner);
const ownerSecondary = await signIn(emails.owner);
const customerB = await signUp(emails.customerB, "Session Smoke Customer B");
const admin = await signIn(emails.admin);
assert.equal(ownerPrimary.id, ownerSecondary.id, "OWNER smoke identity mismatch");
assert.notEqual(ownerPrimary.id, customerB.id, "cross-customer identity collision");
assert.notEqual(ownerPrimary.id, admin.id, "owner/admin identity collision");
await dataIdentity(ownerPrimary.token, ownerPrimary.id);
await dataIdentity(customerB.token, customerB.id);
await dataIdentity(admin.token, admin.id);

// Pure CUSTOMER (B) and OWNER (A) must both be denied by product Session Management.
await productApi("GET", `/api/admin/customers/${encodeURIComponent(customerB.id)}/sessions`, customerB.token, 403);
await productApi("GET", `/api/admin/customers/${encodeURIComponent(ownerPrimary.id)}/sessions`, ownerPrimary.token, 403);
await productApi("DELETE", `/api/admin/customers/${encodeURIComponent(customerB.id)}/sessions`, customerB.token, 403);
await productApi("DELETE", `/api/admin/customers/${encodeURIComponent(ownerPrimary.id)}/sessions`, ownerPrimary.token, 403);

const ownerPrimarySession = await getSession(ownerPrimary.jar);
const ownerSecondarySession = await getSession(ownerSecondary.jar);
const customerBSession = await getSession(customerB.jar);
const adminSession = await getSession(admin.jar);
for (const current of [ownerPrimarySession, ownerSecondarySession, customerBSession, adminSession]) {
  assert.equal(current.active, true, "smoke session not active before product runtime");
}
const a1Id = String(ownerPrimarySession.session?.id || "");
const a2Id = String(ownerSecondarySession.session?.id || "");
const bId = String(customerBSession.session?.id || "");
assert.ok(a1Id && a2Id && bId && a1Id !== a2Id && a1Id !== bId && a2Id !== bId, "session ids missing or collided");

const nativeOwnerSessions = await adminPluginList(admin.jar, ownerPrimary.id);
const nativeAdminBefore = await adminPluginList(admin.jar, admin.id);
assert.ok(nativeOwnerSessions.length >= 2, "expected at least two owner sessions");
const nativeTokens = nativeOwnerSessions.map((session) => String(session?.token || "")).filter(Boolean);
assert.ok(nativeTokens.length >= 2, "native provider tokens unavailable for identifier check");
for (const session of nativeOwnerSessions) {
  assert.ok(session?.id && session?.token, "native session id/token contract missing");
  assert.notEqual(String(session.id), String(session.token), "session id must not equal authenticating token");
}

const listBefore = await productApi("GET", `/api/admin/customers/${encodeURIComponent(ownerPrimary.id)}/sessions`, admin.token, 200);
assert.ok(Array.isArray(listBefore?.sessions) && listBefore.sessions.length >= 2, "product session list missing expected sessions");
listBefore.sessions.forEach(exactSafeSessionKeys);
assert.ok(listBefore.sessions.some((session) => session.id === a1Id));
assert.ok(listBefore.sessions.some((session) => session.id === a2Id));
for (const session of listBefore.sessions) {
  assert.equal(nativeTokens.includes(String(session.id)), false, "browser session id unexpectedly equals provider token");
}

const secretValues = [password, controllerToken, ownerPrimary.token, ownerSecondary.token, customerB.token, admin.token, ...nativeTokens];
const runtimePayloads = [listBefore];
assert.deepEqual(secretFindings(listBefore, secretValues), [], "browser-safe list exposed sensitive material");

// Real cross-customer IDOR: target Customer A with Customer B's session id.
const mismatch = await productApi("DELETE", `/api/admin/customers/${encodeURIComponent(ownerPrimary.id)}/sessions/${encodeURIComponent(bId)}`, admin.token, 404);
runtimePayloads.push(mismatch);
assert.equal((await getSession(customerB.jar)).active, true, "foreign Customer B session changed after A+B mismatch");
assert.equal((await getSession(ownerPrimary.jar)).active, true, "Customer A session changed after foreign mismatch");

const single = await productApi("DELETE", `/api/admin/customers/${encodeURIComponent(ownerPrimary.id)}/sessions/${encodeURIComponent(a1Id)}`, admin.token, 200);
runtimePayloads.push(single);
assert.equal(single?.revoked, true);
assert.equal(single?.sessionId, a1Id);
assert.equal((await getSession(ownerPrimary.jar)).active, false, "single revoke did not invalidate the exact Managed Auth session");
assert.equal((await getSession(ownerSecondary.jar)).active, true, "single revoke invalidated another A session");
assert.equal((await getSession(customerB.jar)).active, true, "single revoke impacted Customer B");
assert.equal((await getSession(admin.jar)).active, true, "single revoke impacted Admin");

const listAfterSingle = await productApi("GET", `/api/admin/customers/${encodeURIComponent(ownerPrimary.id)}/sessions`, admin.token, 200);
runtimePayloads.push(listAfterSingle);
listAfterSingle.sessions.forEach(exactSafeSessionKeys);
assert.equal(listAfterSingle.sessions.some((session) => session.id === a1Id), false);
assert.equal(listAfterSingle.sessions.some((session) => session.id === a2Id), true);

const auditSingle = await productApi("GET", `/api/admin/audit?action=USER_SESSION_REVOKED&target=${encodeURIComponent(ownerPrimary.id)}&limit=25&page=1`, admin.token, 200);
runtimePayloads.push(auditSingle);
const singleAuditRow = auditSingle?.audit?.find((row) => row.action === "USER_SESSION_REVOKED" && row.target_id === ownerPrimary.id);
assert.ok(singleAuditRow, "USER_SESSION_REVOKED audit row missing");
assert.equal(singleAuditRow.target_type, "AUTH_USER");
assert.equal(singleAuditRow.metadata?.sessionRef, a1Id);

const revokeAll = await productApi("DELETE", `/api/admin/customers/${encodeURIComponent(ownerPrimary.id)}/sessions`, admin.token, 200);
runtimePayloads.push(revokeAll);
assert.equal(revokeAll?.revoked, true);
assert.ok(Number.isInteger(revokeAll?.count) && revokeAll.count >= 1, "revoke-all count invalid");
assert.equal((await getSession(ownerSecondary.jar)).active, false, "revoke-all left an A session valid");
assert.equal((await getSession(customerB.jar)).active, true, "revoke-all impacted Customer B");
assert.equal((await getSession(admin.jar)).active, true, "revoke-all impacted Admin");

const listAfterAll = await productApi("GET", `/api/admin/customers/${encodeURIComponent(ownerPrimary.id)}/sessions`, admin.token, 200);
runtimePayloads.push(listAfterAll);
assert.deepEqual(listAfterAll?.sessions, [], "revoke-all left product sessions for A");
const bListAfter = await productApi("GET", `/api/admin/customers/${encodeURIComponent(customerB.id)}/sessions`, admin.token, 200);
runtimePayloads.push(bListAfter);
assert.ok(Array.isArray(bListAfter?.sessions) && bListAfter.sessions.some((session) => session.id === bId), "Customer B session disappeared after A revoke-all");
bListAfter.sessions.forEach(exactSafeSessionKeys);

const nativeAdminAfter = await adminPluginList(admin.jar, admin.id);
assert.deepEqual(nativeAdminAfter.map((session) => session.id).sort(), nativeAdminBefore.map((session) => session.id).sort(), "Admin session set changed during customer revocation");

const auditAll = await productApi("GET", `/api/admin/audit?action=USER_SESSIONS_REVOKED&target=${encodeURIComponent(ownerPrimary.id)}&limit=25&page=1`, admin.token, 200);
runtimePayloads.push(auditAll);
const allAuditRow = auditAll?.audit?.find((row) => row.action === "USER_SESSIONS_REVOKED" && row.target_id === ownerPrimary.id);
assert.ok(allAuditRow, "USER_SESSIONS_REVOKED audit row missing");
assert.equal(allAuditRow.target_type, "AUTH_USER");
assert.ok(Number.isInteger(allAuditRow.metadata?.revokedCount));

for (const payload of runtimePayloads) {
  assert.deepEqual(secretFindings(payload, secretValues), [], "Session Management response/audit exposed sensitive material");
}

console.log("SESSION_MANAGEMENT_API_RUNTIME: PASS", JSON.stringify({
  customerDenied: "PASS",
  ownerDenied: "PASS",
  superAdminList: "PASS",
  browserSafeAllowlist: "PASS",
  idNonAuthenticating: "PASS",
  crossCustomerMismatch: "PASS",
  revokeSingle: "PASS",
  invalidationE2E: "PASS",
  secondSessionPreserved: "PASS",
  revokeAll: "PASS",
  adminSessionPreserved: "PASS",
  crossUserImpact: 0,
  auditSingle: "PASS",
  auditAll: "PASS",
  sensitiveFindings: 0,
  personalCredentialsUsed: false,
}));
