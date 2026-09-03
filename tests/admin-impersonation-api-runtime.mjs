import assert from "node:assert/strict";
import { chromium } from "playwright";

const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const AUTH_URL = `${APP_BASE}/api/auth`;
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";
const controllerUrl = process.env.AUDIT_SMOKE_CONTROLLER_URL || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);
assert.ok(controllerToken.length >= 32);
assert.ok(controllerUrl.startsWith("https://"));

const emails = {
  customer: `audit-smoke-${marker}-customer@example.invalid`,
  customerB: `audit-smoke-${marker}-customer-b@example.invalid`,
  admin: `audit-smoke-${marker}-admin@example.invalid`,
};
const customerSlug = `qa-impersonation-api-a-${marker}`;
const customerBSlug = `qa-impersonation-api-b-${marker}`;
const customerName = `Impersonation API Customer A ${marker}`;
const customerBName = `Impersonation API Customer B ${marker}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor(values) { this.values = new Map(values || []); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
      const parts = String(raw).split(";").map((part) => part.trim());
      const pair = parts[0] || "";
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = parts.some((part) => /^max-age=0$/i.test(part));
      if (expired || !value) this.values.delete(name); else this.values.set(name, value);
    }
  }
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
  clone() { return new CookieJar(this.values); }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function retryAfterMs(response, attempt) {
  const seconds = Number(response.headers.get("retry-after"));
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.max(seconds * 1000, 1000), 15000);
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
    console.log("IMPERSONATION_API_AUTH_RATE_LIMIT_RETRY:", JSON.stringify({ attempt: attempt + 1, waitMs }));
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

async function tokenFor(jar) {
  const response = await authFetch(jar, "/token");
  const body = await readJson(response);
  const token = body?.token || body?.data?.token || "";
  assert.ok(response.ok && typeof token === "string" && token.length > 40, `same-origin Auth token unavailable (${response.status})`);
  return token;
}

async function signUp(email, name) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  assert.ok(response.ok, `same-origin Auth sign-up failed (${response.status})`);
  const token = await tokenFor(jar);
  return { jar, token, id: decodeSub(token) };
}

async function signIn(email) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  assert.ok(response.ok, `same-origin Auth sign-in failed (${response.status})`);
  const token = await tokenFor(jar);
  return { jar, token, id: decodeSub(token) };
}

function sessionInfo(body) {
  const root = body?.data && typeof body.data === "object" ? body.data : body;
  const session = root?.session && typeof root.session === "object" ? root.session : null;
  const user = root?.user && typeof root.user === "object" ? root.user : null;
  return {
    active: Boolean(session && user?.id),
    userId: typeof user?.id === "string" ? user.id : null,
    role: typeof user?.role === "string" ? user.role.toLowerCase() : null,
    impersonatedBy: typeof session?.impersonatedBy === "string" ? session.impersonatedBy : typeof session?.impersonated_by === "string" ? session.impersonated_by : null,
  };
}

async function getSession(jar) {
  const response = await authFetch(jar, "/get-session");
  const body = await readJson(response);
  return { status: response.status, ...sessionInfo(body) };
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

async function waitIdentity(token, id, label) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await dataFetch(token, "/rpc/current_auth_user_id", { method: "POST", body: "{}" });
    const value = typeof result.body === "string" ? result.body : Array.isArray(result.body) ? result.body[0]?.current_auth_user_id || result.body[0]?.auth_user_id : result.body?.current_auth_user_id || result.body?.auth_user_id;
    if (result.response.ok && value === id) return;
    await sleep(500);
  }
  throw new Error(`${label} Data API identity not ready`);
}

async function insertProfile(token, slug, name) {
  return dataFetch(token, "/profiles?select=id,name,slug", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name, slug, website_url: null, industry: "QA impersonation API" }),
  });
}

async function selectProfile(token, slug) {
  return dataFetch(token, `/profiles?select=id,name,slug&slug=eq.${encodeURIComponent(slug)}`);
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

async function productMutation(jar, token, path, body = {}) {
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    origin: APP_BASE,
    referer: `${APP_BASE}/`,
  });
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${APP_BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body), redirect: "manual" });
  const cookieHeaderCount = response.headers.getSetCookie?.().length || 0;
  jar.absorb(response.headers);
  return { status: response.status, ok: response.ok, body: await readJson(response), cookieHeaderCount };
}

function assertDenied(result, label, statuses = [400, 401, 403, 404, 409]) {
  assert.ok(statuses.includes(result.status), `${label} unexpectedly returned ${result.status}`);
}

function assertSafeResponse(body, mode) {
  assert.ok(body && typeof body === "object" && !Array.isArray(body), `${mode} response is not an object`);
  assert.deepEqual(Object.keys(body).sort(), ["auditRecorded", "impersonation"]);
  assert.equal(body.auditRecorded, true, `${mode} audit was not persisted`);
  assert.ok(body.impersonation && typeof body.impersonation === "object");
  assert.deepEqual(Object.keys(body.impersonation).sort(), ["active", "actor", "target"]);
  assert.deepEqual(Object.keys(body.impersonation.actor || {}).sort(), ["id"]);
  if (mode === "start") assert.deepEqual(Object.keys(body.impersonation.target || {}).sort(), ["email", "id", "name"]);
  else assert.deepEqual(Object.keys(body.impersonation.target || {}).sort(), ["id"]);
  const forbidden = /(token|cookie|secret|authorization|password|credential|sessionid|session_id|useragent|user_agent|ipaddress|ip_address)/i;
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.test(key), false, `${mode} response exposed forbidden field ${key}`);
      walk(child);
    }
  };
  walk(body);
  return Object.entries(body).map(([key, value]) => ({ key, type: Array.isArray(value) ? "array" : value === null ? "null" : typeof value }));
}

function userByKind(state, kind) {
  const found = state.users?.find((item) => item?.kind === kind);
  assert.ok(found, `missing ${kind} user state`);
  return found;
}

async function browserLogin(page, email) {
  const response = await page.goto(`${APP_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(response?.status(), 200);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20000 });
}

