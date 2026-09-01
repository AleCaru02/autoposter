import assert from "node:assert/strict";
import { chromium } from "playwright";

const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const AUTH_URL = `${APP_BASE}/api/auth`;
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const nextPassword = process.env.AUDIT_SMOKE_NEXT_PASSWORD || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";
const controllerUrl = process.env.AUDIT_SMOKE_CONTROLLER_URL || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);
assert.ok(nextPassword.length >= 24 && nextPassword !== password);
assert.ok(controllerToken.length >= 32);
assert.ok(controllerUrl.startsWith("https://"));
assert.equal(AUTH_URL.includes("neonauth"), false);

const emails = {
  customer: `audit-smoke-${marker}-customer@example.invalid`,
  customerB: `audit-smoke-${marker}-customer-b@example.invalid`,
  admin: `audit-smoke-${marker}-admin@example.invalid`,
};
const customerSlug = `qa-auth-boundary-a-${marker}`;
const customerBSlug = `qa-auth-boundary-b-${marker}`;
const customerName = `Auth Boundary Customer A ${marker}`;
const customerBName = `Auth Boundary Customer B ${marker}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor(values) { this.values = new Map(values || []); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
      const parts = String(raw).split(";").map((part) => part.trim());
      const pair = parts[0] || "";
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = parts.some((part) => /^max-age=0$/i.test(part)) || parts.some((part) => /^expires=/i.test(part) && Date.parse(part.slice(8)) <= Date.now());
      if (expired || value === "") this.values.delete(key); else this.values.set(key, value);
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

function cookieSummaries(headers) {
  const summaries = [];
  for (const raw of headers.getSetCookie?.() || []) {
    const parts = String(raw).split(";").map((part) => part.trim()).filter(Boolean);
    const first = parts.shift() || "";
    const eq = first.indexOf("=");
    const name = eq > 0 ? first.slice(0, eq) : "";
    const attrs = new Map();
    for (const part of parts) {
      const index = part.indexOf("=");
      attrs.set((index >= 0 ? part.slice(0, index) : part).toLowerCase(), index >= 0 ? part.slice(index + 1) : true);
    }
    summaries.push({
      name,
      httpOnly: attrs.has("httponly"),
      secure: attrs.has("secure"),
      sameSite: typeof attrs.get("samesite") === "string" ? String(attrs.get("samesite")) : null,
      path: typeof attrs.get("path") === "string" ? String(attrs.get("path")) : null,
      domainPresent: attrs.has("domain"),
      neonDomain: typeof attrs.get("domain") === "string" && String(attrs.get("domain")).includes("neonauth"),
    });
  }
  return summaries;
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
  assert.ok(path.startsWith("/"));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.method === "POST") {
      headers.set("origin", APP_BASE);
      headers.set("referer", `${APP_BASE}/`);
    }
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const cookie = jar?.header?.() || "";
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" });
    jar?.absorb?.(response.headers);
    if (response.status !== 429 || attempt === 7) return response;
    const waitMs = retryAfterMs(response, attempt);
    try { await response.body?.cancel(); } catch { /* ignore */ }
    console.log(`SAME_ORIGIN_AUTH_RATE_LIMIT_RETRY: ${attempt + 1}/7 waitMs=${waitMs}`);
    await sleep(waitMs);
  }
  throw new Error("unreachable Auth retry state");
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
  assert.ok(response.ok && typeof token === "string" && token.length > 40, `native token unavailable (${response.status})`);
  return token;
}

async function signUp(email, name) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  const cookies = cookieSummaries(response.headers);
  assert.ok(response.ok, `same-origin sign-up failed (${response.status})`);
  assert.ok(cookies.length >= 1, "same-origin sign-up returned no Set-Cookie");
  const token = await tokenFor(jar);
  return { jar, token, id: decodeSub(token), cookies };
}

async function signIn(email, credential = password) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", { method: "POST", body: JSON.stringify({ email, password: credential }) });
  if (!response.ok) return { ok: false, status: response.status, jar, cookies: cookieSummaries(response.headers) };
  const cookies = cookieSummaries(response.headers);
  const token = await tokenFor(jar);
  return { ok: true, status: response.status, jar, token, id: decodeSub(token), cookies };
}

async function signOut(jar) {
  const response = await authFetch(jar, "/sign-out", { method: "POST", body: "{}" });
  try { await response.body?.cancel(); } catch { /* ignore */ }
  return response.status;
}

function unwrapSessionBody(body) {
  const root = body?.data && typeof body.data === "object" ? body.data : body;
  return { session: root?.session && typeof root.session === "object" ? root.session : null, user: root?.user && typeof root.user === "object" ? root.user : null };
}

function sessionInfoFromBody(body) {
  const { session, user } = unwrapSessionBody(body);
  return {
    active: Boolean(session && user?.id),
    userId: typeof user?.id === "string" ? user.id : null,
    role: typeof user?.role === "string" ? user.role.toLowerCase() : null,
    sessionId: typeof session?.id === "string" ? session.id : null,
    impersonatedBy: typeof session?.impersonatedBy === "string" ? session.impersonatedBy : typeof session?.impersonated_by === "string" ? session.impersonated_by : null,
  };
}

async function getSession(jar) {
  const response = await authFetch(jar, "/get-session");
  const body = await readJson(response);
  return { status: response.status, body, ...sessionInfoFromBody(body) };
}

async function controller(action, extra = {}) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-audit-smoke-token": controllerToken },
    body: JSON.stringify({ action, marker, ...extra }),
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
  return dataFetch(token, "/profiles?select=id,name,slug", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ name, slug, website_url: null, industry: "QA Auth boundary" }) });
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

async function nativeAdminCall(jar, path, payload) {
  const response = await authFetch(jar, path, { method: "POST", body: JSON.stringify(payload ?? {}) });
  const body = await readJson(response);
  return { response, status: response.status, body };
}

function assertDeniedStatus(status, label) {
  assert.ok([400, 401, 403, 404].includes(status), `${label} unexpectedly returned ${status}`);
}

function safeResponseShape(body) {
  if (!body || typeof body !== "object") return [];
  return Object.entries(body).slice(0, 20).map(([key, value]) => ({ key, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value }));
}

function logSafeShape(label, status, body) {
  console.log("SAME_ORIGIN_AUTH_SAFE_RESPONSE_SHAPE:", JSON.stringify({ label, status, fields: safeResponseShape(body) }));
}

function userByKind(state, kind) {
  const found = state.users?.find((item) => item?.kind === kind);
  assert.ok(found, `missing ${kind} user state`);
  return found;
}

async function browserPageJson(page, path, init = {}) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, { ...init, credentials: "include" });
    let body = null;
    try { body = await response.json(); } catch { /* ignore */ }
    return { status: response.status, ok: response.ok, body };
  }, { path, init });
}

async function browserGetSession(page) {
  const result = await browserPageJson(page, "/api/auth/get-session", { headers: { accept: "application/json" } });
  return { status: result.status, body: result.body, ...sessionInfoFromBody(result.body) };
}

async function browserLogin(page, email, credential) {
  const response = await page.goto(`${APP_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(response?.status(), 200);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(credential);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
}

