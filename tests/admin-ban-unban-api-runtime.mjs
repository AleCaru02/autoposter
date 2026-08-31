import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";
const controllerUrl = process.env.AUDIT_SMOKE_CONTROLLER_URL || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);
assert.ok(controllerToken.length >= 32);
assert.ok(controllerUrl.startsWith("https://"));

const emails = {
  owner: `audit-smoke-${marker}-customer@example.invalid`,
  customer: `audit-smoke-${marker}-customer-b@example.invalid`,
  admin: `audit-smoke-${marker}-admin@example.invalid`,
};
const ownerSlug = `qa-ban-owner-${marker}`;
const customerSlug = `qa-ban-customer-${marker}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
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
  try { return JSON.parse(text); } catch { return null; }
}

function retryAfterMs(response, attempt) {
  const raw = response.headers.get("retry-after");
  const seconds = Number(raw);
  if (raw && Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.max(seconds * 1000, 1000), 15000);
  return Math.min(1000 * (2 ** attempt), 10000);
}

async function authFetch(jar, path, init = {}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("origin", APP_BASE);
    headers.set("referer", `${APP_BASE}/`);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const cookie = jar?.header?.() || "";
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" });
    jar?.absorb?.(response.headers);
    if (response.status !== 429 || attempt === 7) return response;
    const waitMs = retryAfterMs(response, attempt);
    try { await response.body?.cancel(); } catch { /* ignore */ }
    console.log(`BAN_API_AUTH_RATE_LIMIT_RETRY: ${attempt + 1}/7 waitMs=${waitMs}`);
    await sleep(waitMs);
  }
  throw new Error("unreachable auth retry state");
}

function decodeSub(token) {
  const payload = token.split(".")[1];
  assert.ok(payload);
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

async function signUp(email, name) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  assert.ok(response.ok, `Managed Auth sign-up failed (${response.status})`);
  const token = await identityToken(jar);
  return { jar, token, id: decodeSub(token) };
}

async function signIn(email) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  assert.ok(response.ok, `Managed Auth sign-in failed (${response.status})`);
  const token = await identityToken(jar);
  return { jar, token, id: decodeSub(token) };
}

async function signInAttempt(email) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  return { jar, ok: response.ok, status: response.status };
}

async function getSession(jar) {
  const response = await authFetch(jar, "/get-session");
  const body = await readJson(response);
  return { active: Boolean(response.ok && (body?.session || body?.data?.session) && (body?.user?.id || body?.data?.user?.id)), status: response.status };
}

async function controller(action) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-audit-smoke-token": controllerToken },
    body: JSON.stringify({ action, marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, `${action} controller HTTP ${response.status}`);
  return body;
}

async function dataFetch(token, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${DATA_API}${path}`, { ...init, headers });
  return { response, body: await readJson(response) };
}

async function dataIdentity(token, expectedId) {
  const result = await dataFetch(token, "/rpc/current_auth_user_id", { method: "POST", body: "{}" });
  const body = result.body;
  const value = typeof body === "string" ? body : Array.isArray(body) ? body[0]?.current_auth_user_id || body[0]?.auth_user_id : body?.current_auth_user_id || body?.auth_user_id;
  return Boolean(result.response.ok && value === expectedId);
}

async function waitIdentity(token, id, label) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await dataIdentity(token, id)) return;
    await sleep(500);
  }
  throw new Error(`${label} Data API identity not ready`);
}

async function insertProfile(token, slug, name) {
  return dataFetch(token, "/profiles?select=id,name,slug", {
    method: "POST", headers: { prefer: "return=representation" },
    body: JSON.stringify({ name, slug, website_url: null, industry: "QA security" }),
  });
}

async function selectProfile(token, slug) {
  return dataFetch(token, `/profiles?select=id,name,slug&slug=eq.${encodeURIComponent(slug)}`);
}