async function browserJson(page, path, init = {}) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, { credentials: "include", ...init, headers: { accept: "application/json", ...(init.headers || {}) } });
    let body = null;
    try { body = await response.json(); } catch { /* ignore */ }
    return { status: response.status, ok: response.ok, body };
  }, { path, init });
}

const customer = await signUp(emails.customer, customerName);
await sleep(400);
const customerB = await signUp(emails.customerB, customerBName);
await sleep(400);
const adminCandidate = await signUp(emails.admin, `Impersonation API Admin ${marker}`);
await waitIdentity(customer.token, customer.id, "CUSTOMER_A");
await waitIdentity(customerB.token, customerB.id, "CUSTOMER_B");
await waitIdentity(adminCandidate.token, adminCandidate.id, "ADMIN candidate");

let state = await controller("state");
assert.equal(state.qaUsers, 3);
assert.equal(state.qaAdmins, 0);
assert.equal(state.qaProfiles, 0);

const customerInsert = await insertProfile(customer.token, customerSlug, customerName);
assert.ok(customerInsert.response.ok && firstRow(customerInsert.body)?.id, `CUSTOMER_A profile insert failed (${customerInsert.response.status})`);
state = await controller("state");
assert.ok(state.qaProfiles >= 1 && state.qaOwners >= 1, "CUSTOMER_A OWNER fixture missing");

