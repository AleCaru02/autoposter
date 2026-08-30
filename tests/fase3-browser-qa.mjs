import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.FASE3_QA_MARKER || "";
const password = process.env.FASE3_QA_PASSWORD || "";
assert.match(marker, /^[a-z0-9]{8,40}$/);
assert.ok(password.length >= 16);

const customerAEmail = `fase3-qa-${marker}-customer-a@example.invalid`;
const customerBEmail = `fase3-qa-${marker}-customer-b@example.invalid`;
const adminEmail = `fase3-qa-${marker}-admin@example.invalid`;

function diagnostics(page, label) {
  const events = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") events.push(`console:${message.type()}:${message.text()}`);
  });
  page.on("pageerror", (error) => events.push(`pageerror:${error.message}`));
  page.on("requestfailed", (request) => events.push(`requestfailed:${request.url()}:${request.failure()?.errorText || "unknown"}`));
  return async (reason) => {
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
    const html = (await page.content().catch(() => "")).slice(0, 1600);
    const title = await page.title().catch(() => "");
    console.error("FASE3_BROWSER_DIAGNOSTIC", JSON.stringify({ label, reason, url: page.url(), title, body, html, events: events.slice(-30) }));
  };
}

async function login(page, email, label) {
  const dump = diagnostics(page, label);
  const response = await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.ok(response, `${label} /login produced no navigation response`);
  assert.equal(response.status(), 200, `${label} /login HTTP ${response.status()}`);
  const emailInput = page.locator('input[type="email"]');
  try {
    await emailInput.waitFor({ state: "visible", timeout: 15000 });
  } catch (error) {
    await dump(error instanceof Error ? error.message : "email input unavailable");
    throw error;
  }
  await emailInput.fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  try {
    await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20000 });
  } catch (error) {
    await dump(error instanceof Error ? error.message : "login did not navigate");
    throw error;
  }
}

async function verifyCustomer(browser, email, suffix, label) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await login(page, email, label);
    await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
    await page.getByText("Sessione attiva", { exact: true }).waitFor({ timeout: 20000 });
    const dashboardBody = await page.locator("body").innerText();
    assert.ok(dashboardBody.includes(`FASE3 QA ${suffix} ${marker}`), `${label} cannot see own profile on dashboard`);
    assert.ok(dashboardBody.includes("RLS applicato"), `${label} dashboard missing tenant isolation status`);

    await page.goto(`${base}/app/profili`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Le tue attività", exact: true }).waitFor({ timeout: 20000 });
    const profilesBody = await page.locator("body").innerText();
    assert.ok(profilesBody.includes(`FASE3 QA ${suffix} ${marker}`), `${label} own profile missing from profile flow`);
    const otherSuffix = suffix === "A" ? "B" : "A";
    assert.ok(!profilesBody.includes(`FASE3 QA ${otherSuffix} ${marker}`), `${label} saw cross-tenant QA profile`);

    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
    const customerBody = await page.locator("body").innerText();
    assert.ok(!customerBody.includes("Backoffice"), `${label} received Backoffice content`);
    assert.ok(!customerBody.includes("Amministrazione"), `${label} received admin page content`);
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await verifyCustomer(browser, customerAEmail, "A", "CUSTOMER A / OWNER A");
  await verifyCustomer(browser, customerBEmail, "B", "CUSTOMER B / OWNER B");

  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const adminPage = await adminContext.newPage();
  try {
    await login(adminPage, adminEmail, "SUPER_ADMIN");
    await adminPage.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await adminPage.getByText("Backoffice", { exact: true }).waitFor({ timeout: 20000 });
    await adminPage.getByRole("heading", { name: "Overview", exact: true }).waitFor({ timeout: 20000 });
    const adminBody = await adminPage.locator("body").innerText();
    assert.ok(adminBody.includes("Amministrazione"));
    assert.ok(adminBody.includes("Utenti"));
    assert.ok(adminBody.includes("Attività"));
  } finally {
    await adminContext.close();
  }

  console.log("FASE3_BROWSER_QA: PASS — CUSTOMER A/B workspace OWNER /admin denied, own-profile flow isolated, SUPER_ADMIN /admin allowed at 390x844");
} finally {
  await browser.close();
}
