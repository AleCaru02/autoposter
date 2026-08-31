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
assert.ok(password.length >= 24, "ephemeral smoke password missing");
assert.ok(controllerToken.length >= 32, "controller token missing");
assert.ok(controllerUrl.startsWith("https://"), "controller URL missing");

const emails = {
  customer: `audit-smoke-${marker}-customer@example.invalid`,
  customerB: `audit-smoke-${marker}-customer-b@example.invalid`,
  admin: `audit-smoke-${marker}-admin@example.invalid`,
};
const slugs = {
  a: `qa-a-${marker}`,
  aDelete: `qa-a-delete-${marker}`,
  aBlockedInsert: `qa-a-blocked-${marker}`,
  b: `qa-b-${marker}`,
};
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
    console.log(`BANNED_RLS_AUTH_RATE_LIMIT_RETRY: ${attempt + 1}/7 waitMs=${waitMs}`);
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
  const session = body?.session || body?.data?.session || null;
  const user = body?.user || body?.data?.user || null;
  return { active: Boolean(response.ok && session && user?.id), status: response.status };
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
  return { status: result.response.status, accepted: Boolean(result.response.ok && value === expectedId) };
}

async function waitForDataIdentity(token, expectedId, label) {
  let last = { status: 0, accepted: false };
  for (let attempt = 0; attempt < 24; attempt += 1) {
    last = await dataIdentity(token, expectedId);
    if (last.accepted) return last;
    await sleep(500);
  }
  throw new Error(`${label} Data API identity not ready (last status ${last.status})`);
}

function profilePath(params = {}) {
  const search = new URLSearchParams(params);
  return `/profiles?${search.toString()}`;
}

async function insertProfile(token, slug, name) {
  return dataFetch(token, profilePath({ select: "id,name,slug" }), {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name, slug, website_url: null, industry: "QA security" }),
  });
}

async function selectProfile(token, slug) {
  return dataFetch(token, profilePath({ select: "id,name,slug", slug: `eq.${slug}` }));
}

async function updateProfile(token, id, name) {
  return dataFetch(token, profilePath({ select: "id,name,slug", id: `eq.${id}` }), {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name, updated_at: new Date().toISOString() }),
  });
}