const customerStartDenied = await productMutation(customerB.jar, customerB.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/impersonate`);
assert.equal(customerStartDenied.status, 403, "CUSTOMER start was not denied");
const ownerStartDenied = await productMutation(customer.jar, customer.token, `/api/admin/customers/${encodeURIComponent(customerB.id)}/impersonate`);
assert.equal(ownerStartDenied.status, 403, "OWNER start was not denied");
const normalCustomerStop = await productMutation(customerB.jar, customerB.token, "/api/admin/impersonation/stop");
assert.equal(normalCustomerStop.status, 403, "normal CUSTOMER stop was not denied");

const customerBInsert = await insertProfile(customerB.token, customerBSlug, customerBName);
assert.ok(customerBInsert.response.ok && firstRow(customerBInsert.body)?.id, `CUSTOMER_B profile insert failed (${customerBInsert.response.status})`);

const promoted = await controller("promote");
assert.equal(promoted.qaAdmins, 1);
assert.equal(promoted.superAdmins, 2);
await sleep(300);
const admin = await signIn(emails.admin);
assert.equal(admin.id, adminCandidate.id);
const baseline = await getSession(admin.jar);
assert.equal(baseline.active, true);
assert.equal(baseline.userId, admin.id);
assert.equal(baseline.role, "admin");
assert.equal(baseline.impersonatedBy, null);
assert.equal((await productRequest(admin.token, "/api/admin/me")).status, 200);

const foreignOriginJar = admin.jar.clone();
const foreignOriginHeaders = new Headers({ accept: "application/json", authorization: `Bearer ${admin.token}`, "content-type": "application/json", origin: "https://evil.invalid", referer: "https://evil.invalid/", cookie: foreignOriginJar.header() });
const foreignOriginResponse = await fetch(`${APP_BASE}/api/admin/customers/${encodeURIComponent(customer.id)}/impersonate`, { method: "POST", headers: foreignOriginHeaders, body: "{}" });
assert.equal(foreignOriginResponse.status, 403, "foreign Origin impersonation start was not denied");
try { await foreignOriginResponse.body?.cancel(); } catch { /* ignore */ }

const invalidBodyAdmin = await signIn(emails.admin);
const invalidBody = await productMutation(invalidBodyAdmin.jar, invalidBodyAdmin.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/impersonate`, { userId: customerB.id, email: emails.customerB, role: "admin", sessionId: "client-controlled" });
assert.equal(invalidBody.status, 400, "client-controlled target/session body was not denied");

const invalidAdmin = await signIn(emails.admin);
const invalidTarget = await productMutation(invalidAdmin.jar, invalidAdmin.token, "/api/admin/customers/00000000-0000-0000-0000-000000000000/impersonate");
assert.equal(invalidTarget.status, 404, "missing target was not denied with 404");

const selfAdmin = await signIn(emails.admin);
const selfTarget = await productMutation(selfAdmin.jar, selfAdmin.token, `/api/admin/customers/${encodeURIComponent(selfAdmin.id)}/impersonate`);
assert.equal(selfTarget.status, 400, "self Admin target was not denied");

const banAdmin = await signIn(emails.admin);
const ban = await productRequest(banAdmin.token, `/api/admin/customers/${encodeURIComponent(customerB.id)}/ban`, "POST", { reason: `qa-impersonation-api-${marker}` });
assert.ok(ban.status === 200 || ban.status === 207, `banned-target setup failed (${ban.status})`);
const bannedState = await controller("user-state");
assert.equal(userByKind(bannedState, "customer-b").banned, true);
const bannedStart = await productMutation(banAdmin.jar, banAdmin.token, `/api/admin/customers/${encodeURIComponent(customerB.id)}/impersonate`);
assert.equal(bannedStart.status, 409, "banned target impersonation was not denied");
const unban = await productRequest(banAdmin.token, `/api/admin/customers/${encodeURIComponent(customerB.id)}/unban`, "POST", {});
assert.ok(unban.status === 200 || unban.status === 207, `banned-target cleanup failed (${unban.status})`);
assert.equal(userByKind(await controller("user-state"), "customer-b").banned, false);

const adminHappy = await signIn(emails.admin);
const originalAdminToken = adminHappy.token;
const start = await productMutation(adminHappy.jar, originalAdminToken, `/api/admin/customers/${encodeURIComponent(customer.id)}/impersonate`);
assert.equal(start.status, 200, `product impersonation start failed (${start.status})`);
const startFields = assertSafeResponse(start.body, "start");
assert.ok(start.cookieHeaderCount >= 1, "product start returned no session Set-Cookie header");
assert.equal(start.body.impersonation.active, true);
assert.equal(start.body.impersonation.actor.id, adminHappy.id);
assert.equal(start.body.impersonation.target.id, customer.id);

