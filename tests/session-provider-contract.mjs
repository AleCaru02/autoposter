import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const controllerUrl = process.env.AUDIT_SMOKE_CONTROLLER_URL || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24, "ephemeral smoke password missing");
assert.ok(controllerUrl.startsWith("https://"), "preview controller URL missing");
assert.ok(controllerToken.length >= 32, "preview controller token missing");

const emails = {
  customer: `audit-smoke-${marker}-customer@example.invalid`,
  admin: `audit-smoke-${marker}-admin@example.invalid`,
};

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
  header() { return [...this.values.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
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

async function controllerPost(action, extra = {}) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-audit-smoke-token": controllerToken,
    },
    body: JSON.stringify({ action, marker, ...extra }),
  });
  return { response, body: await readJson(response) };
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
  assert.ok(response.ok, `Managed Auth signin failed (${response.status})`);
  const token = await identityToken(jar);
  return { jar, token, id: decodeSub(token) };
}

function unwrapSessions(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.sessions)) return body.sessions;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.sessions)) return body.data.sessions;
  return null;
}

function getSessionRecord(body) {
  return body?.session || body?.data?.session || null;
}
function getUserRecord(body) {
  return body?.user || body?.data?.user || null;
}
async function getSession(jar) {
  const response = await authFetch(jar, "/get-session");
  const body = await readJson(response);
  return { response, body, session: getSessionRecord(body), user: getUserRecord(body) };
}
function isSessionActive(result) {
  return Boolean(result.response.ok && result.session && result.user && typeof result.user.id === "string");
}
async function adminPost(jar, path, body) {
  const response = await authFetch(jar, path, { method: "POST", body: JSON.stringify(body) });
  return { response, body: await readJson(response) };
}
async function adminPostBearer(token, path, body) {
  const response = await authFetch(null, path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { response, body: await readJson(response) };
}
async function getSessionBearer(token) {
  const response = await authFetch(null, "/get-session", { headers: { authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  return { response, session: getSessionRecord(body), user: getUserRecord(body) };
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
function classifyField(field) {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["token", "sessiontoken", "jwt", "accesstoken", "refreshtoken", "cookie", "authorization", "secret", "credential"].includes(normalized)) return { classification: "SECRET_DO_NOT_EXPOSE", intendedUse: "provider operation only; never browser/API response" };
  if (["id", "createdat", "updatedat", "expiresat", "ipaddress", "useragent"].includes(normalized)) return { classification: "SAFE_TO_DISPLAY", intendedUse: "admin session list" };
  if (["userid", "impersonatedby"].includes(normalized)) return { classification: "SERVER_ONLY", intendedUse: "target consistency / security checks" };
  return { classification: "SERVER_ONLY", intendedUse: "not exposed unless explicitly reviewed" };
}
function classifySessionFields(sessions) {
  const keys = [...new Set(sessions.flatMap((session) => session && typeof session === "object" ? Object.keys(session) : []))].sort();
  return keys.map((field) => {
    const values = sessions.filter((session) => session && Object.prototype.hasOwnProperty.call(session, field)).map((session) => session[field]);
    const types = [...new Set(values.map(valueType))].sort();
    const meta = classifyField(field);
    return { field, present: values.length === sessions.length ? "YES" : `PARTIAL_${values.length}_OF_${sessions.length}`, type: types.join("|") || "unknown", classification: meta.classification, intendedUse: meta.intendedUse };
  });
}
function extractSessionToken(session) {
  if (!session || typeof session !== "object") return "";
  const token = session.token || session.sessionToken || "";
  return typeof token === "string" ? token : "";
}
function extractSessionId(session) {
  const id = session?.id;
  return typeof id === "string" ? id : "";
}
function assertSanitizedFallbackSessions(sessions) {
  assert.ok(Array.isArray(sessions), "fallback session list missing array");
  const allowed = new Set(["id", "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent"]);
  for (const session of sessions) {
    assert.ok(session && typeof session === "object" && !Array.isArray(session), "invalid fallback session row");
    for (const key of Object.keys(session)) assert.ok(allowed.has(key), `fallback leaked non-display field ${key}`);
    assert.equal(typeof session.id, "string", "fallback session id missing");
    assert.equal(Object.prototype.hasOwnProperty.call(session, "token"), false, "fallback leaked session token");
    assert.equal(Object.prototype.hasOwnProperty.call(session, "userId"), false, "fallback leaked server-only userId");
  }
}

const customerPrimary = await signIn(emails.customer);
const customerSecondary = await signIn(emails.customer);
const admin = await signIn(emails.admin);
assert.equal(customerPrimary.id, customerSecondary.id, "smoke customer identity mismatch");
assert.notEqual(customerPrimary.id, admin.id, "admin/customer identity collision");

const primaryBefore = await getSession(customerPrimary.jar);
const secondaryBefore = await getSession(customerSecondary.jar);
const adminBefore = await getSession(admin.jar);
assert.ok(isSessionActive(primaryBefore), "CUSTOMER_SMOKE primary session not active before probe");
assert.ok(isSessionActive(secondaryBefore), "CUSTOMER_SMOKE secondary session not active before probe");
assert.ok(isSessionActive(adminBefore), "ADMIN_SMOKE session not active before probe");

const customerDenied = await adminPost(customerPrimary.jar, "/admin/list-user-sessions", { userId: customerPrimary.id });
assert.equal(customerDenied.response.status, 403, `CUSTOMER_SMOKE admin plugin access expected 403, got ${customerDenied.response.status}`);

const bearerGetSession = await getSessionBearer(admin.token);
const bearerList = await adminPostBearer(admin.token, "/admin/list-user-sessions", { userId: customerPrimary.id });
const jwtBearerBridge = {
  getSessionStatus: bearerGetSession.response.status,
  getSessionAuthenticated: Boolean(bearerGetSession.response.ok && bearerGetSession.user?.id === admin.id),
  listStatus: bearerList.response.status,
  listAccepted: bearerList.response.ok && Array.isArray(unwrapSessions(bearerList.body)),
};

const adminSessionToken = extractSessionToken(adminBefore.session);
assert.ok(adminSessionToken.length >= 16, "ADMIN_SMOKE native session token unavailable");
const sessionTokenGetSession = await getSessionBearer(adminSessionToken);
const sessionTokenList = await adminPostBearer(adminSessionToken, "/admin/list-user-sessions", { userId: customerPrimary.id });
const sessionTokenBearerBridge = {
  getSessionStatus: sessionTokenGetSession.response.status,
  getSessionAuthenticated: Boolean(sessionTokenGetSession.response.ok && sessionTokenGetSession.user?.id === admin.id),
  listStatus: sessionTokenList.response.status,
  listAccepted: sessionTokenList.response.ok && Array.isArray(unwrapSessions(sessionTokenList.body)),
};

const list = await adminPost(admin.jar, "/admin/list-user-sessions", { userId: customerPrimary.id });
assert.ok(list.response.ok, `list-user-sessions failed (${list.response.status})`);
const sessions = unwrapSessions(list.body);
assert.ok(Array.isArray(sessions), "list-user-sessions response did not contain a session array");
assert.ok(sessions.length >= 2, `expected at least two CUSTOMER_SMOKE sessions, got ${sessions.length}`);
const fields = classifySessionFields(sessions);
assert.ok(fields.length > 0, "session field contract empty");

const primaryToken = extractSessionToken(primaryBefore.session);
assert.ok(primaryToken.length >= 16, "current CUSTOMER_SMOKE session token unavailable for revoke probe");
const revokeSingle = await adminPost(admin.jar, "/admin/revoke-user-session", { sessionToken: primaryToken });
assert.ok(revokeSingle.response.ok, `revoke-user-session failed (${revokeSingle.response.status})`);
const primaryAfter = await getSession(customerPrimary.jar);
assert.equal(isSessionActive(primaryAfter), false, "revoked CUSTOMER_SMOKE session remained valid");
const secondaryAfterSingle = await getSession(customerSecondary.jar);
assert.ok(isSessionActive(secondaryAfterSingle), "revoke single unexpectedly invalidated another CUSTOMER_SMOKE session");

const beforeAll = await adminPost(admin.jar, "/admin/list-user-sessions", { userId: customerPrimary.id });
assert.ok(beforeAll.response.ok, `list-user-sessions before revoke-all failed (${beforeAll.response.status})`);
const sessionsBeforeAll = unwrapSessions(beforeAll.body);
assert.ok(Array.isArray(sessionsBeforeAll) && sessionsBeforeAll.length >= 1, "no remaining session available for revoke-all probe");
const revokeAll = await adminPost(admin.jar, "/admin/revoke-user-sessions", { userId: customerPrimary.id });
assert.ok(revokeAll.response.ok, `revoke-user-sessions failed (${revokeAll.response.status})`);
const secondaryAfterAll = await getSession(customerSecondary.jar);
assert.equal(isSessionActive(secondaryAfterAll), false, "revoke-all left CUSTOMER_SMOKE session valid");
const afterAll = await adminPost(admin.jar, "/admin/list-user-sessions", { userId: customerPrimary.id });
assert.ok(afterAll.response.ok, `list-user-sessions after revoke-all failed (${afterAll.response.status})`);
const sessionsAfterAll = unwrapSessions(afterAll.body);
assert.ok(Array.isArray(sessionsAfterAll), "post revoke-all response missing session array");
assert.equal(sessionsAfterAll.length, 0, `revoke-all left ${sessionsAfterAll.length} sessions`);

// Verified fallback for product server-side operations: the Admin Plugin cannot be bridged
// with the existing JWT or with a native session token in Authorization: Bearer.
const dbPrimary = await signIn(emails.customer);
const dbSecondary = await signIn(emails.customer);
const dbPrimaryBefore = await getSession(dbPrimary.jar);
const dbSecondaryBefore = await getSession(dbSecondary.jar);
const adminStillActive = await getSession(admin.jar);
assert.ok(isSessionActive(dbPrimaryBefore) && isSessionActive(dbSecondaryBefore), "fallback customer sessions not active");
assert.ok(isSessionActive(adminStillActive), "ADMIN_SMOKE session unexpectedly invalid before fallback test");
const dbPrimarySessionId = extractSessionId(dbPrimaryBefore.session);
const dbSecondarySessionId = extractSessionId(dbSecondaryBefore.session);
const adminSessionId = extractSessionId(adminStillActive.session);
assert.ok(dbPrimarySessionId && dbSecondarySessionId && adminSessionId, "session id missing for DB fallback probe");

const fallbackList = await controllerPost("session-list");
assert.equal(fallbackList.response.status, 200, `fallback session-list failed (${fallbackList.response.status})`);
assert.equal(fallbackList.body?.targetUserId, dbPrimary.id, "fallback list target mismatch");
assertSanitizedFallbackSessions(fallbackList.body?.sessions);
assert.ok(fallbackList.body.sessions.some((row) => row.id === dbPrimarySessionId), "fallback list missing primary session");
assert.ok(fallbackList.body.sessions.some((row) => row.id === dbSecondarySessionId), "fallback list missing secondary session");

const idorAttempt = await controllerPost("session-revoke-one", { targetUserId: dbPrimary.id, sessionId: adminSessionId });
assert.equal(idorAttempt.response.status, 404, `cross-target session revoke must fail closed, got ${idorAttempt.response.status}`);
assert.ok(isSessionActive(await getSession(admin.jar)), "cross-target revoke invalidated ADMIN_SMOKE session");
assert.ok(isSessionActive(await getSession(dbPrimary.jar)), "cross-target revoke invalidated CUSTOMER_SMOKE session");

const fallbackSingle = await controllerPost("session-revoke-one", { targetUserId: dbPrimary.id, sessionId: dbPrimarySessionId });
assert.equal(fallbackSingle.response.status, 200, `fallback revoke-one failed (${fallbackSingle.response.status})`);
assert.equal(fallbackSingle.body?.sessionId, dbPrimarySessionId, "fallback revoke-one returned wrong session id");
assert.equal(isSessionActive(await getSession(dbPrimary.jar)), false, "DB fallback revoked session remained active");
assert.ok(isSessionActive(await getSession(dbSecondary.jar)), "DB fallback revoke-one invalidated other customer session");

const fallbackAfterSingle = await controllerPost("session-list");
assert.equal(fallbackAfterSingle.response.status, 200, "fallback list after single revoke failed");
assertSanitizedFallbackSessions(fallbackAfterSingle.body?.sessions);
assert.equal(fallbackAfterSingle.body.sessions.some((row) => row.id === dbPrimarySessionId), false, "revoked session remained in fallback list");
assert.ok(fallbackAfterSingle.body.sessions.some((row) => row.id === dbSecondarySessionId), "remaining session missing after single revoke");

const fallbackAll = await controllerPost("session-revoke-all", { targetUserId: dbPrimary.id });
assert.equal(fallbackAll.response.status, 200, `fallback revoke-all failed (${fallbackAll.response.status})`);
assert.ok(Number(fallbackAll.body?.count || 0) >= 1, "fallback revoke-all deleted no customer sessions");
assert.equal(isSessionActive(await getSession(dbSecondary.jar)), false, "DB fallback revoke-all left customer session active");
assert.ok(isSessionActive(await getSession(admin.jar)), "DB fallback revoke-all affected ADMIN_SMOKE session");
const fallbackAfterAll = await controllerPost("session-list");
assert.equal(fallbackAfterAll.response.status, 200, "fallback list after revoke-all failed");
assertSanitizedFallbackSessions(fallbackAfterAll.body?.sessions);
assert.equal(fallbackAfterAll.body.sessions.length, 0, "fallback revoke-all left target sessions");

const secretFields = fields.filter((field) => field.classification === "SECRET_DO_NOT_EXPOSE").map((field) => field.field);
console.log("SESSION_PROVIDER_CONTRACT: PASS", JSON.stringify({
  listUserSessions: "PASS",
  customerDenied: "PASS",
  revokeSingle: "PASS",
  invalidationE2E: "PASS",
  revokeAll: "PASS",
  jwtBearerBridge,
  sessionTokenBearerBridge,
  dbFallback: {
    list: "PASS",
    sanitized: "PASS",
    targetConsistency: "PASS",
    revokeSingle: "PASS",
    invalidationE2E: "PASS",
    revokeAll: "PASS",
    adminSessionUnaffected: "PASS",
  },
  fields,
  secretFieldNames: secretFields,
  rawPayloadLogged: false,
  personalCredentialsUsed: false,
}));
