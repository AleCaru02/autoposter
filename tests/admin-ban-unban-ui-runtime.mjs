import assert from "node:assert/strict";
import { chromium } from "playwright";

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

const customerEmail = `audit-smoke-${marker}-customer@example.invalid`;
const adminEmail = `audit-smoke-${marker}-admin@example.invalid`;
const customerSlug = `qa-ban-ui-${marker}`;
const reason = `qa-admin-ban-ui-${marker}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) { for (const raw of headers.getSetCookie?.() || []) { const pair = raw.split(";", 1)[0]; const i = pair.indexOf("="); if (i > 0) this.values.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); } }
  header() { return [...this.values.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function readJson(response) { const text = await response.text(); if (!text) return null; try { return JSON.parse(text); } catch { return null; } }
async function authFetch(jar, path, init = {}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const headers = new Headers(init.headers); headers.set("accept", "application/json"); headers.set("origin", APP_BASE); headers.set("referer", `${APP_BASE}/`); if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json"); const cookie = jar.header(); if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" }); jar.absorb(response.headers);
    if (response.status !== 429 || attempt === 7) return response;
    await response.body?.cancel().catch(() => {}); await sleep(Math.min(1000 * (2 ** attempt), 10000));
  }
}
function decodeSub(token) { const p = token.split(".")[1]; assert.ok(p); const n = p.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(p.length / 4) * 4, "="); const body = JSON.parse(Buffer.from(n, "base64").toString("utf8")); assert.equal(typeof body.sub, "string"); return body.sub; }
async function tokenFor(jar) { const response = await authFetch(jar, "/token"); const body = await readJson(response); const token = body?.token || body?.data?.token || ""; assert.ok(response.ok && token.length > 40, `token unavailable ${response.status}`); return token; }
async function signUp(email, name) { const jar = new CookieJar(); const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) }); assert.ok(response.ok, `sign-up failed ${response.status}`); const token = await tokenFor(jar); return { jar, token, id: decodeSub(token) }; }
async function dataFetch(token, path, init = {}) { const headers = new Headers(init.headers); headers.set("accept", "application/json"); headers.set("authorization", `Bearer ${token}`); if (init.body) headers.set("content-type", "application/json"); const response = await fetch(`${DATA_API}${path}`, { ...init, headers }); return { response, body: await readJson(response) }; }
async function waitIdentity(token, id) { for (let i = 0; i < 24; i += 1) { const r = await dataFetch(token, "/rpc/current_auth_user_id", { method: "POST", body: "{}" }); const v = typeof r.body === "string" ? r.body : Array.isArray(r.body) ? r.body[0]?.current_auth_user_id : r.body?.current_auth_user_id; if (r.response.ok && v === id) return; await sleep(500); } throw new Error("Data API identity not ready"); }
async function controller(action) { const response = await fetch(controllerUrl, { method: "POST", headers: { "content-type": "application/json", "x-audit-smoke-token": controllerToken }, body: JSON.stringify({ action, marker }) }); const body = await readJson(response); assert.equal(response.status, 200, `${action} controller ${response.status}`); return body; }
function stateKind(states, kind) { const found = states.find((item) => item?.kind === kind); assert.ok(found, `missing ${kind} state`); return found; }

const customer = await signUp(customerEmail, `Ban UI Customer ${marker}`);
const adminCandidate = await signUp(adminEmail, `Ban UI Admin ${marker}`);
await waitIdentity(customer.token, customer.id);
await waitIdentity(adminCandidate.token, adminCandidate.id);
const inserted = await dataFetch(customer.token, "/profiles?select=id,name,slug", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ name: `Ban UI Customer ${marker}`, slug: customerSlug, website_url: null, industry: "QA security" }) });
assert.ok(inserted.response.ok && Array.isArray(inserted.body) && inserted.body[0]?.id, `customer fixture failed ${inserted.response.status}`);
let fixtureState = await controller("state");
assert.equal(fixtureState.qaUsers, 2); assert.equal(fixtureState.qaAdmins, 0); assert.ok(fixtureState.qaProfiles >= 1); assert.ok(fixtureState.qaOwners >= 1);
const promoted = await controller("promote"); assert.equal(promoted.qaAdmins, 1); assert.equal(promoted.superAdmins, 2);

function sanitize(value) { return String(value || "").replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[JWT]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]").slice(0, 240); }
function diagnostics(page) { const errors = []; const responses = []; page.on("pageerror", (e) => errors.push(`pageerror:${sanitize(e.message)}`)); page.on("console", (m) => { if (m.type() === "error" && !/403/.test(m.text())) errors.push(`console:${sanitize(m.text())}`); }); page.on("response", (r) => { try { const u = new URL(r.url()); if (u.origin === APP_BASE && u.pathname.startsWith("/api/admin/")) responses.push({ path: u.pathname, status: r.status() }); } catch {} }); return { errors, responses }; }
async function login(page, email) { const response = await page.goto(`${APP_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 }); assert.equal(response?.status(), 200); await page.locator('input[type="email"]').fill(email); await page.locator('input[type="password"]').fill(password); await page.locator('button[type="submit"]').click(); await page.waitForURL((u) => u.pathname !== "/login", { timeout: 20000 }); }
async function openCustomerDetail(page) { await page.goto(`${APP_BASE}/admin/clienti/${encodeURIComponent(customer.id)}`, { waitUntil: "domcontentloaded", timeout: 30000 }); await page.getByRole("heading", { name: `Ban UI Customer ${marker}`, exact: true }).waitFor({ timeout: 20000 }); return page.locator(".admin-ban-panel"); }
function localInputValue(date) { const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return shifted.toISOString().slice(0, 16); }