async function updateProfile(token, id, name) {
  return dataFetch(token, `/profiles?select=id,name,slug&id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ name, updated_at: new Date().toISOString() }),
  });
}

function rows(body) { return Array.isArray(body) ? body : []; }
function firstRow(body) { return rows(body)[0] || null; }

async function productRequest(token, path, method = "GET", body) {
  const headers = new Headers({ accept: "application/json", authorization: `Bearer ${token}` });
  let payload;
  if (body !== undefined) { headers.set("content-type", "application/json"); payload = JSON.stringify(body); }
  const response = await fetch(`${APP_BASE}${path}`, { method, headers, body: payload });
  return { status: response.status, ok: response.ok, body: await readJson(response) };
}

function stateKind(states, kind) {
  const found = states.find((item) => item?.kind === kind);
  assert.ok(found, `missing ${kind} state`);
  return found;
}

function assertNoSensitive(value, label) {
  const text = JSON.stringify(value || {});
  assert.doesNotMatch(text, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/, `${label} exposed JWT`);
  for (const key of ["password", "authorization", "cookie", "accessToken", "refreshToken", "sessionToken", "databaseUrl", "controllerToken"]) {
    assert.equal(text.toLowerCase().includes(key.toLowerCase()), false, `${label} exposed ${key}`);
  }
}

const owner = await signUp(emails.owner, "Ban API Owner A");
const customer = await signUp(emails.customer, "Ban API Customer B");
const adminCandidate = await signUp(emails.admin, "Ban API Admin");
await waitIdentity(owner.token, owner.id, "OWNER_A");
await waitIdentity(customer.token, customer.id, "CUSTOMER_B");
await waitIdentity(adminCandidate.token, adminCandidate.id, "ADMIN candidate");

// CUSTOMER_B is intentionally still a plain platform CUSTOMER here.
let controllerState = await controller("state");
assert.equal(controllerState.qaProfiles, 0, "plain CUSTOMER baseline unexpectedly owns a profile");

const ownerInsert = await insertProfile(owner.token, ownerSlug, `Ban API Owner ${marker}`);
assert.ok(ownerInsert.response.ok && firstRow(ownerInsert.body)?.id, `OWNER fixture insert failed (${ownerInsert.response.status})`);
const ownerProfileId = String(firstRow(ownerInsert.body).id);
controllerState = await controller("state");
assert.ok(controllerState.qaProfiles >= 1, "OWNER_A profile ownership not persisted");
assert.ok(controllerState.qaOwners >= 1, "OWNER_A workspace OWNER contract not established");

const promoted = await controller("promote");
assert.equal(promoted.qaAdmins, 1);
assert.equal(promoted.superAdmins, 2);
const admin = await signIn(emails.admin);
assert.equal(admin.id, adminCandidate.id);
assert.equal((await productRequest(admin.token, "/api/admin/me")).status, 200);

// Distinct authorization probes: CUSTOMER_B has no profile; OWNER_A owns one.
const customerBanDenied = await productRequest(customer.token, `/api/admin/customers/${owner.id}/ban`, "POST", {});
const customerUnbanDenied = await productRequest(customer.token, `/api/admin/customers/${owner.id}/unban`, "POST", {});
const ownerBanDenied = await productRequest(owner.token, `/api/admin/customers/${customer.id}/ban`, "POST", {});
const ownerUnbanDenied = await productRequest(owner.token, `/api/admin/customers/${customer.id}/unban`, "POST", {});
for (const result of [customerBanDenied, customerUnbanDenied, ownerBanDenied, ownerUnbanDenied]) assert.equal(result.status, 403, "CUSTOMER/OWNER Admin Ban API must return 403");

const targetAttack = await productRequest(admin.token, `/api/admin/customers/${owner.id}/ban`, "POST", { userId: customer.id, reason: "must reject" });
assert.equal(targetAttack.status, 400, "arbitrary userId body field was accepted");
let banState = await controller("ban-state");
assert.equal(stateKind(banState.states, "customer").banned, false, "target attack changed OWNER_A");
assert.equal(stateKind(banState.states, "customer-b").banned, false, "target attack changed CUSTOMER_B");

assert.equal((await productRequest(admin.token, `/api/admin/customers/${owner.id}/ban`, "POST", { reason: "<script>" })).status, 400, "HTML-like reason accepted");
assert.equal((await productRequest(admin.token, `/api/admin/customers/${owner.id}/ban`, "POST", { expiresAt: new Date(Date.now() - 1000).toISOString() })).status, 400, "past expiry accepted");
assert.equal((await productRequest(admin.token, `/api/admin/customers/${owner.id}/ban`, "POST", { reason: "x".repeat(501) })).status, 400, "oversized reason accepted");

// CUSTOMER_B now gets its own tenant fixture for unaffected-user regression.
const customerInsert = await insertProfile(customer.token, customerSlug, `Ban API Customer ${marker}`);
assert.ok(customerInsert.response.ok && firstRow(customerInsert.body)?.id, `CUSTOMER_B fixture insert failed (${customerInsert.response.status})`);
const customerProfileId = String(firstRow(customerInsert.body).id);
controllerState = await controller("state");
assert.ok(controllerState.qaProfiles >= 2 && controllerState.qaOwners >= 2, "tenant fixtures not fully established");

const preBanToken = owner.token;
const tokenFingerprint = createHash("sha256").update(preBanToken).digest("hex");
assert.equal((await getSession(owner.jar)).active, true, "OWNER session missing before Ban API call");
banState = await controller("ban-state");
assert.ok(stateKind(banState.states, "customer").sessions >= 1, "OWNER DB session missing before Ban API call");

const reason = `qa-admin-ban-${marker}`;
const banResult = await productRequest(admin.token, `/api/admin/customers/${owner.id}/ban`, "POST", { reason });
assert.equal(banResult.status, 200, `SUPER_ADMIN Ban API failed (${banResult.status})`);
assert.equal(banResult.body?.customer?.id, owner.id);
assert.equal(banResult.body?.customer?.banned, true);
assert.equal(banResult.body?.customer?.reason, reason);
assert.equal(banResult.body?.sessionRevocation?.ok, true);
assert.ok(Number(banResult.body?.sessionRevocation?.revokedCount || 0) >= 1);
assert.equal(banResult.body?.auditRecorded, true);
assertNoSensitive(banResult.body, "Ban response");

banState = await controller("ban-state");
const ownerBannedState = stateKind(banState.states, "customer");
assert.equal(ownerBannedState.banned, true);
assert.equal(ownerBannedState.banReason, reason);
assert.equal(ownerBannedState.sessions, 0, "Ban API did not revoke all OWNER sessions");
assert.equal(stateKind(banState.states, "customer-b").banned, false, "Ban API affected CUSTOMER_B");

assert.equal(createHash("sha256").update(preBanToken).digest("hex"), tokenFingerprint, "pre-ban JWT variable changed");
assert.equal(await dataIdentity(preBanToken, owner.id), true, "pre-ban JWT was not identity-recognizable after product ban");
const ownerReadBanned = await selectProfile(preBanToken, ownerSlug);
assert.ok(!ownerReadBanned.response.ok || rows(ownerReadBanned.body).length === 0, "old JWT bypassed RLS after Ban API");
assert.equal((await getSession(owner.jar)).active, false, "existing Better Auth session remained active after Ban API");
assert.equal((await signInAttempt(emails.owner)).ok, false, "new login succeeded after Ban API");

const customerRead = await selectProfile(customer.token, customerSlug);
assert.ok(customerRead.response.ok && rows(customerRead.body).length === 1, "CUSTOMER_B own read broke during OWNER ban");
const customerUpdate = await updateProfile(customer.token, customerProfileId, `Ban API Customer active ${marker}`);
assert.ok(customerUpdate.response.ok && firstRow(customerUpdate.body)?.id === customerProfileId, "CUSTOMER_B own write broke during OWNER ban");
assert.equal((await productRequest(admin.token, "/api/admin/me")).status, 200, "ADMIN_SMOKE broke during OWNER ban");

const auditBan = await productRequest(admin.token, `/api/admin/audit?action=USER_BANNED&target=${encodeURIComponent(owner.id)}&limit=100`);
assert.equal(auditBan.status, 200);
const banAuditRow = (auditBan.body?.audit || []).find((row) => row.action === "USER_BANNED" && row.target_id === owner.id);
assert.ok(banAuditRow, "USER_BANNED audit missing");
assert.equal(banAuditRow.actor_auth_user_id, admin.id);
assert.equal(banAuditRow.target_type, "AUTH_USER");
assert.equal(banAuditRow.metadata?.reason, reason);
assertNoSensitive(banAuditRow, "USER_BANNED audit");

const unbanResult = await productRequest(admin.token, `/api/admin/customers/${owner.id}/unban`, "POST", {});
assert.equal(unbanResult.status, 200, `SUPER_ADMIN Unban API failed (${unbanResult.status})`);
assert.equal(unbanResult.body?.customer?.banned, false);
assert.equal(unbanResult.body?.auditRecorded, true);
assertNoSensitive(unbanResult.body, "Unban response");
banState = await controller("ban-state");
assert.equal(stateKind(banState.states, "customer").banned, false, "native state not unbanned");
const oldJwtAfterUnban = await selectProfile(preBanToken, ownerSlug);
assert.ok(oldJwtAfterUnban.response.ok && rows(oldJwtAfterUnban.body).length === 1, "old JWT did not regain tenant access after unban");
const relogin = await signIn(emails.owner);
assert.equal((await getSession(relogin.jar)).active, true, "new login did not recover after unban");

const auditUnban = await productRequest(admin.token, `/api/admin/audit?action=USER_UNBANNED&target=${encodeURIComponent(owner.id)}&limit=100`);
assert.equal(auditUnban.status, 200);
const unbanAuditRow = (auditUnban.body?.audit || []).find((row) => row.action === "USER_UNBANNED" && row.target_id === owner.id);
assert.ok(unbanAuditRow, "USER_UNBANNED audit missing");
assert.equal(unbanAuditRow.actor_auth_user_id, admin.id);
assertNoSensitive(unbanAuditRow, "USER_UNBANNED audit");

const expiryAt = new Date(Date.now() + 8000).toISOString();
const tempBan = await productRequest(admin.token, `/api/admin/customers/${owner.id}/ban`, "POST", { reason: `qa-temp-${marker}`, expiresAt: expiryAt });
assert.equal(tempBan.status, 200, `temporary Ban API failed (${tempBan.status})`);
assert.equal(tempBan.body?.customer?.banned, true);
assert.ok(tempBan.body?.customer?.expiresAt);
const duringTemp = await selectProfile(preBanToken, ownerSlug);
assert.ok(!duringTemp.response.ok || rows(duringTemp.body).length === 0, "old JWT bypassed temporary ban");
await sleep(Math.max(0, Date.parse(expiryAt) - Date.now()) + 2500);
const afterExpiry = await selectProfile(preBanToken, ownerSlug);
assert.ok(afterExpiry.response.ok && rows(afterExpiry.body).length === 1, "RLS did not release old JWT after temporary expiry");
assert.equal((await signInAttempt(emails.owner)).ok, true, "login did not recover after temporary expiry");

const finalUnban = await productRequest(admin.token, `/api/admin/customers/${owner.id}/unban`, "POST", {});
assert.ok(finalUnban.status === 200 || finalUnban.status === 207, "final unban cleanup failed");
assert.equal(stateKind((await controller("ban-state")).states, "customer-b").banned, false, "CUSTOMER_B changed during runtime");

console.log("ADMIN_BAN_UNBAN_API_RUNTIME: PASS", JSON.stringify({
  customerBanDenied: "PASS",
  customerUnbanDenied: "PASS",
  ownerBanDenied: "PASS",
  ownerUnbanDenied: "PASS",
  targetAttack: "DENIED",
  invalidInputs: "DENIED",
  superAdminBan: "PASS",
  sourceOfTruth: "PASS",
  sessionsRevoked: "PASS",
  sameJwtPreserved: true,
  sameJwtIdentityRecognizedAfterBan: true,
  oldJwtTenantAccessAfterBan: "DENIED",
  existingSessionAfterBan: "REVOKED",
  newLoginAfterBan: "DENIED",
  customerBPreserved: "PASS",
  adminPreserved: "PASS",
  auditBan: "PASS",
  superAdminUnban: "PASS",
  oldJwtAfterUnban: "PASS",
  newLoginAfterUnban: "PASS",
  auditUnban: "PASS",
  temporaryBan: "PASS",
  temporaryExpiry: "PASS",
  sensitiveFindings: 0,
  ownerProfileIdPresent: Boolean(ownerProfileId),
}));