const afterStart = await getSession(adminHappy.jar);
assert.equal(afterStart.active, true);
assert.equal(afterStart.userId, customer.id, "product start did not switch current identity to CUSTOMER_A");
assert.equal(afterStart.impersonatedBy, adminHappy.id, "product start did not preserve native impersonatedBy actor");
const impersonatedToken = await tokenFor(adminHappy.jar);
assert.equal(decodeSub(impersonatedToken), customer.id);
const dbAfterStart = await controller("impersonation-state");
assert.ok(dbAfterStart.summary.impersonated >= 1 && dbAfterStart.summary.impersonatedByAdmin >= 1, "native impersonation session not persisted");

const ownRead = await selectProfile(impersonatedToken, customerSlug);
assert.ok(ownRead.response.ok && rows(ownRead.body).length === 1, "impersonated CUSTOMER_A cannot read own tenant");
const otherRead = await selectProfile(impersonatedToken, customerBSlug);
assert.ok(!otherRead.response.ok || rows(otherRead.body).length === 0, "impersonated CUSTOMER_A crossed into CUSTOMER_B tenant");
assert.equal((await productRequest(impersonatedToken, "/api/admin/customers")).status, 403, "Admin APIs remained available to impersonated CUSTOMER");

const nested = await productMutation(adminHappy.jar, originalAdminToken, `/api/admin/customers/${encodeURIComponent(customerB.id)}/impersonate`);
assertDenied(nested, "nested product impersonation", [403, 409]);
for (let attempt = 0; attempt < 3; attempt += 1) {
  const persisted = await getSession(adminHappy.jar);
  assert.equal(persisted.userId, customer.id);
  assert.equal(persisted.impersonatedBy, adminHappy.id);
}

const oldImpersonatedJar = adminHappy.jar.clone();
const stop = await productMutation(adminHappy.jar, impersonatedToken, "/api/admin/impersonation/stop");
assert.equal(stop.status, 200, `product impersonation stop failed (${stop.status})`);
const stopFields = assertSafeResponse(stop.body, "stop");
assert.ok(stop.cookieHeaderCount >= 1, "product stop returned no session Set-Cookie header");
assert.equal(stop.body.impersonation.active, false);
assert.equal(stop.body.impersonation.actor.id, adminHappy.id);
assert.equal(stop.body.impersonation.target.id, customer.id);
const restored = await getSession(adminHappy.jar);
assert.equal(restored.active, true);
assert.equal(restored.userId, adminHappy.id, "Admin identity was not restored");
assert.equal(restored.impersonatedBy, null, "impersonatedBy was not cleared");
const restoredToken = await tokenFor(adminHappy.jar);
assert.equal(decodeSub(restoredToken), adminHappy.id);
assert.equal((await productRequest(restoredToken, "/api/admin/me")).status, 200, "Admin API access was not restored");
const oldContext = await getSession(oldImpersonatedJar);
assert.ok(!(oldContext.active && oldContext.userId === customer.id), "old impersonated cookie context remained active after stop");
assert.equal((await controller("impersonation-state")).summary.impersonated, 0, "native impersonated session remained after stop");

const audit = await controller("audit-state");
const startedEvent = audit.events?.find((event) => event.action === "IMPERSONATION_STARTED" && event.actorKind === "admin" && event.targetKind === "customer");
const endedEvent = audit.events?.find((event) => event.action === "IMPERSONATION_ENDED" && event.actorKind === "admin" && event.targetKind === "customer");
assert.ok(startedEvent && startedEvent.provider === "NEON_MANAGED_AUTH" && startedEvent.sessionBound === true, "start audit event missing or unsafe");
assert.ok(endedEvent && endedEvent.provider === "NEON_MANAGED_AUTH" && endedEvent.sessionBound === true, "stop audit event missing or unsafe");

