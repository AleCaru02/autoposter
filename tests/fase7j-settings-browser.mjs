import assert from "node:assert/strict";
import { chromium } from "playwright";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.SETTINGS7J_MARKER || "";
const password = process.env.SETTINGS7J_PASSWORD || "";
const controllerUrl = process.env.SETTINGS7J_CONTROLLER_URL || "";
const controllerToken = process.env.SETTINGS7J_TOKEN_VALUE || "";
assert.match(marker, /^[a-z0-9]{10,32}$/); assert.ok(password.length >= 24 && controllerToken.length >= 32);
const emails = { owner: `settings7j-${marker}-owner@example.invalid`, other: `settings7j-${marker}-other@example.invalid` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar { constructor() { this.values = new Map(); } absorb(headers) { for (const raw of headers.getSetCookie?.() || []) { const pair = raw.split(";", 1)[0]; const i = pair.indexOf("="); if (i > 0) this.values.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); } } header() { return [...this.values].map(([key, value]) => `${key}=${value}`).join("; "); } }
async function readJson(response) { const raw = await response.text(); if (!raw) return null; try { return JSON.parse(raw); } catch { return { invalidJson: true }; } }
async function authFetch(jar, path, init = {}) { const headers = new Headers(init.headers); headers.set("accept", "application/json"); headers.set("origin", APP_BASE); headers.set("referer", `${APP_BASE}/`); if (init.body) headers.set("content-type", "application/json"); if (jar.header()) headers.set("cookie", jar.header()); const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" }); jar.absorb(response.headers); return response; }
function tokenSub(token) { const raw = token.split(".")[1]; return JSON.parse(Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "="), "base64").toString("utf8")).sub; }
async function tokenFor(jar) { const response = await authFetch(jar, "/token"); const body = await readJson(response); const token = body?.token || body?.data?.token || ""; assert.ok(response.ok && token.length > 40); return token; }
async function signup(email, name) { const jar = new CookieJar(); const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) }); assert.ok(response.ok, `signup failed ${response.status}`); const token = await tokenFor(jar); return { token, id: tokenSub(token) }; }
async function dataApi(path, token, init = {}) { const headers = new Headers(init.headers); headers.set("accept", "application/json"); headers.set("authorization", `Bearer ${token}`); if (init.body) headers.set("content-type", "application/json"); return fetch(`${DATA_API}${path}`, { ...init, headers }); }
async function waitIdentity(identity) { for (let i = 0; i < 20; i += 1) { const response = await dataApi("/rpc/current_auth_user_id", identity.token, { method: "POST", body: "{}" }); const body = await readJson(response); const actual = typeof body === "string" ? body : Array.isArray(body) ? body[0]?.current_auth_user_id : body?.current_auth_user_id; if (response.ok && actual === identity.id) return; await sleep(500); } throw new Error("fresh identity unavailable"); }
async function createProfile(identity, label) { const response = await dataApi("/profiles?select=id,name", identity.token, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ name: `Settings 7J ${label} ${marker}`, slug: `settings7j-${marker}-${label}`, owner_auth_user_id: identity.id, onboarding_completed: true }) }); const body = await readJson(response); assert.ok(response.ok, `profile creation failed ${response.status}`); return body[0].id; }
async function controller(action, extra = {}) { const response = await fetch(controllerUrl, { method: "POST", headers: { "content-type": "application/json", "x-settings7j-token": controllerToken }, body: JSON.stringify({ action, marker, ...extra }) }); const body = await readJson(response); assert.equal(response.status, 200, `controller ${action} failed: ${JSON.stringify(body)}`); return body; }
async function login(page) { await page.goto(`${APP_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 }); await page.locator('input[type="email"]').fill(emails.owner); await page.locator('input[type="password"]').fill(password); await page.locator('button[type="submit"]').click(); await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20000 }); }
function diagnostics(page) { const failures = []; page.on("pageerror", (error) => failures.push(`page:${error.message}`)); page.on("response", (response) => { if (response.status() >= 500) failures.push(`http:${response.status()}:${new URL(response.url()).pathname}`); }); return failures; }

const preflight = await controller("preflight"); assert.equal(preflight.recognizedQaUsers, 0); assert.equal(preflight.qaProfiles, 0); assert.equal(preflight.qaUsage, 0);
const owner = await signup(emails.owner, "Settings 7J Owner"); const other = await signup(emails.other, "Settings 7J Other"); await waitIdentity(owner); await waitIdentity(other);
const profileId = await createProfile(owner, "owner"); const otherProfileId = await createProfile(other, "other"); await controller("fixture", { profileId });
const crossTenant = await dataApi(`/profiles?id=eq.${otherProfileId}&select=id`, owner.token); assert.equal(crossTenant.status, 200); assert.deepEqual(await readJson(crossTenant), [], "tenant A read tenant B profile");
const usageRead = await dataApi(`/capability_usage_buckets?profile_id=eq.${profileId}&capability_key=eq.ai.content.generate_text&select=committed_quantity,reserved_quantity,period_start,period_end`, owner.token); const usageRows = await readJson(usageRead); assert.equal(usageRead.status, 200); assert.equal(usageRows.length, 1, `owner usage bucket unavailable: ${JSON.stringify(usageRows)}`); assert.equal(Number(usageRows[0].committed_quantity) + Number(usageRows[0].reserved_quantity), 18);

const browser = await chromium.launch({ headless: true });
try {
  const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const desktop = await desktopContext.newPage(); const desktopFailures = diagnostics(desktop); await login(desktop); await desktop.goto(`${APP_BASE}/app/impostazioni`, { waitUntil: "networkidle", timeout: 30000 });
  await desktop.getByRole("heading", { name: "Piano e utilizzo" }).waitFor();
  const desktopText = await desktop.locator("main").innerText();
  const planPanelText = await desktop.getByRole("heading", { name: "Piano e utilizzo" }).locator("xpath=../../..").innerText(); console.log("FASE7J_PLAN_PANEL:", JSON.stringify(planPanelText));
  for (const expected of ["Piano personale", "Creazione contenuti con AI", "Autopilot", "Instagram", "Facebook", "LinkedIn", "Google Business Profile", "Cancellazione account"]) assert.ok(desktopText.includes(expected), `desktop missing ${expected}`);
  assert.match(planPanelText, /18\s+di\s+50\s+utilizzati\s+questo\s+mese/, "customer usage did not render the real current bucket");
  for (const forbidden of ["ai.content.generate_text", "capability_key", "token_reference", "RLS", "database internals"]) assert.equal(desktopText.includes(forbidden), false, `desktop leaked ${forbidden}`);
  const accountForm = desktop.getByRole("heading", { name: "Account", exact: true }).locator("xpath=../../.."); await accountForm.getByLabel("Nome").fill("Settings 7J Updated"); await accountForm.getByRole("button", { name: "Salva dati account" }).click(); await desktop.getByText("Dati account aggiornati.").waitFor();
  await desktop.goto(`${APP_BASE}/app/profili`, { waitUntil: "networkidle" }); await desktop.getByText("La cancellazione definitiva non è ancora disponibile").waitFor(); assert.equal(await desktop.locator('button[aria-label^="Elimina"]').count(), 0);
  await desktop.getByRole("button", { name: "Esci" }).click(); await desktop.waitForURL((url) => url.pathname === "/login"); assert.deepEqual(desktopFailures, [], `desktop failures: ${JSON.stringify(desktopFailures)}`); await desktopContext.close();

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const mobile = await mobileContext.newPage(); const mobileFailures = diagnostics(mobile); await login(mobile); await mobile.goto(`${APP_BASE}/app/impostazioni`, { waitUntil: "networkidle", timeout: 30000 }); await mobile.getByRole("heading", { name: "Piano e utilizzo" }).waitFor();
  const size = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth })); assert.ok(size.scrollWidth <= size.viewportWidth + 2, `mobile overflow ${size.scrollWidth} > ${size.viewportWidth}`);
  await mobile.getByRole("button", { name: "Apri altre sezioni" }).click(); await mobile.getByRole("button", { name: "Esci" }).click(); await mobile.waitForURL((url) => url.pathname === "/login"); assert.deepEqual(mobileFailures, [], `mobile failures: ${JSON.stringify(mobileFailures)}`); await mobileContext.close();

  const anonymous = await browser.newPage(); await anonymous.goto(`${APP_BASE}/app/impostazioni`, { waitUntil: "domcontentloaded" }); await anonymous.waitForURL((url) => url.pathname === "/login"); await anonymous.close();
  console.log("FASE7J_SETTINGS_RUNTIME: PASS", JSON.stringify({ authenticated: "PASS", desktop: "PASS", mobile: "PASS", logout: "PASS", unauthenticated: "DENIED", tenantIsolation: "PASS", planUsage: "PASS", socialStates: "PASS", deletionSafety: "PASS", sensitiveFindings: 0, profileId }));
} finally { await browser.close(); }
