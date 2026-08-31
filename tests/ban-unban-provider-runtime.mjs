import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";
const controllerUrl = process.env.AUDIT_SMOKE_CONTROLLER_URL || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24, "ephemeral smoke password missing");
assert.ok(controllerToken.length >= 32, "ephemeral controller token missing");
assert.ok(controllerUrl.startsWith("https://"), "ephemeral controller URL missing");

const emails = {
  customer: `audit-smoke-${marker}-customer@example.invalid`,
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
  try { return JSON.parse(text); } catch { return null; }
}

function retryAfterMs(response, attempt) {
  const raw = response.headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.max(seconds * 1000, 1000), 15000);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 1000), 15000);
  }
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
    console.log(`BAN_UNBAN_AUTH_RATE_LIMIT_RETRY: ${attempt + 1}/7 waitMs=${waitMs}`);
    await sleep(waitMs);
  }
  throw new Error("unreachable auth retry state");
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

async function signInAttempt(email) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return { jar, status: response.status, ok: response.ok };
}

async function getSession(jar) {
  const response = await authFetch(jar, "/get-session");
  const body = await readJson(response);
  const session = body?.session || body?.data?.session || null;
  const user = body?.user || body?.data?.user || null;
  return { active: Boolean(response.ok && session && user?.id), status: response.status };
}

