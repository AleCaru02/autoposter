import assert from "node:assert/strict";
import { chromium } from "playwright";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";
assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);

const emails = {
  owner: `audit-smoke-${marker}-customer@example.invalid`,
  customerB: `audit-smoke-${marker}-customer-b@example.invalid`,
  admin: `audit-smoke-${marker}-admin@example.invalid`,
};
const uaA1 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const uaA2 = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36";
const uaA3 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const uaB = "<img src=x onerror=globalThis.__sessionXss=1>";
const uaAdmin = "Session-UI-Smoke-Admin";
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
  secrets() { return [...this.values.values()].filter(Boolean); }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { invalidJson: true }; }
}

async function authFetch(jar, path, init = {}, userAgent = null) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("origin", APP_BASE);
  headers.set("referer", `${APP_BASE}/`);
  if (userAgent) headers.set("user-agent", userAgent);
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
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")).sub;
}

async function identityToken(jar, userAgent) {
  const response = await authFetch(jar, "/token", {}, userAgent);
  const body = await readJson(response);
  const token = body?.token || body?.data?.token || "";
  assert.ok(response.ok && token.length > 40, `Managed Auth token unavailable (${response.status})`);
  return token;
}

async function signIn(email, userAgent) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) }, userAgent);
  assert.ok(response.ok, `Managed Auth signin failed (${response.status})`);
  const token = await identityToken(jar, userAgent);
  return { jar, token, id: decodeSub(token), userAgent };
}

async function signUp(email, name, userAgent) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) }, userAgent);
  assert.ok(response.ok, `Managed Auth signup failed (${response.status})`);
  const token = await identityToken(jar, userAgent);
  return { jar, token, id: decodeSub(token), userAgent };
}

async function getSession(identity) {
  const response = await authFetch(identity.jar, "/get-session", {}, identity.userAgent);
  const body = await readJson(response);
  const session = body?.session || body?.data?.session || null;
  const user = body?.user || body?.data?.user || null;
  return { active: Boolean(response.ok && session && user?.id), session, user, status: response.status };
}

async function productApi(path, token, expected = 200) {
  let lastStatus = 0;
  let body = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${APP_BASE}${path}`, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
    lastStatus = response.status;
    body = await readJson(response);
    if (lastStatus === expected) return body;
    if (lastStatus === 401 && [200, 403].includes(expected)) { await sleep(400); continue; }
    break;
  }
  assert.equal(lastStatus, expected, `${path} expected ${expected}, got ${lastStatus}`);
  return body;
}

function exactSafeSessionKeys(session) {
  assert.ok(session && typeof session === "object" && !Array.isArray(session));
  assert.deepEqual(Object.keys(session).sort(), ["createdAt", "expiresAt", "id", "ipAddress", "updatedAt", "userAgent"].sort());
}

function sensitiveFindings(value, secrets, path = "root", findings = []) {
  const forbidden = new Set(["token", "sessiontoken", "jwt", "authorization", "cookie", "password", "databaseurl", "controllertoken", "userid", "impersonatedby", "activeorganizationid"]);
  if (Array.isArray(value)) {
    value.forEach((child, index) => sensitiveFindings(child, secrets, `${path}[${index}]`, findings));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (forbidden.has(normalized)) findings.push(`${path}.${key}`);
      sensitiveFindings(child, secrets, `${path}.${key}`, findings);
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

function sanitizeDiagnostic(value) {
  return String(value || "")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|cookie|password|session[-_ ]?token|access[-_ ]?token|refresh[-_ ]?token|api[-_ ]?key|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 280);
}

function browserDiagnostics(page) {
  const critical = [];
  const responses = [];
  const responseReads = [];
  page.on("pageerror", (error) => critical.push(`pageerror:${sanitizeDiagnostic(error.message)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("403") && !message.text().includes("503")) critical.push(`console:error:${sanitizeDiagnostic(message.text())}`);
  });
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin === APP_BASE && url.pathname.startsWith("/api/admin/")) {
        responses.push({ path: url.pathname, status: response.status() });
        if (url.pathname.includes("/sessions") || url.pathname === "/api/admin/audit") {
          responseReads.push((async () => {
            try {
              const text = await response.text();
              if (!text) return null;
              try { return JSON.parse(text); } catch { return { invalidJson: true }; }
            } catch { return null; }
          })());
        }
      }
    } catch { /* ignore */ }
  });
  return { critical, responses, responseReads };
}