const browser = await chromium.launch({ headless: true });
try {
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customerPage = await customerContext.newPage(); const customerDiag = diagnostics(customerPage);
  await login(customerPage, customerEmail);
  await customerPage.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded" });
  await customerPage.waitForURL((u) => u.pathname === "/app/dashboard", { timeout: 20000 });
  assert.ok(customerDiag.responses.some((r) => r.path === "/api/admin/me" && r.status === 403), "CUSTOMER/OWNER Admin denial missing");

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const loginPage = await adminContext.newPage(); await login(loginPage, adminEmail);
  const page = await adminContext.newPage(); const diag = diagnostics(page);
  let panel = await openCustomerDetail(page);
  await panel.getByRole("button", { name: "Blocca account", exact: true }).waitFor({ timeout: 10000 });
  await panel.getByText("Attivo", { exact: true }).waitFor();

  await panel.getByRole("button", { name: "Blocca account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Blocca Ban UI Customer ${marker}` });
  await dialog.waitFor({ state: "visible" });
  await dialog.getByLabel("Motivo opzionale").fill(reason);
  await dialog.getByLabel("Scadenza opzionale").fill(localInputValue(new Date(Date.now() + 20 * 60 * 1000)));
  const banResponsePromise = page.waitForResponse((r) => r.url().endsWith(`/api/admin/customers/${customer.id}/ban`) && r.request().method() === "POST", { timeout: 20000 });
  await dialog.getByRole("button", { name: "Conferma blocco", exact: true }).click();
  const banResponse = await banResponsePromise; assert.equal(banResponse.status(), 200, "Ban UI POST failed");
  panel = page.locator(".admin-ban-panel");
  await panel.getByText("Sospeso", { exact: true }).waitFor({ timeout: 10000 });
  await panel.getByText(reason, { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Riattiva account", exact: true }).waitFor();
  let banState = await controller("ban-state"); let customerState = stateKind(banState.states, "customer");
  assert.equal(customerState.banned, true); assert.equal(customerState.banReason, reason); assert.ok(customerState.banExpires); assert.equal(customerState.sessions, 0, "Ban UI did not revoke target sessions");

  await page.reload({ waitUntil: "domcontentloaded" });
  panel = page.locator(".admin-ban-panel"); await panel.getByText("Sospeso", { exact: true }).waitFor({ timeout: 20000 }); await panel.getByText(reason, { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Riattiva account", exact: true }).click();
  const unbanDialog = page.getByRole("dialog", { name: `Riattiva Ban UI Customer ${marker}` }); await unbanDialog.waitFor({ state: "visible" });
  const unbanResponsePromise = page.waitForResponse((r) => r.url().endsWith(`/api/admin/customers/${customer.id}/unban`) && r.request().method() === "POST", { timeout: 20000 });
  await unbanDialog.getByRole("button", { name: "Conferma riattivazione", exact: true }).click();
  const unbanResponse = await unbanResponsePromise; assert.equal(unbanResponse.status(), 200, "Unban UI POST failed");
  await panel.getByText("Attivo", { exact: true }).waitFor({ timeout: 10000 }); await panel.getByRole("button", { name: "Blocca account", exact: true }).waitFor();
  banState = await controller("ban-state"); customerState = stateKind(banState.states, "customer"); assert.equal(customerState.banned, false); assert.equal(customerState.banReason, null); assert.equal(customerState.banExpires, null);

  await page.reload({ waitUntil: "domcontentloaded" }); panel = page.locator(".admin-ban-panel"); await panel.getByText("Attivo", { exact: true }).waitFor({ timeout: 20000 });
  await page.goto(`${APP_BASE}/admin/clienti/${encodeURIComponent(adminCandidate.id)}`, { waitUntil: "domcontentloaded" }); await page.getByText("Ban/Unban non disponibile per account SUPER_ADMIN.", { exact: true }).waitFor({ timeout: 20000 }); assert.equal(await page.getByRole("button", { name: "Blocca account", exact: true }).count(), 0);
  assert.deepEqual(diag.errors, [], `desktop browser errors ${JSON.stringify(diag.errors)}`);

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobileLogin = await mobileContext.newPage(); await login(mobileLogin, adminEmail);
  const mobile = await mobileContext.newPage(); const mobileDiag = diagnostics(mobile); const mobilePanel = await openCustomerDetail(mobile);
  const layout = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })); assert.ok(layout.scrollWidth <= layout.innerWidth + 2, `mobile overflow ${layout.scrollWidth}>${layout.innerWidth}`);
  await mobilePanel.getByRole("button", { name: "Blocca account", exact: true }).click(); const mobileDialog = mobile.getByRole("dialog", { name: `Blocca Ban UI Customer ${marker}` }); await mobileDialog.waitFor({ state: "visible" }); const box = await mobileDialog.boundingBox(); assert.ok(box && box.width <= 390 && box.height <= 844, "mobile Ban modal outside viewport"); await mobileDialog.getByRole("button", { name: "Annulla", exact: true }).click(); await mobileDialog.waitFor({ state: "hidden" });
  assert.deepEqual(mobileDiag.errors, [], `mobile browser errors ${JSON.stringify(mobileDiag.errors)}`);

  fixtureState = await controller("state"); assert.equal(fixtureState.qaAdmins, 1); assert.equal(fixtureState.superAdmins, 2); assert.equal(fixtureState.profilesWithoutOwner, 0);
  console.log("ADMIN_BAN_UNBAN_UI_RUNTIME: PASS", JSON.stringify({ customerOwnerDenied:"PASS", superAdminBanClick:"PASS", persistedBanReadModel:"PASS", sessionRevokeObserved:"PASS", superAdminUnbanClick:"PASS", persistedUnbanReadModel:"PASS", superAdminSelfTargetHidden:"PASS", desktop:"PASS", mobile:"PASS", finalCustomerBanned:false }));
  await customerContext.close(); await adminContext.close(); await mobileContext.close();
} finally { await browser.close(); }
