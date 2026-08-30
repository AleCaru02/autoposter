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

function safeRequestLabel(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function diagnostics(page, label) {
  const events = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") events.push(`console:${message.type()}:${message.text()}`);
  });
  page.on("pageerror", (error) => events.push(`pageerror:${error.message}`));
  page.on("requestfailed", (request) => events.push(`requestfailed:${safeRequestLabel(request.url())}:${request.failure()?.errorText || "unknown"}`));
  page.on("response", (response) => {
    const requestLabel = safeRequestLabel(response.url());
    if (requestLabel.includes("/token") || requestLabel.includes("/api/admin/")) events.push(`response:${response.request().method()}:${requestLabel}:${response.status()}`);
  });
  return async (reason) => {
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 1400);
    const html = (await page.content().catch(() => "")).slice(0, 1800);
    const title = await page.title().catch(() => "");
    console.error("FASE3_BROWSER_DIAGNOSTIC", JSON.stringify({ label, reason, url: page.url(), title, body, html, events: events.slice(-50) }));
  };
}

function trackAdminResponses(page) {
  const responses = [];
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin === base && url.pathname.startsWith("/api/admin/")) responses.push({ path: url.pathname, status: response.status() });
    } catch {
      // Ignore non-URL browser events.
    }
  });
  return responses;
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

async function settleProfilelessAdminLanding(page, label) {
  try {
    await page.waitForURL((url) => url.pathname === "/onboarding", { timeout: 20000 });
    await page.getByRole("heading", { name: "Crea il profilo della tua attività", exact: true }).waitFor({ state: "visible", timeout: 15000 });
  } catch (error) {
    throw new Error(`${label} post-login landing did not stabilize on /onboarding: ${error instanceof Error ? error.message : "unknown"}`);
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

async function openAdminFromFreshPage(context, viewportLabel) {
  const loginPage = await context.newPage();
  try {
    await login(loginPage, adminEmail, `SUPER_ADMIN ${viewportLabel}`);
    await settleProfilelessAdminLanding(loginPage, `SUPER_ADMIN ${viewportLabel}`);

    const page = await context.newPage();
    const dump = diagnostics(page, `SUPER_ADMIN ${viewportLabel} /admin fresh-page`);
    const adminResponses = trackAdminResponses(page);
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    return { page, dump, adminResponses };
  } finally {
    await loginPage.close();
  }
}

async function verifyAdminMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const { page, dump, adminResponses } = await openAdminFromFreshPage(context, "mobile");
    try {
      await page.getByRole("heading", { name: "Overview", exact: true }).waitFor({ timeout: 20000 });
      await page.getByRole("link", { name: "Overview", exact: true }).waitFor({ state: "visible", timeout: 10000 });
      await page.getByRole("link", { name: "Clienti", exact: true }).waitFor({ state: "visible", timeout: 10000 });
      await page.getByRole("link", { name: "Attività", exact: true }).waitFor({ state: "visible", timeout: 10000 });

      await page.getByRole("link", { name: "Clienti", exact: true }).click();
      await page.getByRole("heading", { name: "Clienti", exact: true }).waitFor({ timeout: 20000 });
      const firstCustomer = page.locator("a.admin-row-link").first();
      await firstCustomer.waitFor({ state: "visible", timeout: 10000 });
      await firstCustomer.click();
      await page.getByRole("heading", { name: "Account", exact: true }).waitFor({ timeout: 20000 });
      await page.getByRole("heading", { name: "Membership", exact: true }).waitFor({ timeout: 10000 });

      await page.getByRole("link", { name: "Attività", exact: true }).click();
      await page.getByRole("heading", { name: "Attività", exact: true }).waitFor({ timeout: 20000 });
    } catch (error) {
      await dump(error instanceof Error ? error.message : "SUPER_ADMIN mobile Backoffice unavailable");
      throw error;
    }

    const adminBody = await page.locator("body").innerText();
    assert.ok(adminBody.includes("Amministrazione"));
    assert.ok(!adminBody.includes("Dati amministrativi non disponibili."));
    assert.ok(adminResponses.some((item) => item.path === "/api/admin/me" && item.status === 200), "mobile Admin /me did not return 200");
    assert.ok(adminResponses.some((item) => item.path === "/api/admin/overview" && item.status === 200), "mobile Admin overview did not return 200");
    assert.ok(adminResponses.some((item) => item.path === "/api/admin/customers" && item.status === 200), "mobile Admin customers did not return 200");
    assert.ok(adminResponses.some((item) => item.path.startsWith("/api/admin/customers/") && item.status === 200), "mobile Admin customer detail did not return 200");
    assert.ok(adminResponses.some((item) => item.path === "/api/admin/activities" && item.status === 200), "mobile Admin activities did not return 200");
  } finally {
    await context.close();
  }
}

async function verifyAdminDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page, dump, adminResponses } = await openAdminFromFreshPage(context, "desktop");
    try {
      await page.getByText("Backoffice", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
      await page.getByRole("heading", { name: "Overview", exact: true }).waitFor({ timeout: 20000 });
      await page.getByRole("link", { name: "Clienti", exact: true }).waitFor({ state: "visible", timeout: 10000 });
      await page.getByRole("link", { name: "Attività", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    } catch (error) {
      await dump(error instanceof Error ? error.message : "SUPER_ADMIN desktop Backoffice unavailable");
      throw error;
    }
    assert.ok(adminResponses.some((item) => item.path === "/api/admin/me" && item.status === 200), "desktop Admin /me did not return 200");
    assert.ok(adminResponses.some((item) => item.path === "/api/admin/overview" && item.status === 200), "desktop Admin overview did not return 200");
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await verifyCustomer(browser, customerAEmail, "A", "CUSTOMER A / OWNER A");
  await verifyCustomer(browser, customerBEmail, "B", "CUSTOMER B / OWNER B");
  await verifyAdminMobile(browser);
  await verifyAdminDesktop(browser);
  console.log("FASE3_BROWSER_QA: PASS — CUSTOMER A/B workspace OWNER /admin denied; SUPER_ADMIN Admin UI/API chain PASS from fresh authenticated page at 390x844 and 1440x900");
} finally {
  await browser.close();
}