async function dataIdentity(token, expectedId) {
  const response = await fetch(`${DATA_API}/rpc/current_auth_user_id`, {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  const body = await readJson(response);
  const value = typeof body === "string" ? body : Array.isArray(body) ? body[0]?.current_auth_user_id || body[0]?.auth_user_id : body?.current_auth_user_id || body?.auth_user_id;
  return { status: response.status, accepted: Boolean(response.ok && value === expectedId) };
}

async function waitForDataIdentity(token, expectedId, label) {
  let last = { status: 0, accepted: false };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    last = await dataIdentity(token, expectedId);
    if (last.accepted) return last;
    await sleep(500);
  }
  throw new Error(`${label} Data API token not ready after retry (last status ${last.status})`);
}

async function providerAdmin(jar, path, body) {
  const response = await authFetch(jar, path, { method: "POST", body: JSON.stringify(body) });
  await readJson(response);
  return response.status;
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

async function readBanState() {
  const body = await controller("ban-state");
  assert.ok(Array.isArray(body?.states), "ban-state controller missing states");
  return body.states;
}

function byKind(states, kind) {
  const found = states.find((state) => state?.kind === kind);
  assert.ok(found, `missing ${kind} ban state`);
  return found;
}

const preflight = await controller("preflight");
assert.equal(preflight.qaUsers, 0, "preflight QA users must be zero");
assert.equal(preflight.qaSessions, 0, "preflight QA sessions must be zero");
assert.equal(preflight.qaAdmins, 0, "preflight QA admins must be zero");
assert.equal(preflight.superAdmins, 1, "real SUPER_ADMIN baseline must be exactly one");
assert.equal(preflight.profilesWithoutOwner, 0, "profilesWithoutOwner baseline must be zero");

const customer = await signUp(emails.customer, "Ban Smoke Customer");
const adminCandidate = await signUp(emails.admin, "Ban Smoke Admin");
assert.notEqual(customer.id, adminCandidate.id, "customer/admin identity collision");
await waitForDataIdentity(customer.token, customer.id, "customer");
await waitForDataIdentity(adminCandidate.token, adminCandidate.id, "admin candidate");

const promoted = await controller("promote");
assert.equal(promoted.qaAdmins, 1, "ADMIN_SMOKE promotion missing");
assert.equal(promoted.superAdmins, 2, "temporary SUPER_ADMIN count must be two");
const admin = await signIn(emails.admin);
assert.equal(admin.id, adminCandidate.id, "ADMIN_SMOKE identity changed after promotion");
assert.equal((await getSession(customer.jar)).active, true, "customer baseline session inactive");
assert.equal((await getSession(admin.jar)).active, true, "admin baseline session inactive");

const customerBanDenied = await providerAdmin(customer.jar, "/admin/ban-user", { userId: admin.id, banReason: "qa-denied" });
const customerUnbanDenied = await providerAdmin(customer.jar, "/admin/unban-user", { userId: admin.id });
assert.ok(customerBanDenied === 401 || customerBanDenied === 403, `CUSTOMER ban authorization expected 401/403, got ${customerBanDenied}`);
assert.ok(customerUnbanDenied === 401 || customerUnbanDenied === 403, `CUSTOMER unban authorization expected 401/403, got ${customerUnbanDenied}`);
assert.equal((await getSession(admin.jar)).active, true, "customer authorization probe changed admin session");

let states = await readBanState();
let customerState = byKind(states, "customer");
assert.equal(customerState.banned, false, "customer baseline banned must be false");
assert.equal(customerState.banReason, null, "customer baseline banReason must be null");
assert.equal(customerState.banExpires, null, "customer baseline banExpires must be null");
assert.ok(customerState.sessions >= 1, "customer baseline DB session missing");

const permanentReason = `qa-provider-ban-${marker}`;
const banStatus = await providerAdmin(admin.jar, "/admin/ban-user", { userId: customer.id, banReason: permanentReason });
assert.ok(banStatus >= 200 && banStatus < 300, `Admin Plugin ban-user failed (${banStatus})`);

states = await readBanState();
customerState = byKind(states, "customer");
assert.equal(customerState.banned, true, "neon_auth.user.banned did not become true");
assert.equal(customerState.banReason, permanentReason, "neon_auth.user.banReason mismatch");
assert.equal(customerState.banExpires, null, "permanent ban unexpectedly has banExpires");
const sessionsAfterPermanentBan = customerState.sessions;

const existingSessionAfterBan = await getSession(customer.jar);
const bearerAfterBan = await dataIdentity(customer.token, customer.id);
const bannedLogin = await signInAttempt(emails.customer);
assert.equal(bannedLogin.ok, false, "banned customer could create a new login");
assert.equal((await getSession(bannedLogin.jar)).active, false, "banned login attempt created a session");

const unbanStatus = await providerAdmin(admin.jar, "/admin/unban-user", { userId: customer.id });
assert.ok(unbanStatus >= 200 && unbanStatus < 300, `Admin Plugin unban-user failed (${unbanStatus})`);
states = await readBanState();
customerState = byKind(states, "customer");
assert.equal(customerState.banned, false, "neon_auth.user.banned did not return false after unban");
const postUnban = await signIn(emails.customer);
assert.equal((await getSession(postUnban.jar)).active, true, "unbanned customer could not sign in");

const expirySeconds = 5;
const expiryReason = `qa-expiry-${marker}`;
const expiryBanStatus = await providerAdmin(admin.jar, "/admin/ban-user", { userId: customer.id, banReason: expiryReason, banExpiresIn: expirySeconds });
assert.ok(expiryBanStatus >= 200 && expiryBanStatus < 300, `Admin Plugin expiring ban failed (${expiryBanStatus})`);
states = await readBanState();
customerState = byKind(states, "customer");
assert.equal(customerState.banned, true, "expiring ban did not set banned=true");
assert.equal(customerState.banReason, expiryReason, "expiring ban reason mismatch");
assert.ok(customerState.banExpires, "expiring ban did not populate banExpires");
const expiryAt = Date.parse(customerState.banExpires);
assert.ok(Number.isFinite(expiryAt) && expiryAt > Date.now() - 1000, "banExpires is not a valid future timestamp");
const loginBeforeExpiry = await signInAttempt(emails.customer);
assert.equal(loginBeforeExpiry.ok, false, "customer could sign in before ban expiry");

const waitMs = Math.max(0, expiryAt - Date.now()) + 2500;
await sleep(Math.min(waitMs, 12000));
const loginAfterExpiry = await signInAttempt(emails.customer);
assert.equal(loginAfterExpiry.ok, true, `customer could not sign in after ban expiry (${loginAfterExpiry.status})`);
states = await readBanState();
const expiredDbState = byKind(states, "customer");

const finalUnbanStatus = await providerAdmin(admin.jar, "/admin/unban-user", { userId: customer.id });
assert.ok(finalUnbanStatus >= 200 && finalUnbanStatus < 300, `final Admin Plugin unban-user failed (${finalUnbanStatus})`);
states = await readBanState();
customerState = byKind(states, "customer");
assert.equal(customerState.banned, false, "final unban did not leave banned=false");
assert.equal((await getSession(admin.jar)).active, true, "ban/unban probe invalidated ADMIN_SMOKE");

console.log("BAN_UNBAN_PROVIDER_RUNTIME: PASS", JSON.stringify({
  customerBanDenied: "PASS",
  customerUnbanDenied: "PASS",
  sourceOfTruth: "neon_auth.user.banned",
  permanentBan: "PASS",
  banReason: "PASS",
  permanentBanExpires: null,
  existingSessionRevoked: existingSessionAfterBan.active === false,
  dbSessionsAfterPermanentBan: sessionsAfterPermanentBan,
  bannedLoginDenied: "PASS",
  preBanBearerAcceptedAfterBan: bearerAfterBan.accepted,
  unban: "PASS",
  unbanLogin: "PASS",
  expiryField: "PASS",
  expiryLoginDeniedBefore: "PASS",
  expiryLoginAllowedAfter: "PASS",
  expiredDbBannedValue: expiredDbState.banned,
  finalUnban: "PASS",
  adminSessionPreserved: "PASS",
}));