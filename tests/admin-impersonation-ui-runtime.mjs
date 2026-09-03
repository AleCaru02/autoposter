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
const customerSlug = `qa-impersonation-ui-a-${marker}`;
const customerBSlug = `qa-impersonation-ui-b-${marker}`;
const customerName = `Impersonation UI Customer A ${marker}`;
const customerBName = `Impersonation UI Customer B ${marker}`;
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
    console.log("IMPERSONATION_UI_AUTH_RATE_LIMIT_RETRY:", JSON.stringify({ attempt: attempt + 1, waitMs }));
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
    body: JSON.stringify({ name, slug, website_url: null, industry: "QA impersonation UI" }),
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
    headers.set("origin", APP_BASE);
    headers.set("referer", `${APP_BASE}/`);
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${APP_BASE}${path}`, { method, headers, body: payload });
  return { status: response.status, ok: response.ok, body: await readJson(response) };
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

function browserSessionInfo(body) {
  const root = body?.data && typeof body.data === "object" ? body.data : body;
  const session = root?.session && typeof root.session === "object" ? root.session : null;
  const user = root?.user && typeof root.user === "object" ? root.user : null;
  return {
    userId: typeof user?.id === "string" ? user.id : null,
    impersonatedBy: typeof session?.impersonatedBy === "string" ? session.impersonatedBy : typeof session?.impersonated_by === "string" ? session.impersonated_by : null,
  };
}

async function browserToken(page) {
  const result = await browserJson(page, "/api/auth/token");
  const token = result.body?.token || result.body?.data?.token || "";
  assert.ok(result.ok && typeof token === "string" && token.length > 40, `browser native token unavailable (${result.status})`);
  return token;
}

async function waitForLauncher(page, expectedVisible) {
  const launcher = page.getByRole("button", { name: "Visualizza come cliente", exact: true });
  if (expectedVisible) {
    await launcher.waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await launcher.isEnabled(), true);
  } else {
    await sleep(700);
    assert.equal(await launcher.count(), 0);
  }
}

async function assertBanner(page, label = emails.customer) {
  const banner = page.locator(".impersonation-banner");
  await banner.waitFor({ state: "visible", timeout: 15000 });
  await page.getByText(`Stai visualizzando l'account di ${label}`, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
  const stop = page.getByRole("button", { name: "Termina visualizzazione", exact: true });
  await stop.waitFor({ state: "visible", timeout: 10000 });
  return stop;
}