function attachNetworkDiagnostics(page, sink) {
  page.on("request", async (request) => {
    try {
      const url = new URL(request.url());
      if (url.hostname.includes("neonauth")) sink.directNeon += 1;
      if (url.origin === APP_BASE && url.pathname.startsWith("/api/auth/")) {
        sink.sameOriginAuth += 1;
        if (url.pathname === "/api/auth/get-session") {
          const headers = await request.allHeaders();
          if (typeof headers.cookie === "string" && headers.cookie.length > 0) sink.cookieReturned = true;
        }
      }
    } catch { /* ignore */ }
  });
  page.on("pageerror", (error) => sink.errors.push(`pageerror:${String(error.message || "").slice(0, 120)}`));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !/403/.test(text)) sink.errors.push(`console:${text.slice(0, 120)}`);
  });
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin === APP_BASE && url.pathname.startsWith("/api/admin/")) sink.adminResponses.push({ path: url.pathname, status: response.status() });
    } catch { /* ignore */ }
  });
}

async function oauthProtocolProbe() {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/social", {
    method: "POST",
    body: JSON.stringify({ provider: "google", callbackURL: `${APP_BASE}/app/dashboard`, disableRedirect: true }),
  });
  const body = await readJson(response);
  const candidate = typeof body?.url === "string" ? body.url : typeof body?.data?.url === "string" ? body.data.url : response.headers.get("location");
  assert.ok(response.ok || (response.status >= 300 && response.status < 400), `Google OAuth start failed (${response.status})`);
  assert.ok(candidate, "Google OAuth start returned no provider URL");
  const target = new URL(candidate);
  assert.ok(target.hostname === "accounts.google.com" || target.hostname.endsWith(".google.com"), `unexpected OAuth provider host ${target.hostname}`);
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
}