async function deleteProfile(token, id) {
  return dataFetch(token, profilePath({ select: "id", id: `eq.${id}` }), {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
}

function rows(body) { return Array.isArray(body) ? body : []; }
function firstRow(body) { return rows(body)[0] || null; }
function noRow(result) { return !result.response.ok || rows(result.body).length === 0; }

async function productAdminMe(token) {
  const response = await fetch(`${APP_BASE}/api/admin/me`, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
  await readJson(response);
  return response.status;
}

function byKind(states, kind) {
  const found = states.find((state) => state?.kind === kind);
  assert.ok(found, `missing ${kind} provider state`);
  return found;
}

function profileBySlug(fixture, slug) {
  return (fixture?.profiles || []).find((profile) => profile.slug === slug) || null;
}

const customer = await signUp(emails.customer, "Banned RLS Customer A");
const customerB = await signUp(emails.customerB, "Banned RLS Customer B");
const adminCandidate = await signUp(emails.admin, "Banned RLS Admin");
assert.notEqual(customer.id, customerB.id, "customer identities collided");
assert.notEqual(customer.id, adminCandidate.id, "customer/admin identities collided");
await waitForDataIdentity(customer.token, customer.id, "CUSTOMER_A");
await waitForDataIdentity(customerB.token, customerB.id, "CUSTOMER_B");
await waitForDataIdentity(adminCandidate.token, adminCandidate.id, "ADMIN candidate");

const promoted = await controller("promote");
assert.equal(promoted.qaAdmins, 1, "ADMIN_SMOKE promotion missing");
assert.equal(promoted.superAdmins, 2, "temporary SUPER_ADMIN count must be two");
const admin = await signIn(emails.admin);
assert.equal(admin.id, adminCandidate.id, "ADMIN_SMOKE identity changed after promotion");
assert.equal(await productAdminMe(admin.token), 200, "SUPER_ADMIN product boundary unavailable before ban test");

const preBanToken = customer.token;
const preBanFingerprint = createHash("sha256").update(preBanToken).digest("hex");

const insertA = await insertProfile(preBanToken, slugs.a, `QA A ${marker}`);
assert.ok(insertA.response.ok && firstRow(insertA.body)?.id, `pre-ban INSERT A failed (${insertA.response.status})`);
const aId = String(firstRow(insertA.body).id);
const insertDelete = await insertProfile(preBanToken, slugs.aDelete, `QA A delete ${marker}`);
assert.ok(insertDelete.response.ok && firstRow(insertDelete.body)?.id, `pre-ban INSERT delete fixture failed (${insertDelete.response.status})`);
const aDeleteId = String(firstRow(insertDelete.body).id);
const insertB = await insertProfile(customerB.token, slugs.b, `QA B ${marker}`);
assert.ok(insertB.response.ok && firstRow(insertB.body)?.id, `CUSTOMER_B fixture INSERT failed (${insertB.response.status})`);
const bId = String(firstRow(insertB.body).id);

const readBefore = await selectProfile(preBanToken, slugs.a);
assert.ok(readBefore.response.ok && rows(readBefore.body).length === 1, "pre-ban own SELECT failed");
const crossBefore = await selectProfile(preBanToken, slugs.b);
assert.ok(crossBefore.response.ok && rows(crossBefore.body).length === 0, "cross-tenant profile became visible before ban");
const updatedName = `QA A updated ${marker}`;
const updateBefore = await updateProfile(preBanToken, aId, updatedName);
assert.ok(updateBefore.response.ok && firstRow(updateBefore.body)?.name === updatedName, "pre-ban own UPDATE failed");
const deleteBefore = await deleteProfile(preBanToken, aDeleteId);
assert.ok(deleteBefore.response.ok && firstRow(deleteBefore.body)?.id === aDeleteId, "pre-ban own DELETE failed");

let fixture = await controller("fixture-state");
assert.ok(profileBySlug(fixture, slugs.a), "A fixture missing before ban");
assert.ok(profileBySlug(fixture, slugs.b), "B fixture missing before ban");
assert.equal(profileBySlug(fixture, slugs.aDelete), null, "pre-ban DELETE fixture still exists");

const banReason = `qa-banned-rls-${marker}`;
const banStatus = await providerAdmin(admin.jar, "/admin/ban-user", { userId: customer.id, banReason });
assert.ok(banStatus >= 200 && banStatus < 300, `native permanent ban failed (${banStatus})`);
let providerState = await controller("ban-state");
assert.equal(byKind(providerState.states, "customer").banned, true, "provider banned state did not become true");

const tokenSame = createHash("sha256").update(preBanToken).digest("hex") === preBanFingerprint;
assert.equal(tokenSame, true, "pre-ban JWT variable changed");
const identityAfterBan = await dataIdentity(preBanToken, customer.id);
assert.equal(identityAfterBan.accepted, true, "pre-ban JWT was invalidated instead of being denied by tenant RLS");

const readAfter = await selectProfile(preBanToken, slugs.a);
assert.equal(noRow(readAfter), true, "same pre-ban JWT could SELECT tenant data after ban");
const insertAfter = await insertProfile(preBanToken, slugs.aBlockedInsert, `QA SHOULD NOT INSERT ${marker}`);
assert.equal(noRow(insertAfter), true, "same pre-ban JWT could INSERT tenant data after ban");
const updateAfter = await updateProfile(preBanToken, aId, `QA SHOULD NOT UPDATE ${marker}`);
assert.equal(noRow(updateAfter), true, "same pre-ban JWT could UPDATE tenant data after ban");
const deleteAfter = await deleteProfile(preBanToken, aId);
assert.equal(noRow(deleteAfter), true, "same pre-ban JWT could DELETE tenant data after ban");
const crossAfter = await selectProfile(preBanToken, slugs.b);
assert.ok(crossAfter.response.ok && rows(crossAfter.body).length === 0, "cross-tenant isolation changed after ban");

fixture = await controller("fixture-state");
const aAfterDeniedWrites = profileBySlug(fixture, slugs.a);
assert.ok(aAfterDeniedWrites, "denied DELETE removed A fixture");
assert.equal(aAfterDeniedWrites.name, updatedName, "denied UPDATE modified A fixture");
assert.equal(profileBySlug(fixture, slugs.aBlockedInsert), null, "denied INSERT created a fixture");

const bannedLogin = await signInAttempt(emails.customer);
assert.equal(bannedLogin.ok, false, "new login succeeded while customer was banned");
assert.equal((await getSession(customerB.jar)).active, true, "Customer B session was affected by Customer A ban");
const bReadAfterBan = await selectProfile(customerB.token, slugs.b);
assert.ok(bReadAfterBan.response.ok && rows(bReadAfterBan.body).length === 1, "active Customer B lost own read access");
const bUpdatedName = `QA B active ${marker}`;
const bUpdateAfterBan = await updateProfile(customerB.token, bId, bUpdatedName);
assert.ok(bUpdateAfterBan.response.ok && firstRow(bUpdateAfterBan.body)?.name === bUpdatedName, "active Customer B lost own write access");
assert.equal((await getSession(admin.jar)).active, true, "ADMIN_SMOKE session was affected by Customer A ban");
assert.equal(await productAdminMe(admin.token), 200, "SUPER_ADMIN product boundary was affected by Customer A ban");

const unbanStatus = await providerAdmin(admin.jar, "/admin/unban-user", { userId: customer.id });
assert.ok(unbanStatus >= 200 && unbanStatus < 300, `native unban failed (${unbanStatus})`);
providerState = await controller("ban-state");
assert.equal(byKind(providerState.states, "customer").banned, false, "provider banned state did not return false after unban");
const oldJwtAfterUnban = await selectProfile(preBanToken, slugs.a);
assert.ok(oldJwtAfterUnban.response.ok && rows(oldJwtAfterUnban.body).length === 1, "old pre-ban JWT did not regain RLS access after unban");

const expirySeconds = 5;
const tempBanStatus = await providerAdmin(admin.jar, "/admin/ban-user", { userId: customer.id, banReason: `qa-expiry-${marker}`, banExpiresIn: expirySeconds });
assert.ok(tempBanStatus >= 200 && tempBanStatus < 300, `temporary ban failed (${tempBanStatus})`);
providerState = await controller("ban-state");
const tempState = byKind(providerState.states, "customer");
assert.equal(tempState.banned, true, "temporary ban did not set banned=true");
assert.ok(tempState.banExpires, "temporary ban did not expose native banExpires");
const duringTempBan = await selectProfile(preBanToken, slugs.a);
assert.equal(noRow(duringTempBan), true, "old JWT remained authorized during temporary ban");
const expiryAt = Date.parse(tempState.banExpires);
assert.ok(Number.isFinite(expiryAt), "native banExpires is not parseable");
await sleep(Math.max(0, expiryAt - Date.now()) + 2500);
const stateBeforePostExpiryLogin = await controller("ban-state");
const expiredNativeState = byKind(stateBeforePostExpiryLogin.states, "customer");
const oldJwtAfterExpiry = await selectProfile(preBanToken, slugs.a);
assert.ok(oldJwtAfterExpiry.response.ok && rows(oldJwtAfterExpiry.body).length === 1, "old JWT did not follow effective provider expiry at the RLS boundary");
const loginAfterExpiry = await signInAttempt(emails.customer);
assert.equal(loginAfterExpiry.ok, true, `new login did not recover after temporary ban expiry (${loginAfterExpiry.status})`);

const finalUnbanStatus = await providerAdmin(admin.jar, "/admin/unban-user", { userId: customer.id });
assert.ok(finalUnbanStatus >= 200 && finalUnbanStatus < 300, `final unban cleanup failed (${finalUnbanStatus})`);
const rls = await controller("rls-state");
assert.deepEqual(rls, { tenantTables: 17, rlsEnabled: 17, restrictiveBarriers: 17, activeBarrierTables: 17 }, "banned-user RLS coverage incomplete");

console.log("BANNED_USER_RLS_RUNTIME: PASS", JSON.stringify({
  readBeforeBan: "PASS",
  insertBeforeBan: "PASS",
  updateBeforeBan: "PASS",
  deleteBeforeBan: "PASS",
  tokenSame: true,
  tokenStillCryptographicallyAcceptedAfterBan: true,
  sameJwtReadAfterBan: "DENIED",
  sameJwtInsertAfterBan: "DENIED",
  sameJwtUpdateAfterBan: "DENIED",
  sameJwtDeleteAfterBan: "DENIED",
  newLoginAfterBan: "DENIED",
  crossTenantBeforeBan: "DENIED",
  crossTenantAfterBan: "DENIED",
  customerBActiveRead: "PASS",
  customerBActiveWrite: "PASS",
  adminPreserved: "PASS",
  unban: "PASS",
  oldJwtAfterUnban: "PASS",
  temporaryBanDuring: "DENIED",
  nativeBannedValueAfterExpiryBeforeLogin: expiredNativeState.banned,
  oldJwtAfterTemporaryExpiry: "PASS",
  newLoginAfterTemporaryExpiry: "PASS",
  rls,
}));