import assert from "node:assert/strict";
import { chromium } from "playwright";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const AUTH_HOST = "ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech";
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
const customerSlug = `qa-impersonation-a-${marker}`;
const customerBSlug = `qa-impersonation-b-${marker}`;
const customerName = `Impersonation Customer A ${marker}`;
const customerBName = `Impersonation Customer B ${marker}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor(values) { this.values = new Map(values || []); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
  clone() { return new CookieJar(this.values); }
  names() { return [...this.values.keys()].sort(); }
  differsFrom(other) {
    const keys = new Set([...this.values.keys(), ...other.values.keys()]);
    return [...keys].some((key) => this.values.get(key) !== other.values.get(key));
  }
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
    console.log(`IMPERSONATION_AUTH_RATE_LIMIT_RETRY: ${attempt + 1}/7 waitMs=${waitMs}`);
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
  assert.ok(response.ok && token.length > 40, `Managed Auth token unavailable (${response.status})`);
  return token;
}

async function signUp(email, name) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  assert.ok(response.ok, `Managed Auth sign-up failed (${response.status})`);
  const token = await tokenFor(jar);
  return { jar, token, id: decodeSub(token) };
}

async function signIn(email) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  assert.ok(response.ok, `Managed Auth sign-in failed (${response.status})`);
  const token = await tokenFor(jar);
  return { jar, token, id: decodeSub(token) };
}

function unwrapSessionBody(body) {
  const root = body?.data && typeof body.data === "object" ? body.data : body;
  return {
    session: root?.session && typeof root.session === "object" ? root.session : null,
    user: root?.user && typeof root.user === "object" ? root.user : null,
  };
}

function sessionInfoFromBody(body) {
  const { session, user } = unwrapSessionBody(body);
  return {
    active: Boolean(session && user?.id),
    userId: typeof user?.id === "string" ? user.id : null,
    role: typeof user?.role === "string" ? user.role.toLowerCase() : null,
    impersonatedBy: typeof session?.impersonatedBy === "string"
      ? session.impersonatedBy
      : typeof session?.impersonated_by === "string"
        ? session.impersonated_by
        : null,
  };
}

async function getSession(jar) {
  const response = await authFetch(jar, "/get-session");
  const body = await readJson(response);
  return { status: response.status, body, ...sessionInfoFromBody(body) };
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function classifyField(path) {
  const lower = path.toLowerCase();
  if (/(token|cookie|secret|authorization|password|credential)/.test(lower)) return "SECRET_DO_NOT_EXPOSE";
  if (/(email|userid|user_id|id$|ipaddress|ip_address|useragent|user_agent|createdat|updatedat|expiresat|impersonatedby|impersonated_by)/.test(lower)) return "SERVER_ONLY";
  return "SAFE_TO_DISPLAY";
}

function responseFieldShape(body) {
  const fields = [];
  const visit = (value, path, depth) => {
    if (depth > 2 || value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      fields.push({ path: nextPath, type: valueType(child), classification: classifyField(nextPath) });
      if (child && typeof child === "object" && !Array.isArray(child)) visit(child, nextPath, depth + 1);
    }
  };
  if (body && typeof body === "object") visit(body, "", 0);
  return fields.slice(0, 80);
}

function logResponseShape(label, status, body) {
  const fields = responseFieldShape(body);
  console.log("IMPERSONATION_PROVIDER_RESPONSE_SHAPE:", JSON.stringify({ label, status, fields }));
  return fields;
}

function assertDeniedStatus(status, label) {
  assert.ok(status === 400 || status === 401 || status === 403 || status === 404, `${label} unexpectedly returned ${status}`);
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
    const value = typeof result.body === "string"
      ? result.body
      : Array.isArray(result.body)
        ? result.body[0]?.current_auth_user_id || result.body[0]?.auth_user_id
        : result.body?.current_auth_user_id || result.body?.auth_user_id;
    if (result.response.ok && value === id) return;
    await sleep(500);
  }
  throw new Error(`${label} Data API identity not ready`);
}

async function insertProfile(token, slug, name) {
  return dataFetch(token, "/profiles?select=id,name,slug", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name, slug, website_url: null, industry: "QA impersonation" }),
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
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${APP_BASE}${path}`, { method, headers, body: payload });
  return { status: response.status, ok: response.ok, body: await readJson(response) };
}