const cookieRuntime = { setCookie: false, httpOnly: false, secure: false, sameSite: null, noNeonDomain: false, browserStores: false, browserResends: false, refreshPersistence: false };
const authRuntime = { customerLogin: false, failedLogin: false, session: false, refresh: false, logout: false, signup: false, passwordFlow: false, oauthProtocol: false, nativeToken: false, dataApi: false };
const regressions = { tenantRls: false, crossTenant: false, owner: false, superAdmin: false, auditViewer: false, sessionManagement: false, bannedUserRls: false, banUnban: false };
const impersonation = { adminSameOriginLogin: false, start: false, currentCustomer: false, impersonatedBy: false, ownTenant: false, otherTenantDenied: false, adminApisDenied: false, refresh: false, nestedDenied: false, selfDenied: false, bannedTargetDenied: false, stop: false, adminRestored: false, oldContextInvalidated: false, privilegeBleed: false, sensitiveFindings: 0 };

const customer = await signUp(emails.customer, customerName);
authRuntime.signup = true;
const credentialCookies = customer.cookies.filter((cookie) => cookie.name.includes("session"));
assert.ok(credentialCookies.length >= 1, "session credential cookie missing");
assert.ok(credentialCookies.every((cookie) => cookie.httpOnly && cookie.secure && !cookie.neonDomain));
cookieRuntime.setCookie = true;
cookieRuntime.httpOnly = true;
cookieRuntime.secure = true;
cookieRuntime.sameSite = credentialCookies[0]?.sameSite || null;
cookieRuntime.noNeonDomain = true;

const customerB = await signUp(emails.customerB, customerBName);
const adminCandidate = await signUp(emails.admin, `Auth Boundary Admin ${marker}`);
await waitIdentity(customer.token, customer.id, "CUSTOMER_A");
await waitIdentity(customerB.token, customerB.id, "CUSTOMER_B");
await waitIdentity(adminCandidate.token, adminCandidate.id, "ADMIN candidate");
authRuntime.nativeToken = true;

let state = await controller("state");
assert.equal(state.qaUsers, 3);
assert.equal(state.qaAdmins, 0);
assert.equal(state.qaProfiles, 0);

const failed = await signIn(emails.customer, `${password}-wrong`);
assert.equal(failed.ok, false, "wrong password unexpectedly authenticated");
const failedSession = await getSession(failed.jar);
assert.equal(failedSession.active, false, "failed login produced authenticated session");
authRuntime.failedLogin = true;

const customerSession = await getSession(customer.jar);
assert.equal(customerSession.active, true);
assert.equal(customerSession.userId, customer.id);
authRuntime.session = true;
for (let attempt = 0; attempt < 2; attempt += 1) {
  const persisted = await getSession(customer.jar);
  assert.equal(persisted.userId, customer.id);
}
authRuntime.refresh = true;

const customerInsert = await insertProfile(customer.token, customerSlug, customerName);
assert.ok(customerInsert.response.ok && firstRow(customerInsert.body)?.id, `CUSTOMER_A profile insert failed (${customerInsert.response.status})`);
const ownInitial = await selectProfile(customer.token, customerSlug);
assert.ok(ownInitial.response.ok && rows(ownInitial.body).length === 1, "CUSTOMER_A own data read failed");
authRuntime.dataApi = true;
regressions.tenantRls = true;

const customerStartDenied = await nativeAdminCall(customerB.jar, "/admin/impersonate-user", { userId: customer.id });
logSafeShape("customer-start-denied", customerStartDenied.status, customerStartDenied.body);
assertDeniedStatus(customerStartDenied.status, "CUSTOMER impersonation start");
const customerStopDenied = await nativeAdminCall(customerB.jar, "/admin/stop-impersonating", {});
assertDeniedStatus(customerStopDenied.status, "normal CUSTOMER impersonation stop");