async function assertNoGraveHorizontalOverflow(page, label) {
  const widths = await page.evaluate(() => ({ inner: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(widths.scroll <= widths.inner + 8, `${label} horizontal overflow ${widths.scroll} > ${widths.inner}`);
}

async function openAndConfirm(page) {
  const launcher = page.getByRole("button", { name: "Visualizza come cliente", exact: true });
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Visualizza come questo cliente?" });
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.getByText(/entrerai temporaneamente/i).waitFor({ state: "visible" });
  await dialog.getByText(/azioni relative all'impersonation sono tracciate/i).waitFor({ state: "visible" });
  await dialog.getByText(/puoi terminare la visualizzazione in qualsiasi momento/i).waitFor({ state: "visible" });
  return dialog;
}

async function runUiCycle(page, { viewportLabel, injectStopFailure = false, navigateAllRoutes = false }) {
  await page.goto(`${APP_BASE}/admin/clienti/${encodeURIComponent(customer.id)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForLauncher(page, true);

  let dialog = await openAndConfirm(page);
  await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: 5000 });
  dialog = await openAndConfirm(page);
  if (viewportLabel === "mobile") await assertNoGraveHorizontalOverflow(page, "mobile confirmation modal");

  await dialog.getByRole("button", { name: "Visualizza come cliente", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
  await assertBanner(page);

  let sessionResult = await browserJson(page, "/api/auth/get-session");
  let session = browserSessionInfo(sessionResult.body);
  assert.equal(session.userId, customer.id, `${viewportLabel}: current identity did not become CUSTOMER_A`);
  assert.equal(session.impersonatedBy, admin.id, `${viewportLabel}: impersonatedBy did not preserve Admin actor`);
  const customerToken = await browserToken(page);
  assert.equal(decodeSub(customerToken), customer.id);

  const ownRead = await selectProfile(customerToken, customerSlug);
  assert.ok(ownRead.response.ok && rows(ownRead.body).length === 1, `${viewportLabel}: CUSTOMER_A tenant unavailable`);
  const otherRead = await selectProfile(customerToken, customerBSlug);
  assert.ok(!otherRead.response.ok || rows(otherRead.body).length === 0, `${viewportLabel}: tenant B became accessible`);

  for (const [path, method, body] of [
    ["/api/admin/me", "GET", undefined],
    ["/api/admin/customers", "GET", undefined],
    ["/api/admin/audit?page=1&limit=25", "GET", undefined],
    [`/api/admin/customers/${encodeURIComponent(customer.id)}/sessions`, "GET", undefined],
    [`/api/admin/customers/${encodeURIComponent(customerB.id)}/ban`, "POST", { reason: "qa-ui-denial" }],
  ]) {
    const result = await browserJson(page, path, {
      method,
      headers: { authorization: `Bearer ${customerToken}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(result.status, 403, `${viewportLabel}: Admin surface ${path} was not denied while impersonating`);
  }

  await page.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 15000 });
  await assertBanner(page);
  assert.equal(await page.locator(".admin-sidebar").count(), 0, `${viewportLabel}: Admin navigation remained mounted while impersonating`);

  if (navigateAllRoutes) {
    const routes = ["/app/dashboard", "/app/profili", "/app/brand", "/app/sito", "/app/contenuti", "/app/approvazioni", "/app/calendario", "/app/social", "/app/analytics", "/app/apprendimento", "/app/impostazioni"];
    for (const route of routes) {
      await page.goto(`${APP_BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await assertBanner(page);
    }
  } else {
    await page.goto(`${APP_BASE}/app/social`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await assertBanner(page);
  }

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  let stop = await assertBanner(page);
  sessionResult = await browserJson(page, "/api/auth/get-session");
  session = browserSessionInfo(sessionResult.body);
  assert.equal(session.userId, customer.id, `${viewportLabel}: refresh lost customer identity`);
  assert.equal(session.impersonatedBy, admin.id, `${viewportLabel}: refresh lost impersonatedBy`);

  if (viewportLabel === "mobile") await assertNoGraveHorizontalOverflow(page, "mobile impersonation banner");

  if (injectStopFailure) {
    let intercepted = 0;
    await page.route("**/api/admin/impersonation/stop", async (route) => {
      if (route.request().method() === "POST" && intercepted === 0) {
        intercepted += 1;
        await sleep(250);
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "QA_INJECTED_STOP_FAILURE" }) });
        return;
      }
      await route.continue();
    });
    await stop.click();
    await page.getByText(/La sessione resta invariata: riprova\./).waitFor({ state: "visible", timeout: 10000 });
    await assertBanner(page);
    assert.equal(await page.getByRole("button", { name: "Termina visualizzazione", exact: true }).isEnabled(), true, "stop failure did not expose retry");
    assert.ok(page.url().includes("/app/"), "stop failure caused a false Admin redirect");
    sessionResult = await browserJson(page, "/api/auth/get-session");
    session = browserSessionInfo(sessionResult.body);
    assert.equal(session.userId, customer.id, "stop failure changed customer identity");
    assert.equal(session.impersonatedBy, admin.id, "stop failure cleared impersonatedBy");
    await page.unroute("**/api/admin/impersonation/stop");
    stop = page.getByRole("button", { name: "Termina visualizzazione", exact: true });
  }

  await stop.click();
  await page.waitForURL((url) => url.pathname === `/admin/clienti/${customer.id}`, { timeout: 20000 });
  sessionResult = await browserJson(page, "/api/auth/get-session");
  session = browserSessionInfo(sessionResult.body);
  assert.equal(session.userId, admin.id, `${viewportLabel}: Admin identity was not restored after UI stop`);
  assert.equal(session.impersonatedBy, null, `${viewportLabel}: impersonatedBy remained after UI stop`);
  const restoredToken = await browserToken(page);
  assert.equal(decodeSub(restoredToken), admin.id);
  const adminMe = await browserJson(page, "/api/admin/me", { headers: { authorization: `Bearer ${restoredToken}` } });
  assert.equal(adminMe.status, 200, `${viewportLabel}: Admin API was not restored`);
  await waitForLauncher(page, true);
}

const customer = await signUp(emails.customer, customerName);
await sleep(350);
const customerB = await signUp(emails.customerB, customerBName);
await sleep(350);
const adminCandidate = await signUp(emails.admin, `Impersonation UI Admin ${marker}`);
await waitIdentity(customer.token, customer.id, "CUSTOMER_A");
await waitIdentity(customerB.token, customerB.id, "CUSTOMER_B");
await waitIdentity(adminCandidate.token, adminCandidate.id, "ADMIN candidate");

let state = await controller("state");
assert.equal(state.qaUsers, 3);
assert.equal(state.qaProfiles, 0);

const insertA = await insertProfile(customer.token, customerSlug, customerName);
assert.ok(insertA.response.ok && firstRow(insertA.body)?.id, `CUSTOMER_A profile insert failed (${insertA.response.status})`);
const insertB = await insertProfile(customerB.token, customerBSlug, customerBName);
assert.ok(insertB.response.ok && firstRow(insertB.body)?.id, `CUSTOMER_B profile insert failed (${insertB.response.status})`);
const promoted = await controller("promote");
assert.equal(promoted.qaAdmins, 1);
assert.equal(promoted.superAdmins, 2);
await sleep(300);
const admin = await signIn(emails.admin);
assert.equal(admin.id, adminCandidate.id);
assert.equal((await productRequest(admin.token, "/api/admin/me")).status, 200);

const browser = await chromium.launch({ headless: true });
let browserDirectNeon = 0;
const pageErrors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("request", (request) => {
    try { if (new URL(request.url()).hostname.includes("neonauth")) browserDirectNeon += 1; } catch { /* ignore */ }
  });
  page.on("pageerror", (error) => pageErrors.push(error?.name || "PageError"));

  await browserLogin(page, emails.admin);
  const browserAdminToken = await browserToken(page);
  assert.equal(decodeSub(browserAdminToken), admin.id);

  const realAdmin = await controller("real-admin-target");
  await page.goto(`${APP_BASE}/admin/clienti/${encodeURIComponent(realAdmin.id)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForLauncher(page, false);

  const ban = await productRequest(admin.token, `/api/admin/customers/${encodeURIComponent(customerB.id)}/ban`, "POST", { reason: `qa-ui-visibility-${marker}` });
  assert.ok(ban.status === 200 || ban.status === 207, `banned target setup failed (${ban.status})`);
  await page.goto(`${APP_BASE}/admin/clienti/${encodeURIComponent(customerB.id)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForLauncher(page, false);
  const unban = await productRequest(admin.token, `/api/admin/customers/${encodeURIComponent(customerB.id)}/unban`, "POST", {});
  assert.ok(unban.status === 200 || unban.status === 207, `banned target cleanup failed (${unban.status})`);

  await runUiCycle(page, { viewportLabel: "desktop", injectStopFailure: true, navigateAllRoutes: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await runUiCycle(page, { viewportLabel: "mobile", injectStopFailure: false, navigateAllRoutes: false });
  await assertNoGraveHorizontalOverflow(page, "mobile restored Admin customer detail");

  assert.equal(browserDirectNeon, 0, "regular UI runtime made direct browser Neon Auth requests");
  assert.deepEqual(pageErrors, [], `browser page errors observed: ${pageErrors.join(",")}`);
  await context.close();
} finally {
  await browser.close();
}

const impersonationState = await controller("impersonation-state");
assert.equal(impersonationState.summary.impersonated, 0, "UI runtime left native impersonation active");
const audit = await controller("audit-state");
const starts = audit.events?.filter((event) => event.action === "IMPERSONATION_STARTED" && event.actorKind === "admin" && event.targetKind === "customer" && event.provider === "NEON_MANAGED_AUTH" && event.sessionBound === true) || [];
const ends = audit.events?.filter((event) => event.action === "IMPERSONATION_ENDED" && event.actorKind === "admin" && event.targetKind === "customer" && event.provider === "NEON_MANAGED_AUTH" && event.sessionBound === true) || [];
assert.ok(starts.length >= 2, "desktop/mobile UI start audit events missing");
assert.ok(ends.length >= 2, "desktop/mobile UI stop audit events missing");

console.log("IMPERSONATION_UI_RUNTIME: PASS", JSON.stringify({
  desktop: "PASS",
  mobile: "PASS",
  ctaVisibility: "PASS",
  confirmationModal: "PASS",
  customerContext: "PASS",
  bannerAllCustomerRoutes: "PASS",
  navigationPersistence: "PASS",
  refreshPersistence: "PASS",
  stopFailureFailClosed: "PASS",
  stop: "PASS",
  adminRestored: "PASS",
  adminNavWhileImpersonating: "ABSENT",
  adminApisWhileImpersonating: "DENIED",
  sessionManagementWhileImpersonating: "DENIED",
  banWhileImpersonating: "DENIED",
  auditViewerWhileImpersonating: "DENIED",
  tenantA: "PASS",
  tenantBDenied: "PASS",
  bannedTargetCta: "HIDDEN",
  adminTargetCta: "HIDDEN",
  browserDirectNeonAuth: browserDirectNeon,
  auditStart: "PASS",
  auditEnd: "PASS",
  actorPreserved: "PASS",
  severeMobileOverflow: 0,
  privilegeBleed: 0,
  sensitiveFindings: 0,
}));