async function nativeAdminCall(jar, path, payload) {
  const response = await authFetch(jar, path, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
  const body = await readJson(response);
  return { response, status: response.status, body };
}

function userByKind(state, kind) {
  const found = state.users?.find((item) => item?.kind === kind);
  assert.ok(found, `missing ${kind} user state`);
  return found;
}

function diagnostics(page) {
  const errors = [];
  const adminResponses = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${String(error.message || "").slice(0, 160)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/403/.test(message.text())) errors.push(`console:${message.text().slice(0, 160)}`);
  });
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin === APP_BASE && url.pathname.startsWith("/api/admin/")) adminResponses.push({ path: url.pathname, status: response.status() });
    } catch { /* ignore */ }
  });
  return { errors, adminResponses };
}

async function browserLogin(page, email) {
  const response = await page.goto(`${APP_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(response?.status(), 200);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20000 });
}

function authRequestHeaders() {
  return { accept: "application/json", origin: APP_BASE, referer: `${APP_BASE}/`, "content-type": "application/json" };
}

async function browserAuthPost(context, path, payload) {
  const response = await context.request.post(`${AUTH_URL}${path}`, { headers: authRequestHeaders(), data: payload ?? {} });
  const body = await readJson(response);
  return { response, status: response.status(), body };
}

async function browserGetSession(context) {
  const response = await context.request.get(`${AUTH_URL}/get-session`, { headers: { accept: "application/json", origin: APP_BASE, referer: `${APP_BASE}/` } });
  const body = await readJson(response);
  return { status: response.status(), body, ...sessionInfoFromBody(body) };
}

const customer = await signUp(emails.customer, customerName);
const customerB = await signUp(emails.customerB, customerBName);
const adminCandidate = await signUp(emails.admin, `Impersonation Admin ${marker}`);
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

const promoted = await controller("promote");
assert.equal(promoted.qaAdmins, 1);
assert.equal(promoted.superAdmins, 2);

const admin = await signIn(emails.admin);
assert.equal(admin.id, adminCandidate.id);
const adminBaselineSession = await getSession(admin.jar);
assert.equal(adminBaselineSession.active, true);
assert.equal(adminBaselineSession.userId, admin.id);
assert.equal(adminBaselineSession.impersonatedBy, null);
assert.equal((await productRequest(admin.token, "/api/admin/me")).status, 200, "SUPER_ADMIN baseline /api/admin/me failed");

const customerNativeStart = await nativeAdminCall(customerB.jar, "/admin/impersonate-user", { userId: customer.id });
logResponseShape("customer-start-denied", customerNativeStart.status, customerNativeStart.body);
assertDeniedStatus(customerNativeStart.status, "CUSTOMER native impersonation start");

const ownerNativeStart = await nativeAdminCall(customer.jar, "/admin/impersonate-user", { userId: customerB.id });
logResponseShape("owner-start-denied", ownerNativeStart.status, ownerNativeStart.body);
assertDeniedStatus(ownerNativeStart.status, "OWNER native impersonation start");

const normalCustomerStop = await nativeAdminCall(customerB.jar, "/admin/stop-impersonating", {});
logResponseShape("normal-customer-stop-denied", normalCustomerStop.status, normalCustomerStop.body);
assertDeniedStatus(normalCustomerStop.status, "normal CUSTOMER stop impersonating");

const customerBInsert = await insertProfile(customerB.token, customerBSlug, customerBName);
assert.ok(customerBInsert.response.ok && firstRow(customerBInsert.body)?.id, `CUSTOMER_B profile insert failed (${customerBInsert.response.status})`);
state = await controller("state");
assert.ok(state.qaProfiles >= 2 && state.qaOwners >= 2, "cross-tenant fixtures missing");

const invalidTargetJar = (await signIn(emails.admin)).jar;
const invalidTarget = await nativeAdminCall(invalidTargetJar, "/admin/impersonate-user", { userId: "00000000-0000-0000-0000-000000000000" });
logResponseShape("invalid-target", invalidTarget.status, invalidTarget.body);
assertDeniedStatus(invalidTarget.status, "invalid impersonation target");

const selfJar = (await signIn(emails.admin)).jar;
const selfStart = await nativeAdminCall(selfJar, "/admin/impersonate-user", { userId: admin.id });
logResponseShape("self-start", selfStart.status, selfStart.body);
let selfBehavior;
if (selfStart.response.ok) {
  const selfSession = await getSession(selfJar);
  assert.equal(selfSession.userId, admin.id, "self impersonation changed identity away from Admin");
  selfBehavior = selfSession.impersonatedBy === admin.id ? "NATIVE_ALLOWED_SAME_ID_APP_BARRIER_REQUIRED" : "NATIVE_NO_OP_APP_BARRIER_REQUIRED";
  const selfStop = await nativeAdminCall(selfJar, "/admin/stop-impersonating", {});
  logResponseShape("self-stop", selfStop.status, selfStop.body);
  if (selfSession.impersonatedBy === admin.id) assert.ok(selfStop.response.ok, "self impersonation could not be stopped");
} else {
  assertDeniedStatus(selfStart.status, "self impersonation");
  selfBehavior = "NATIVE_DENIED";
}

const preAdminJar = admin.jar.clone();
const cookieNamesBefore = admin.jar.names();
const sessionsBefore = await controller("impersonation-state");

const start = await nativeAdminCall(admin.jar, "/admin/impersonate-user", { userId: customer.id });
const startFields = logResponseShape("start", start.status, start.body);
assert.ok(start.response.ok, `native impersonate-user failed (${start.status})`);
const afterStart = await getSession(admin.jar);
assert.equal(afterStart.active, true);
assert.equal(afterStart.userId, customer.id, "current identity did not become CUSTOMER_A");
assert.equal(afterStart.impersonatedBy, admin.id, "session.impersonatedBy does not identify origin Admin");
const impersonatedToken = await tokenFor(admin.jar);
assert.equal(decodeSub(impersonatedToken), customer.id, "impersonated token subject is not CUSTOMER_A");

const sessionsAfterStart = await controller("impersonation-state");
assert.ok(sessionsAfterStart.summary.impersonated >= 1, "no impersonated session persisted in Managed Auth");
assert.ok(sessionsAfterStart.summary.impersonatedByAdmin >= 1, "impersonated session actor is not ADMIN_SMOKE");
const originalAdminAfterStart = await getSession(preAdminJar);
const originalAdminSessionStillValid = originalAdminAfterStart.active && originalAdminAfterStart.userId === admin.id;
const cookieNamesAfter = admin.jar.names();
const cookieNameSetChanged = JSON.stringify(cookieNamesBefore) !== JSON.stringify(cookieNamesAfter);
const cookieValueChanged = admin.jar.differsFrom(preAdminJar);

const ownRead = await selectProfile(impersonatedToken, customerSlug);
assert.ok(ownRead.response.ok && rows(ownRead.body).length === 1, "impersonated CUSTOMER_A cannot read own tenant");
const otherRead = await selectProfile(impersonatedToken, customerBSlug);
assert.ok(!otherRead.response.ok || rows(otherRead.body).length === 0, "impersonated CUSTOMER_A crossed tenant boundary into CUSTOMER_B");
const adminWhileImpersonating = await productRequest(impersonatedToken, "/api/admin/customers");
assert.equal(adminWhileImpersonating.status, 403, "global Admin API remained available while impersonating");

const nested = await nativeAdminCall(admin.jar, "/admin/impersonate-user", { userId: customerB.id });
logResponseShape("nested-start-denied", nested.status, nested.body);
assertDeniedStatus(nested.status, "nested impersonation");

for (let attempt = 0; attempt < 3; attempt += 1) {
  const persisted = await getSession(admin.jar);
  assert.equal(persisted.userId, customer.id, `impersonation lost on persisted session check ${attempt + 1}`);
  assert.equal(persisted.impersonatedBy, admin.id, `impersonatedBy lost on persisted session check ${attempt + 1}`);
}

const oldImpersonatedJar = admin.jar.clone();
const stop = await nativeAdminCall(admin.jar, "/admin/stop-impersonating", {});
const stopFields = logResponseShape("stop", stop.status, stop.body);
assert.ok(stop.response.ok, `native stop-impersonating failed (${stop.status})`);
const afterStop = await getSession(admin.jar);
assert.equal(afterStop.active, true);
assert.equal(afterStop.userId, admin.id, "Admin identity was not restored after stop");
assert.equal(afterStop.impersonatedBy, null, "impersonatedBy remained after stop");
const restoredToken = await tokenFor(admin.jar);
assert.equal(decodeSub(restoredToken), admin.id, "restored token subject is not Admin");
assert.equal((await productRequest(restoredToken, "/api/admin/me")).status, 200, "Admin /api/admin/me not restored after stop");

const oldAfterStop = await getSession(oldImpersonatedJar);
assert.ok(!(oldAfterStop.active && oldAfterStop.userId === customer.id), "old impersonated cookie context remained usable after stop");
const sessionsAfterStop = await controller("impersonation-state");
assert.equal(sessionsAfterStop.summary.impersonated, 0, "Managed Auth retained impersonated session after stop");

const policyAdmin = await signIn(emails.admin);
const nativeBan = await nativeAdminCall(policyAdmin.jar, "/admin/ban-user", { userId: customerB.id, banReason: `qa-impersonation-policy-${marker}` });
logResponseShape("native-ban-policy-probe", nativeBan.status, nativeBan.body);
assert.ok(nativeBan.response.ok, `native ban-user failed during banned-target probe (${nativeBan.status})`);
const bannedState = await controller("user-state");
assert.equal(userByKind(bannedState, "customer-b").banned, true, "native ban did not persist CUSTOMER_B banned state");
const bannedStart = await nativeAdminCall(policyAdmin.jar, "/admin/impersonate-user", { userId: customerB.id });
logResponseShape("banned-target-start", bannedStart.status, bannedStart.body);
const bannedTargetBehavior = bannedStart.response.ok ? "NATIVE_ALLOWED_PRODUCT_MUST_DENY" : "NATIVE_DENIED";
if (bannedStart.response.ok) {
  const bannedSession = await getSession(policyAdmin.jar);
  assert.equal(bannedSession.userId, customerB.id, "native banned-target response succeeded without target identity");
  const bannedStop = await nativeAdminCall(policyAdmin.jar, "/admin/stop-impersonating", {});
  logResponseShape("banned-target-stop", bannedStop.status, bannedStop.body);
  assert.ok(bannedStop.response.ok, "native banned-target impersonation could not be stopped");
}
const policyAdminFresh = await signIn(emails.admin);
const nativeUnban = await nativeAdminCall(policyAdminFresh.jar, "/admin/unban-user", { userId: customerB.id });
logResponseShape("native-unban-policy-probe", nativeUnban.status, nativeUnban.body);
assert.ok(nativeUnban.response.ok, `native unban-user failed after banned-target probe (${nativeUnban.status})`);
const unbannedState = await controller("user-state");
assert.equal(userByKind(unbannedState, "customer-b").banned, false, "CUSTOMER_B remained banned after policy probe cleanup");

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const diag = diagnostics(page);
  await browserLogin(page, emails.admin);
  await page.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Clienti", exact: true }).waitFor({ timeout: 20000 });
  assert.ok(diag.adminResponses.some((item) => item.path === "/api/admin/me" && item.status === 200), "browser Admin baseline /api/admin/me missing");

  const browserBaseline = await browserGetSession(context);
  assert.equal(browserBaseline.userId, admin.id);
  assert.equal(browserBaseline.impersonatedBy, null);

  const browserStart = await browserAuthPost(context, "/admin/impersonate-user", { userId: customer.id });
  logResponseShape("browser-start", browserStart.status, browserStart.body);
  assert.ok(browserStart.response.ok(), `browser native impersonation start failed (${browserStart.status})`);
  const browserImpersonated = await browserGetSession(context);
  assert.equal(browserImpersonated.userId, customer.id);
  assert.equal(browserImpersonated.impersonatedBy, admin.id);

  await page.goto(`${APP_BASE}/app/dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: customerName, exact: true }).waitFor({ timeout: 20000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: customerName, exact: true }).waitFor({ timeout: 20000 });
  const afterRefreshSession = await browserGetSession(context);
  assert.equal(afterRefreshSession.userId, customer.id);
  assert.equal(afterRefreshSession.impersonatedBy, admin.id);

  await page.goto(`${APP_BASE}/app/profili`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Le tue attività", exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole("heading", { name: customerName, exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await page.getByRole("heading", { name: customerBName, exact: true }).count(), 0, "browser impersonated tenant exposed CUSTOMER_B profile");

  await page.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
  assert.ok(diag.adminResponses.some((item) => item.path === "/api/admin/me" && item.status === 403), "browser Admin API denial while impersonating missing");

  const oldStorageState = await context.storageState();
  const browserStop = await browserAuthPost(context, "/admin/stop-impersonating", {});
  logResponseShape("browser-stop", browserStop.status, browserStop.body);
  assert.ok(browserStop.response.ok(), `browser native stop failed (${browserStop.status})`);
  const browserRestored = await browserGetSession(context);
  assert.equal(browserRestored.userId, admin.id);
  assert.equal(browserRestored.impersonatedBy, null);
  await page.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Clienti", exact: true }).waitFor({ timeout: 20000 });

  const oldContext = await browser.newContext({ storageState: oldStorageState, viewport: { width: 390, height: 844 } });
  const stale = await browserGetSession(oldContext);
  assert.ok(!(stale.active && stale.userId === customer.id), "browser old impersonated storage state remained active after stop");
  await oldContext.close();
  assert.deepEqual(diag.errors, [], `browser errors ${JSON.stringify(diag.errors)}`);
  await context.close();
} finally {
  await browser.close();
}