async function login(page, email) {
  const response = await page.goto(`${APP_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(response?.status(), 200);
  await page.locator('input[type="email"]').waitFor({ state: "visible", timeout: 15000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20000 });
}

async function adminCustomerPage(context, customerId) {
  const loginPage = await context.newPage();
  await login(loginPage, emails.admin);
  const page = await context.newPage();
  const diag = browserDiagnostics(page);
  await page.goto(`${APP_BASE}/admin/clienti/${encodeURIComponent(customerId)}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Sessioni attive", exact: true }).waitFor({ timeout: 20000 });
  await loginPage.close();
  return { page, diag };
}

async function verifyDenied(browser, email, customerId, label) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const diag = browserDiagnostics(page);
  try {
    await login(page, email);
    await page.goto(`${APP_BASE}/admin/clienti/${encodeURIComponent(customerId)}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
    assert.ok(diag.responses.some((entry) => entry.path === "/api/admin/me" && entry.status === 403), `${label} /api/admin/me 403 not observed`);
    assert.ok(!(await page.locator("body").innerText()).includes("Sessioni attive"), `${label} received Session Admin UI`);
    return "PASS";
  } finally { await context.close(); }
}

function assertSessionListShape(body, foreignSessionId = null) {
  assert.ok(Array.isArray(body?.sessions));
  body.sessions.forEach(exactSafeSessionKeys);
  if (foreignSessionId) assert.equal(body.sessions.some((session) => session.id === foreignSessionId), false, "foreign customer session present in Customer A list");
}

async function sessionBodies(diag) {
  const bodies = (await Promise.all(diag.responseReads)).filter(Boolean);
  return bodies.filter((body) => Array.isArray(body?.sessions));
}

async function assertBrowserSafe(page, diag, secrets) {
  const bodies = await Promise.all(diag.responseReads);
  for (const body of bodies.filter(Boolean)) assert.deepEqual(sensitiveFindings(body, secrets), [], "sensitive material found in Admin browser response");
  const html = await page.locator("body").innerText();
  assert.deepEqual(sensitiveFindings(html, secrets), [], "sensitive material found in DOM text");
  assert.deepEqual(diag.critical, [], `critical browser errors: ${JSON.stringify(diag.critical)}`);
}

// The permanent Audit runtime already created/promoted OWNER A and ADMIN_SMOKE.
const a1 = await signIn(emails.owner, uaA1);
const a2 = await signIn(emails.owner, uaA2);
const customerB = await signUp(emails.customerB, "Session Smoke Customer B", uaB);
const adminDirect = await signIn(emails.admin, uaAdmin);
assert.equal(a1.id, a2.id);
assert.notEqual(a1.id, customerB.id);
assert.notEqual(a1.id, adminDirect.id);
const a1Before = await getSession(a1);
const a2Before = await getSession(a2);
const bBefore = await getSession(customerB);
const adminBefore = await getSession(adminDirect);
for (const state of [a1Before, a2Before, bBefore, adminBefore]) assert.equal(state.active, true, "runtime dataset session inactive");
const a1Id = String(a1Before.session?.id || "");
const a2Id = String(a2Before.session?.id || "");
const bId = String(bBefore.session?.id || "");
assert.ok(a1Id && a2Id && bId && new Set([a1Id, a2Id, bId]).size === 3);
const secretValues = [password, controllerToken, a1.token, a2.token, customerB.token, adminDirect.token, ...a1.jar.secrets(), ...a2.jar.secrets(), ...customerB.jar.secrets(), ...adminDirect.jar.secrets(), String(a1Before.session?.token || ""), String(a2Before.session?.token || ""), String(bBefore.session?.token || "")].filter(Boolean);

const browser = await chromium.launch({ headless: true });
const result = {
  customerDenied: "PENDING", ownerDenied: "PENDING", superAdminList: "PENDING",
  desktop: {}, mobile: {}, sessionA: {}, audit: {}, sensitive: "PENDING", xss: "PENDING", error: "PENDING",
};
try {
  result.customerDenied = await verifyDenied(browser, emails.customerB, a1.id, "CUSTOMER");
  result.ownerDenied = await verifyDenied(browser, emails.owner, a1.id, "OWNER");

  // Desktop: loading no-flicker, controlled load error, recovery, list, modal and real single revoke.
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page: desktop, diag: desktopDiag } = await adminCustomerPage(desktopContext, a1.id);
  try {
    // Controlled verifier-only load failure. Production is untouched.
    await desktop.route(`**/api/admin/customers/${encodeURIComponent(a1.id)}/sessions`, async (route) => {
      if (route.request().method() === "GET") await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "VERIFIER_CONTROLLED_FAILURE" }) });
      else await route.continue();
    }, { times: 1 });
    await desktop.reload({ waitUntil: "domcontentloaded" });
    await desktop.getByText("Sessioni non disponibili. Riprova.", { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await desktop.getByRole("button", { name: "Revoca tutte le sessioni", exact: true }).count(), 0, "revoke-all rendered during load error");
    result.error = "PASS";

    let releaseLoad;
    const loadGate = new Promise((resolve) => { releaseLoad = resolve; });
    await desktop.route(`**/api/admin/customers/${encodeURIComponent(a1.id)}/sessions`, async (route) => {
      if (route.request().method() === "GET") { await loadGate; await route.continue(); }
      else await route.continue();
    }, { times: 1 });
    await desktop.getByRole("button", { name: "Riprova", exact: true }).click();
    await desktop.getByText("Caricamento sessioni…", { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await desktop.getByRole("button", { name: "Revoca tutte le sessioni", exact: true }).count(), 0, "revoke-all flickered during loading");
    releaseLoad();
    await desktop.locator(".admin-session-card").first().waitFor({ timeout: 20000 });

    const cards = desktop.locator(".admin-session-card");
    assert.ok(await cards.count() >= 2, "desktop expected at least two Customer A sessions");
    for (const label of ["IP", "Creata", "Ultima attività", "Scadenza"]) assert.ok((await desktop.getByText(label, { exact: true }).count()) >= 1, `desktop metadata ${label} missing`);
    assert.ok(await desktop.getByText("iPhone · Safari", { exact: true }).count() >= 1, "Session A device label missing");
    assert.ok(await desktop.getByText("Android · Chrome", { exact: true }).count() >= 1, "Session B device label missing");
    assert.ok(await desktop.getByText("Attiva", { exact: true }).count() >= 2, "session status missing");
    assert.equal(await desktop.getByRole("button", { name: "Revoca tutte le sessioni", exact: true }).count(), 1, "revoke-all missing for non-empty list");
    const layout = await desktop.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
    assert.ok(layout.scrollWidth <= layout.viewportWidth + 2, `desktop overflow ${layout.scrollWidth} > ${layout.viewportWidth}`);
    const listBodies = await sessionBodies(desktopDiag);
    assert.ok(listBodies.length >= 1);
    for (const body of listBodies) assertSessionListShape(body, bId);
    result.superAdminList = "PASS";
    result.desktop.list = "PASS";

    // Desktop revoke-all control/modal is reachable; cancel without mutation.
    await desktop.getByRole("button", { name: "Revoca tutte le sessioni", exact: true }).click();
    let dialog = desktop.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Revoca tutte le sessioni", exact: true }).waitFor();
    assert.ok((await dialog.innerText()).includes("Tutte le sessioni attive di questo cliente verranno invalidate"));
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    result.desktop.revokeAll = "PASS";
    result.desktop.modal = "PASS";

    const a1Card = desktop.locator(".admin-session-card").filter({ hasText: "iPhone · Safari" }).first();
    await a1Card.getByRole("button", { name: "Revoca sessione", exact: true }).click();
    dialog = desktop.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Revoca sessione", exact: true }).waitFor();
    assert.ok((await dialog.innerText()).includes("iPhone · Safari"));
    assert.equal(await dialog.getByRole("button", { name: "Annulla", exact: true }).count(), 1);

    // Controlled mutation failure: no false success and auth session remains valid.
    await desktop.route(`**/api/admin/customers/${encodeURIComponent(a1.id)}/sessions/${encodeURIComponent(a1Id)}`, async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "VERIFIER_CONTROLLED_MUTATION_FAILURE" }) });
    }, { times: 1 });
    await dialog.getByRole("button", { name: "Revoca sessione", exact: true }).click();
    await desktop.getByText("Revoca non riuscita. La lista non è stata modificata e nessun successo è stato mostrato.", { exact: true }).waitFor({ timeout: 10000 });
    assert.equal((await getSession(a1)).active, true, "controlled mutation failure altered Session A");
    assert.ok(await desktop.locator(".admin-session-card").filter({ hasText: "iPhone · Safari" }).count() >= 1, "failed mutation removed Session A visually");

    // Real single revoke with delayed route proves double-submit guard.
    await a1Card.getByRole("button", { name: "Revoca sessione", exact: true }).click();
    dialog = desktop.getByRole("dialog");
    let deleteCount = 0;
    await desktop.route(`**/api/admin/customers/${encodeURIComponent(a1.id)}/sessions/${encodeURIComponent(a1Id)}`, async (route) => {
      deleteCount += 1;
      await sleep(500);
      await route.continue();
    }, { times: 1 });
    const confirm = dialog.getByRole("button", { name: "Revoca sessione", exact: true });
    const deleteResponse = desktop.waitForResponse((response) => response.url().endsWith(`/sessions/${encodeURIComponent(a1Id)}`) && response.request().method() === "DELETE" && response.status() === 200, { timeout: 20000 });
    await confirm.click();
    await sleep(80);
    assert.equal(await confirm.isDisabled(), true, "single revoke confirm not disabled while busy");
    await confirm.evaluate((element) => element.click());
    await deleteResponse;
    assert.equal(deleteCount, 1, "double submit emitted more than one single revoke request");
    await desktop.getByText("Sessione revocata. Il cliente è stato disconnesso da quella sessione.", { exact: true }).waitFor({ timeout: 20000 });
    await desktop.locator(".admin-session-card").filter({ hasText: "iPhone · Safari" }).waitFor({ state: "detached", timeout: 20000 });
    assert.equal((await getSession(a1)).active, false, "Session A not invalidated after UI revoke");
    assert.equal((await getSession(a2)).active, true, "Session B invalidated by single revoke");
    assert.equal((await getSession(customerB)).active, true, "Customer B impacted by Customer A single revoke");
    assert.equal((await getSession(adminDirect)).active, true, "Admin impacted by Customer A single revoke");
    result.sessionA = { revokeUi: "PASS", invalidated: "PASS", sessionBPreserved: "PASS", customerBPreserved: "PASS", adminPreserved: "PASS", doubleSubmit: "PASS" };
    result.desktop.single = "PASS";

    const auditSingle = await productApi(`/api/admin/audit?action=USER_SESSION_REVOKED&target=${encodeURIComponent(a1.id)}&limit=25&page=1`, adminDirect.token, 200);
    const singleRow = auditSingle?.audit?.find((row) => row.action === "USER_SESSION_REVOKED" && row.target_id === a1.id && row.actor_auth_user_id === adminDirect.id);
    assert.ok(singleRow, "UI-originated USER_SESSION_REVOKED audit row missing");
    assert.ok(Number.isFinite(Date.parse(singleRow.created_at)), "single revoke audit timestamp invalid");
    assert.equal(singleRow.metadata?.sessionRef, a1Id, "single revoke audit session ref mismatch");
    assert.equal(JSON.stringify(singleRow.metadata || {}).includes(uaA1), false, "single revoke audit contains userAgent");
    assert.deepEqual(sensitiveFindings(singleRow, secretValues), [], "single revoke audit contains sensitive material");
    result.audit.single = "PASS";

    await assertBrowserSafe(desktop, desktopDiag, secretValues);
  } finally { await desktopContext.close(); }

  // Restore >=2 valid A sessions before revoke-all: preserved A2 + new A3.
  const a3 = await signIn(emails.owner, uaA3);
  const a3Before = await getSession(a3);
  assert.equal(a3Before.active, true);
  const a3Id = String(a3Before.session?.id || "");
  assert.ok(a3Id && a3Id !== a2Id);
  secretValues.push(a3.token, ...a3.jar.secrets(), String(a3Before.session?.token || ""));

  // Mobile: list, modal/single reachability, real revoke-all, empty state and isolation.
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { page: mobile, diag: mobileDiag } = await adminCustomerPage(mobileContext, a1.id);
  try {
    await mobile.locator(".admin-session-card").first().waitFor({ timeout: 20000 });
    assert.ok(await mobile.locator(".admin-session-card").count() >= 2, "mobile expected at least two Customer A sessions before revoke-all");
    assert.ok(await mobile.getByText("Android · Chrome", { exact: true }).count() >= 1, "preserved Session B missing on mobile");
    assert.ok(await mobile.getByText("Windows · Edge", { exact: true }).count() >= 1, "restored Session A3 missing on mobile");
    for (const label of ["IP", "Creata", "Ultima attività", "Scadenza"]) assert.ok((await mobile.getByText(label, { exact: true }).count()) >= 1, `mobile metadata ${label} missing`);
    const layoutBefore = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
    assert.ok(layoutBefore.scrollWidth <= layoutBefore.viewportWidth + 2, `mobile overflow ${layoutBefore.scrollWidth} > ${layoutBefore.viewportWidth}`);
    assert.equal(await mobile.getByRole("button", { name: "Revoca tutte le sessioni", exact: true }).count(), 1);
    result.mobile.list = "PASS";
    result.mobile.overflow = "PASS";

    // Mobile single revoke is reachable and modal usable; cancel.
    const a2Card = mobile.locator(".admin-session-card").filter({ hasText: "Android · Chrome" }).first();
    await a2Card.getByRole("button", { name: "Revoca sessione", exact: true }).click();
    let dialog = mobile.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Revoca sessione", exact: true }).waitFor();
    const dialogBox = await dialog.boundingBox();
    assert.ok(dialogBox && dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 844 + 2, "mobile modal clipped outside viewport");
    await dialog.getByRole("button", { name: "Annulla", exact: true }).click();
    result.mobile.single = "PASS";
    result.mobile.modal = "PASS";

    // Real revoke-all with delayed route proves double-submit guard.
    await mobile.getByRole("button", { name: "Revoca tutte le sessioni", exact: true }).click();
    dialog = mobile.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Revoca tutte le sessioni", exact: true }).waitFor();
    assert.ok((await dialog.innerText()).includes("Tutte le sessioni attive di questo cliente verranno invalidate. L’amministratore resterà connesso."));
    let deleteAllCount = 0;
    await mobile.route(`**/api/admin/customers/${encodeURIComponent(a1.id)}/sessions`, async (route) => {
      if (route.request().method() === "DELETE") { deleteAllCount += 1; await sleep(500); await route.continue(); }
      else await route.continue();
    }, { times: 1 });
    const confirmAll = dialog.getByRole("button", { name: "Revoca tutte", exact: true });
    const allResponse = mobile.waitForResponse((response) => response.url().endsWith(`/api/admin/customers/${encodeURIComponent(a1.id)}/sessions`) && response.request().method() === "DELETE" && response.status() === 200, { timeout: 20000 });
    await confirmAll.click();
    await sleep(80);
    assert.equal(await confirmAll.isDisabled(), true, "revoke-all confirm not disabled while busy");
    await confirmAll.evaluate((element) => element.click());
    await allResponse;
    assert.equal(deleteAllCount, 1, "double submit emitted more than one revoke-all request");
    await mobile.getByText("Nessuna sessione attiva.", { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await mobile.getByRole("button", { name: "Revoca tutte le sessioni", exact: true }).count(), 0, "empty state still renders revoke-all");
    assert.equal((await getSession(a2)).active, false, "revoke-all left Session B valid");
    assert.equal((await getSession(a3)).active, false, "revoke-all left Session A3 valid");
    assert.equal((await getSession(customerB)).active, true, "revoke-all impacted Customer B");
    assert.equal((await getSession(adminDirect)).active, true, "revoke-all impacted Admin");
    const layoutAfter = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
    assert.ok(layoutAfter.scrollWidth <= layoutAfter.viewportWidth + 2, "mobile empty-state overflow");
    result.mobile.revokeAll = "PASS";
    result.mobile.empty = "PASS";

    const auditAll = await productApi(`/api/admin/audit?action=USER_SESSIONS_REVOKED&target=${encodeURIComponent(a1.id)}&limit=25&page=1`, adminDirect.token, 200);
    const allRow = auditAll?.audit?.find((row) => row.action === "USER_SESSIONS_REVOKED" && row.target_id === a1.id && row.actor_auth_user_id === adminDirect.id);
    assert.ok(allRow, "UI-originated USER_SESSIONS_REVOKED audit row missing");
    assert.ok(Number.isFinite(Date.parse(allRow.created_at)), "revoke-all audit timestamp invalid");
    assert.deepEqual(sensitiveFindings(allRow, secretValues), [], "revoke-all audit contains sensitive material");
    result.audit.all = "PASS";
    await assertBrowserSafe(mobile, mobileDiag, secretValues);
  } finally { await mobileContext.close(); }

  // Desktop empty state on a fresh load: CTA must be absent from DOM.
  const emptyDesktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page: emptyDesktop, diag: emptyDesktopDiag } = await adminCustomerPage(emptyDesktopContext, a1.id);
  try {
    await emptyDesktop.getByText("Nessuna sessione attiva.", { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await emptyDesktop.getByRole("button", { name: "Revoca tutte le sessioni", exact: true }).count(), 0);
    result.desktop.empty = "PASS";
    await assertBrowserSafe(emptyDesktop, emptyDesktopDiag, secretValues);
  } finally { await emptyDesktopContext.close(); }

  // Customer B XSS/safe-render probe: controlled HTML-like userAgent must not execute or become markup.
  const xssContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page: xssPage, diag: xssDiag } = await adminCustomerPage(xssContext, customerB.id);
  try {
    await xssPage.locator(".admin-session-card").first().waitFor({ timeout: 20000 });
    const xssBodies = await sessionBodies(xssDiag);
    assert.ok(xssBodies.length >= 1);
    xssBodies.forEach((body) => assertSessionListShape(body));
    const rawSeen = xssBodies.some((body) => body.sessions.some((session) => String(session.userAgent || "").includes("<img")));
    assert.equal(await xssPage.locator('img[src="x"]').count(), 0, "HTML-like userAgent became DOM markup");
    assert.equal(await xssPage.evaluate(() => Boolean(globalThis.__sessionXss)), false, "HTML-like userAgent executed script");
    result.xss = rawSeen ? "PASS_RUNTIME_ESCAPED" : "PASS_STATIC_REACT_ESCAPE";
    await assertBrowserSafe(xssPage, xssDiag, secretValues);
  } finally { await xssContext.close(); }

  // Final Admin and Customer B preservation + cross-user impact zero.
  assert.equal((await getSession(customerB)).active, true);
  assert.equal((await getSession(adminDirect)).active, true);
  const bList = await productApi(`/api/admin/customers/${encodeURIComponent(customerB.id)}/sessions`, adminDirect.token, 200);
  assert.ok(Array.isArray(bList?.sessions) && bList.sessions.some((session) => session.id === bId), "Customer B session missing after Customer A revocations");
  bList.sessions.forEach(exactSafeSessionKeys);
  const aListFinal = await productApi(`/api/admin/customers/${encodeURIComponent(a1.id)}/sessions`, adminDirect.token, 200);
  assert.deepEqual(aListFinal?.sessions, [], "Customer A still has active sessions after revoke-all");
  assert.deepEqual(sensitiveFindings([bList, aListFinal], secretValues), [], "final API safe scan found sensitive material");
  result.sensitive = "PASS_0_FINDINGS";

  console.log("SESSION_MANAGEMENT_UI_RUNTIME: PASS", JSON.stringify({
    customerDenied: result.customerDenied,
    ownerDenied: result.ownerDenied,
    superAdminList: result.superAdminList,
    desktop: { list: result.desktop.list, empty: result.desktop.empty, singleRevoke: result.desktop.single, revokeAll: result.desktop.revokeAll, modal: result.desktop.modal, error: result.error },
    mobile: { list: result.mobile.list, empty: result.mobile.empty, singleRevoke: result.mobile.single, revokeAll: result.mobile.revokeAll, modal: result.mobile.modal, overflow: result.mobile.overflow },
    sessionARevokeUi: result.sessionA.revokeUi,
    sessionAInvalidated: result.sessionA.invalidated,
    sessionBPreserved: result.sessionA.sessionBPreserved,
    customerBPreserved: "PASS",
    adminPreserved: "PASS",
    crossUserImpact: 0,
    auditSingle: result.audit.single,
    auditAll: result.audit.all,
    xss: result.xss,
    sensitiveFindings: 0,
    controlledError: result.error,
    doubleSubmit: result.sessionA.doubleSubmit,
  }));
} finally {
  await browser.close();
}