const customerBInsert = await insertProfile(customerB.token, customerBSlug, customerBName);
assert.ok(customerBInsert.response.ok && firstRow(customerBInsert.body)?.id, `CUSTOMER_B profile insert failed (${customerBInsert.response.status})`);
const cross = await selectProfile(customer.token, customerBSlug);
assert.ok(!cross.response.ok || rows(cross.body).length === 0, "CUSTOMER_A crossed tenant boundary");
regressions.crossTenant = true;
state = await controller("state");
assert.ok(state.qaProfiles >= 2 && state.qaOwners >= 2, "OWNER fixtures missing");

const ownerAdminDenied = await productRequest(customer.token, "/api/admin/me");
assert.equal(ownerAdminDenied.status, 403);
regressions.owner = true;

const promoted = await controller("promote");
assert.equal(promoted.qaAdmins, 1);
assert.equal(promoted.superAdmins, 2);
const admin = await signIn(emails.admin);
assert.equal(admin.ok, true);
assert.equal(admin.id, adminCandidate.id);
const adminSession = await getSession(admin.jar);
assert.equal(adminSession.active, true);
assert.equal(adminSession.userId, admin.id);
const adminMe = await productRequest(admin.token, "/api/admin/me");
const adminCustomers = await productRequest(admin.token, "/api/admin/customers");
const adminDetail = await productRequest(admin.token, `/api/admin/customers/${encodeURIComponent(customer.id)}`);
const adminAudit = await productRequest(admin.token, "/api/admin/audit?limit=5");
assert.equal(adminMe.status, 200);
assert.equal(adminCustomers.status, 200);
assert.equal(adminDetail.status, 200);
assert.equal(adminAudit.status, 200);
regressions.superAdmin = true;
regressions.auditViewer = true;

const resetRequest = await authFetch(null, "/request-password-reset", { method: "POST", body: JSON.stringify({ email: emails.customer, redirectTo: `${APP_BASE}/reimposta-password` }) });
assert.ok(resetRequest.ok, `request-password-reset failed (${resetRequest.status})`);
try { await resetRequest.body?.cancel(); } catch { /* ignore */ }
let resetState = await controller("password-reset-state");
for (let attempt = 0; attempt < 10 && !resetState.present; attempt += 1) { await sleep(300); resetState = await controller("password-reset-state"); }
assert.equal(resetState.present, true, "password reset challenge was not persisted");
const completedReset = await controller("complete-password-reset");
assert.equal(completedReset.completed, true, `password reset completion failed (${completedReset.providerStatus})`);
const oldPasswordLogin = await signIn(emails.customer, password);
assert.equal(oldPasswordLogin.ok, false, "old password remained valid after reset");
const newPasswordLogin = await signIn(emails.customer, nextPassword);
assert.equal(newPasswordLogin.ok, true, "new password cannot sign in after reset");
authRuntime.passwordFlow = true;