state = await controller("state");
assert.equal(state.qaAdmins, 1);
assert.equal(state.superAdmins, 2);
assert.equal(state.profilesWithoutOwner, 0);
const finalImpersonationState = await controller("impersonation-state");
assert.equal(finalImpersonationState.summary.impersonated, 0, "impersonated session residue before cleanup");

const secretClassifications = [...startFields, ...stopFields].filter((item) => item.classification === "SECRET_DO_NOT_EXPOSE").map((item) => item.path);
console.log("IMPERSONATION_PROVIDER_CONTRACT_RUNTIME: PASS", JSON.stringify({
  start: "PASS",
  currentIdentityBecomesCustomer: "PASS",
  impersonatedBy: "PASS",
  customerTenantAccess: "PASS",
  otherTenantDenied: "PASS",
  refreshPersistence: "PASS",
  adminApisWhileImpersonating: "DENIED",
  nestedImpersonation: "DENIED",
  stop: "PASS",
  adminRestored: "PASS",
  oldImpersonatedContextInvalidated: "PASS",
  customerStart: "DENIED",
  ownerStart: "DENIED",
  normalCustomerStop: "DENIED",
  invalidTarget: "DENIED",
  selfBehavior,
  bannedTargetBehavior,
  originalAdminSessionStillValid,
  cookieNameSetChanged,
  cookieValueChanged,
  sessionCounts: {
    before: sessionsBefore.summary,
    afterStart: sessionsAfterStart.summary,
    afterStop: sessionsAfterStop.summary,
  },
  nativeResponseSecretFieldsClassifiedOnly: secretClassifications,
  sensitiveLogFindings: 0,
  providerAuthHost: AUTH_HOST,
}));