const browser = await chromium.launch({ headless: true });
let browserDirectNeon = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("request", (request) => {
    try { if (new URL(request.url()).hostname.includes("neonauth")) browserDirectNeon += 1; } catch { /* ignore */ }
  });
  await browserLogin(page, emails.admin);
  const browserAdminTokenResult = await browserJson(page, "/api/auth/token");
  const browserAdminToken = browserAdminTokenResult.body?.token || browserAdminTokenResult.body?.data?.token || "";
  assert.ok(browserAdminTokenResult.ok && browserAdminToken.length > 40);

  const browserStart = await browserJson(page, `/api/admin/customers/${encodeURIComponent(customer.id)}/impersonate`, {
    method: "POST",
    headers: { authorization: `Bearer ${browserAdminToken}`, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(browserStart.status, 200, `browser product start failed (${browserStart.status})`);
  assertSafeResponse(browserStart.body, "start");
  const browserSessionAfter = await browserJson(page, "/api/auth/get-session");
  const browserAfterInfo = sessionInfo(browserSessionAfter.body);
  assert.equal(browserAfterInfo.userId, customer.id);
  assert.equal(browserAfterInfo.impersonatedBy, adminHappy.id);
  const browserCustomerTokenResult = await browserJson(page, "/api/auth/token");
  const browserCustomerToken = browserCustomerTokenResult.body?.token || browserCustomerTokenResult.body?.data?.token || "";
  assert.ok(browserCustomerToken.length > 40);
  const browserAdminDenied = await browserJson(page, "/api/admin/me", { headers: { authorization: `Bearer ${browserCustomerToken}` } });
  assert.equal(browserAdminDenied.status, 403);

  const browserStop = await browserJson(page, "/api/admin/impersonation/stop", {
    method: "POST",
    headers: { authorization: `Bearer ${browserCustomerToken}`, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(browserStop.status, 200, `browser product stop failed (${browserStop.status})`);
  assertSafeResponse(browserStop.body, "stop");
  const browserRestoredSession = await browserJson(page, "/api/auth/get-session");
  const browserRestoredInfo = sessionInfo(browserRestoredSession.body);
  assert.equal(browserRestoredInfo.userId, adminHappy.id);
  assert.equal(browserRestoredInfo.impersonatedBy, null);
  assert.equal(browserDirectNeon, 0, "regular browser made direct Neon Auth requests during product impersonation API runtime");
  await context.close();
} finally {
  await browser.close();
}

assert.equal((await controller("impersonation-state")).summary.impersonated, 0, "browser runtime left impersonation active");
const finalAudit = await controller("audit-state");
assert.ok(finalAudit.events.filter((event) => event.action === "IMPERSONATION_STARTED").length >= 2, "browser start audit missing");
assert.ok(finalAudit.events.filter((event) => event.action === "IMPERSONATION_ENDED").length >= 2, "browser stop audit missing");

console.log("IMPERSONATION_API_RUNTIME: PASS", JSON.stringify({
  superAdminStart: "PASS",
  customerStart: "DENIED",
  ownerStart: "DENIED",
  selfAdminTarget: "DENIED",
  bannedTarget: "DENIED",
  nested: "DENIED",
  missingTarget: "DENIED",
  clientTargetOverride: "DENIED",
  foreignOrigin: "DENIED",
  targetConsistency: "PASS",
  tenantA: "PASS",
  tenantBDenied: "PASS",
  adminApisWhileImpersonating: "DENIED",
  stop: "PASS",
  normalCustomerStop: "DENIED",
  adminRestored: "PASS",
  oldContextInvalidated: "PASS",
  startAudit: "PASS",
  stopAudit: "PASS",
  responseAllowlist: "PASS",
  browserCookieRoundTrip: "PASS",
  browserDirectNeonAuth: browserDirectNeon,
  startResponseFields: startFields,
  stopResponseFields: stopFields,
  sensitiveFindings: 0,
}));