const oauthObservation = await oauthProtocolProbe();
authRuntime.oauthProtocol = true;

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const diag = { directNeon: 0, sameOriginAuth: 0, cookieReturned: false, errors: [], adminResponses: [] };
  attachNetworkDiagnostics(page, diag);
  await browserLogin(page, emails.customer, nextPassword);
  authRuntime.customerLogin = true;
  const browserSession = await browserGetSession(page);
  assert.equal(browserSession.userId, customer.id);
  const stored = await context.cookies(APP_BASE);
  const relevantStored = stored.filter((cookie) => cookie.name.includes("session"));
  assert.ok(relevantStored.length >= 1 && relevantStored.every((cookie) => cookie.httpOnly && cookie.secure && !cookie.domain.includes("neonauth")), "browser did not safely store same-origin session cookie");
  cookieRuntime.browserStores = true;
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  const refreshed = await browserGetSession(page);
  assert.equal(refreshed.userId, customer.id);
  cookieRuntime.refreshPersistence = true;
  authRuntime.refresh = true;
  await sleep(100);
  assert.equal(diag.cookieReturned, true, "browser did not resend cookie to same-origin Auth boundary");
  cookieRuntime.browserResends = true;
  assert.equal(diag.directNeon, 0, "browser made a direct Neon Auth request");
  assert.ok(diag.sameOriginAuth >= 2, "browser did not use same-origin Auth requests");
  const oldCustomerStorage = await context.storageState();
  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 20000 });
  const loggedOut = await browserGetSession(page);
  assert.equal(loggedOut.active, false, "browser session remained active after logout");
  const staleContext = await browser.newContext({ storageState: oldCustomerStorage });
  const stalePage = await staleContext.newPage();
  const staleSession = await browserGetSession(stalePage);
  assert.equal(staleSession.active, false, "old browser storage remained authenticated after logout");
  await staleContext.close();
  authRuntime.logout = true;
  assert.deepEqual(diag.errors, [], `customer browser errors ${JSON.stringify(diag.errors)}`);
  await context.close();

  const s1 = await signIn(emails.customer, nextPassword);
  const s2 = await signIn(emails.customer, nextPassword);
  assert.equal(s1.ok, true); assert.equal(s2.ok, true);
  const s1Info = await getSession(s1.jar);
  const s2Info = await getSession(s2.jar);
  assert.ok(s1Info.sessionId && s2Info.sessionId && s1Info.sessionId !== s2Info.sessionId);
  const adminFresh = await signIn(emails.admin);
  assert.equal(adminFresh.ok, true);
  const listed = await productRequest(adminFresh.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/sessions`);
  assert.equal(listed.status, 200);
  assert.ok(Array.isArray(listed.body?.sessions) && listed.body.sessions.some((session) => session.id === s2Info.sessionId));
  const revokeOne = await productRequest(adminFresh.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/sessions/${encodeURIComponent(s2Info.sessionId)}`, "DELETE");
  assert.equal(revokeOne.status, 200);
  assert.equal((await getSession(s2.jar)).active, false, "single revoked session remained active");
  assert.equal((await getSession(s1.jar)).active, true, "non-target customer session was revoked");
  const revokeAll = await productRequest(adminFresh.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/sessions`, "DELETE");
  assert.equal(revokeAll.status, 200);
  assert.equal((await getSession(s1.jar)).active, false, "revoke-all did not invalidate remaining customer session");
  assert.equal((await getSession(adminFresh.jar)).active, true, "Admin session was revoked by customer revoke-all");
  let auditState = await controller("audit-state");
  assert.ok(Number(auditState.actions?.USER_SESSION_REVOKED || 0) >= 1);
  assert.ok(Number(auditState.actions?.USER_SESSIONS_REVOKED || 0) >= 1);
  regressions.sessionManagement = true;

  const banVictim = await signIn(emails.customer, nextPassword);
  assert.equal(banVictim.ok, true);
  const preBanToken = banVictim.token;
  const ban = await productRequest(adminFresh.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/ban`, "POST", { reason: `qa-auth-boundary-${marker}` });
  assert.ok(ban.status === 200 || ban.status === 207);
  assert.equal(ban.body?.customer?.banned, true);
  assert.equal((await getSession(banVictim.jar)).active, false, "ban did not revoke active session");
  const preBanOwn = await selectProfile(preBanToken, customerSlug);
  assert.ok(!preBanOwn.response.ok || rows(preBanOwn.body).length === 0, "pre-ban JWT retained tenant access after ban");
  regressions.bannedUserRls = true;
  const bannedLogin = await signIn(emails.customer, nextPassword);
  assert.equal(bannedLogin.ok, false, "banned user could sign in");
  const unban = await productRequest(adminFresh.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/unban`, "POST", {});
  assert.ok(unban.status === 200 || unban.status === 207);
  assert.equal((await signIn(emails.customer, nextPassword)).ok, true, "login not restored after unban");

  const temporaryExpiry = new Date(Date.now() + 4500).toISOString();
  const tempSession = await signIn(emails.customer, nextPassword);
  assert.equal(tempSession.ok, true);
  const tempBan = await productRequest(adminFresh.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/ban`, "POST", { reason: `qa-temp-${marker}`, expiresAt: temporaryExpiry });
  assert.ok(tempBan.status === 200 || tempBan.status === 207);
  assert.equal((await signIn(emails.customer, nextPassword)).ok, false, "temporary ban did not block login");
  await sleep(5500);
  assert.equal((await signIn(emails.customer, nextPassword)).ok, true, "temporary ban expiry did not restore login");
  const tempUnban = await productRequest(adminFresh.token, `/api/admin/customers/${encodeURIComponent(customer.id)}/unban`, "POST", {});
  assert.ok(tempUnban.status === 200 || tempUnban.status === 207);
  auditState = await controller("audit-state");
  assert.ok(Number(auditState.actions?.USER_BANNED || 0) >= 2);
  assert.ok(Number(auditState.actions?.USER_UNBANNED || 0) >= 2);
  regressions.banUnban = true;

  const owner = await signIn(emails.customer, nextPassword);
  const ownerStart = await nativeAdminCall(owner.jar, "/admin/impersonate-user", { userId: customerB.id });
  assertDeniedStatus(ownerStart.status, "OWNER impersonation start");
  const invalidAdmin = await signIn(emails.admin);
  const invalidTarget = await nativeAdminCall(invalidAdmin.jar, "/admin/impersonate-user", { userId: "00000000-0000-0000-0000-000000000000" });
  assertDeniedStatus(invalidTarget.status, "invalid impersonation target");
  const selfAdmin = await signIn(emails.admin);
  const selfStart = await nativeAdminCall(selfAdmin.jar, "/admin/impersonate-user", { userId: admin.id });
  assertDeniedStatus(selfStart.status, "self impersonation");
  impersonation.selfDenied = true;

  const policyAdmin = await signIn(emails.admin);
  const banB = await productRequest(policyAdmin.token, `/api/admin/customers/${encodeURIComponent(customerB.id)}/ban`, "POST", { reason: `qa-impersonation-policy-${marker}` });
  assert.ok(banB.status === 200 || banB.status === 207);
  const bannedTarget = await nativeAdminCall(policyAdmin.jar, "/admin/impersonate-user", { userId: customerB.id });
  assertDeniedStatus(bannedTarget.status, "banned impersonation target");
  impersonation.bannedTargetDenied = true;
  const unbanB = await productRequest(policyAdmin.token, `/api/admin/customers/${encodeURIComponent(customerB.id)}/unban`, "POST", {});
  assert.ok(unbanB.status === 200 || unbanB.status === 207);

  const mainAdmin = await signIn(emails.admin);
  const originalAdminJar = mainAdmin.jar.clone();
  const start = await nativeAdminCall(mainAdmin.jar, "/admin/impersonate-user", { userId: customer.id });
  logSafeShape("impersonation-start", start.status, start.body);
  assert.ok(start.response.ok, `same-origin impersonation start failed (${start.status})`);
  impersonation.start = true;
  const afterStart = await getSession(mainAdmin.jar);
  assert.equal(afterStart.userId, customer.id);
  assert.equal(afterStart.impersonatedBy, mainAdmin.id);
  impersonation.currentCustomer = true;
  impersonation.impersonatedBy = true;
  const impToken = await tokenFor(mainAdmin.jar);
  assert.equal(decodeSub(impToken), customer.id);
  const impOwn = await selectProfile(impToken, customerSlug);
  assert.ok(impOwn.response.ok && rows(impOwn.body).length === 1);
  impersonation.ownTenant = true;
  const impOther = await selectProfile(impToken, customerBSlug);
  assert.ok(!impOther.response.ok || rows(impOther.body).length === 0);
  impersonation.otherTenantDenied = true;
  assert.equal((await productRequest(impToken, "/api/admin/me")).status, 403);
  impersonation.adminApisDenied = true;
  const nested = await nativeAdminCall(mainAdmin.jar, "/admin/impersonate-user", { userId: customerB.id });
  assertDeniedStatus(nested.status, "nested impersonation");
  impersonation.nestedDenied = true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const persisted = await getSession(mainAdmin.jar);
    assert.equal(persisted.userId, customer.id);
    assert.equal(persisted.impersonatedBy, mainAdmin.id);
  }
  impersonation.refresh = true;
  const originalStillValid = await getSession(originalAdminJar);
  assert.equal(originalStillValid.userId, mainAdmin.id, "original Admin session did not remain independently valid");
  impersonation.privilegeBleed = true;
  const oldImpersonated = mainAdmin.jar.clone();
  const stop = await nativeAdminCall(mainAdmin.jar, "/admin/stop-impersonating", {});
  logSafeShape("impersonation-stop", stop.status, stop.body);
  assert.ok(stop.response.ok, `same-origin impersonation stop failed (${stop.status})`);
  impersonation.stop = true;
  const restored = await getSession(mainAdmin.jar);
  assert.equal(restored.userId, mainAdmin.id);
  assert.equal(restored.impersonatedBy, null);
  impersonation.adminRestored = true;
  const restoredToken = await tokenFor(mainAdmin.jar);
  assert.equal((await productRequest(restoredToken, "/api/admin/me")).status, 200);
  const staleImp = await getSession(oldImpersonated);
  assert.ok(!(staleImp.active && staleImp.userId === customer.id), "old impersonated context remained active");
  impersonation.oldContextInvalidated = true;
  const impState = await controller("impersonation-state");
  assert.equal(impState.summary.impersonated, 0);

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const adminPage = await adminContext.newPage();
  const adminDiag = { directNeon: 0, sameOriginAuth: 0, cookieReturned: false, errors: [], adminResponses: [] };
  attachNetworkDiagnostics(adminPage, adminDiag);
  await browserLogin(adminPage, emails.admin, password);
  impersonation.adminSameOriginLogin = true;
  await adminPage.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await adminPage.getByRole("heading", { name: "Clienti", exact: true }).waitFor({ timeout: 20000 });
  assert.ok(adminDiag.adminResponses.some((item) => item.path === "/api/admin/me" && item.status === 200));
  const browserBaseline = await browserGetSession(adminPage);
  const browserStart = await browserPageJson(adminPage, "/api/auth/admin/impersonate-user", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: customer.id }) });
  assert.equal(browserStart.ok, true, `browser same-origin impersonation start failed (${browserStart.status})`);
  const browserImp = await browserGetSession(adminPage);
  assert.equal(browserImp.userId, customer.id);
  assert.equal(browserImp.impersonatedBy, browserBaseline.userId);
  await adminPage.goto(`${APP_BASE}/app/dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await adminPage.getByRole("heading", { name: customerName, exact: true }).waitFor({ timeout: 20000 });
  await adminPage.reload({ waitUntil: "domcontentloaded" });
  await adminPage.getByRole("heading", { name: customerName, exact: true }).waitFor({ timeout: 20000 });
  await adminPage.goto(`${APP_BASE}/app/profili`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await adminPage.getByRole("heading", { name: "Le tue attività", exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await adminPage.getByRole("heading", { name: customerBName, exact: true }).count(), 0);
  await adminPage.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await adminPage.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
  assert.ok(adminDiag.adminResponses.some((item) => item.path === "/api/admin/me" && item.status === 403));
  const oldStorage = await adminContext.storageState();
  const browserStop = await browserPageJson(adminPage, "/api/auth/admin/stop-impersonating", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(browserStop.ok, true, `browser same-origin impersonation stop failed (${browserStop.status})`);
  const browserRestored = await browserGetSession(adminPage);
  assert.equal(browserRestored.userId, browserBaseline.userId);
  await adminPage.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await adminPage.getByRole("heading", { name: "Clienti", exact: true }).waitFor({ timeout: 20000 });
  const oldContext = await browser.newContext({ storageState: oldStorage });
  const oldPage = await oldContext.newPage();
  const oldBrowserSession = await browserGetSession(oldPage);
  assert.ok(!(oldBrowserSession.active && oldBrowserSession.userId === customer.id));
  await oldContext.close();
  assert.equal(adminDiag.directNeon, 0, "Admin browser bypassed same-origin Auth boundary");
  assert.ok(adminDiag.sameOriginAuth >= 4, "Admin browser did not exercise same-origin Auth boundary");
  assert.deepEqual(adminDiag.errors, [], `Admin browser errors ${JSON.stringify(adminDiag.errors)}`);
  await adminContext.close();
} finally {
  await browser.close();
}

const finalState = await controller("state");
assert.equal(finalState.qaBanned, 0, "temporary banned QA user remained banned");
const finalAudit = await controller("audit-state");
assert.ok(finalAudit.total >= 4, "expected Admin audit evidence missing");

const oauthEndToEnd = "EXTERNAL_GOOGLE_IDENTITY_NOT_EXECUTED";
const boundaryReady = false;
const summary = {
  cookieRuntime,
  authRuntime: { ...authRuntime, oauthObservation, oauthEndToEnd },
  regressions,
  impersonation,
  originalAdminSessionStillValid: true,
  directBrowserNeonAuth: 0,
  sensitiveFindings: 0,
  boundaryReady,
  blocker: "OAUTH_FINAL_EXTERNAL_IDP_SESSION_NOT_CERTIFIED",
};
console.log("SAME_ORIGIN_MANAGED_AUTH_BOUNDARY_RUNTIME: REWORK", JSON.stringify(summary));
process.exitCode = 2;
