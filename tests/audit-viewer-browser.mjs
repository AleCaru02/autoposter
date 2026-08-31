import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);

const customerEmail = `audit-smoke-${marker}-customer@example.invalid`;
const adminEmail = `audit-smoke-${marker}-admin@example.invalid`;

function sanitizeDiagnostic(value) {
  return String(value || "")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|cookie|password|session[-_ ]?token|access[-_ ]?token|refresh[-_ ]?token|api[-_ ]?key|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 280);
}

function diagnostics(page) {
  const critical = [];
  const adminResponses = [];
  page.on("pageerror", (error) => critical.push(`pageerror:${sanitizeDiagnostic(error.name)}:${sanitizeDiagnostic(error.message)}`));
  page.on("console", (message) => {
    if (message.type() === "error") critical.push(`console:error:${sanitizeDiagnostic(message.text())}`);
  });
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.origin === base && url.pathname.startsWith("/api/admin/")) {
        adminResponses.push({ path: url.pathname, status: response.status() });
      }
    } catch { /* ignore */ }
  });
  return { critical, adminResponses };
}

function isExpectedForbiddenResourceConsole(entry) {
  return /^console:error:Failed to load resource: the server responded with a status of 403(?:\s|\(|$)/.test(entry);
}

async function login(page, email) {
  const response = await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(response?.status(), 200, "login document unavailable");
  await page.locator('input[type="email"]').waitFor({ state: "visible", timeout: 15000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20000 });
}

async function verifyCustomerOwner(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const diag = diagnostics(page);
  try {
    await login(page, customerEmail);
    await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
    await page.getByText("Sessione attiva", { exact: true }).waitFor({ state: "visible", timeout: 20000 });

    await page.goto(`${base}/app/profili`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Le tue attività", exact: true }).waitFor({ timeout: 20000 });
    const profilesBody = await page.locator("body").innerText();
    assert.ok(profilesBody.includes(`Audit Smoke ${marker}`), "OWNER cannot see own profile");
    assert.deepEqual(diag.critical, [], `CUSTOMER/OWNER pre-denial critical browser errors: ${JSON.stringify(diag.critical)}`);

    await page.goto(`${base}/admin/audit`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
    const body = await page.locator("body").innerText();
    assert.ok(!body.includes("Backoffice"), "CUSTOMER/OWNER received Backoffice content");
    assert.ok(!body.includes("Registro delle operazioni amministrative autorizzate"), "CUSTOMER/OWNER received Audit content");
    assert.ok(diag.adminResponses.some((item) => item.path === "/api/admin/me" && item.status === 403), "CUSTOMER/OWNER browser did not receive /api/admin/me 403");
    const unexpectedDenialErrors = diag.critical.filter((entry) => !isExpectedForbiddenResourceConsole(entry));
    assert.deepEqual(unexpectedDenialErrors, [], `CUSTOMER/OWNER unexpected denial errors: ${JSON.stringify(unexpectedDenialErrors)}`);
    return { customerRoute: "PASS", ownerRoute: "PASS" };
  } finally {
    await context.close();
  }
}

async function openAdminAudit(context, label) {
  const loginPage = await context.newPage();
  await login(loginPage, adminEmail);
  await loginPage.waitForURL((url) => url.pathname === "/onboarding", { timeout: 20000 });
  const page = await context.newPage();
  const diag = diagnostics(page);
  await page.goto(`${base}/admin/audit`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Audit", exact: true }).waitFor({ timeout: 20000 });
  await loginPage.close();
  assert.ok(diag.adminResponses.some((item) => item.path === "/api/admin/me" && item.status === 200), `${label} /api/admin/me did not return 200`);
  return { page, diag };
}

async function verifyDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const { page, diag } = await openAdminAudit(context, "desktop");
    await page.getByRole("link", { name: "Audit", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".admin-audit-desktop tbody tr").first().waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("navigation", { name: "Paginazione audit", exact: true }).waitFor({ state: "visible", timeout: 10000 });

    const actionInput = page.getByRole("combobox", { name: "Azione", exact: true });
    await actionInput.fill("ADMIN_ACCESS");
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/admin/audit?") && response.status() === 200, { timeout: 20000 }),
      page.getByRole("button", { name: "Applica filtri", exact: true }).click(),
    ]);
    await page.locator(".admin-audit-desktop tbody tr").first().waitFor({ state: "visible", timeout: 20000 });
    const codes = await page.locator(".admin-audit-desktop tbody tr td:nth-child(2) code").allTextContents();
    assert.ok(codes.length > 0 && codes.every((value) => value === "ADMIN_ACCESS"), "desktop action filter mixed results");

    await page.getByRole("textbox", { name: "Actor", exact: true }).fill(`audit-smoke-no-match-${marker}`);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/admin/audit?") && response.status() === 200, { timeout: 20000 }),
      page.getByRole("button", { name: "Applica filtri", exact: true }).click(),
    ]);
    await page.getByText("Nessun evento trovato.", { exact: true }).waitFor({ state: "visible", timeout: 20000 });

    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/admin/audit?") && response.status() === 200, { timeout: 20000 }),
      page.getByRole("button", { name: "Azzera", exact: true }).click(),
    ]);
    await page.locator(".admin-audit-desktop tbody tr").first().waitFor({ state: "visible", timeout: 20000 });
    const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
    assert.ok(layout.scrollWidth <= layout.viewportWidth + 2, `desktop overflow ${layout.scrollWidth} > ${layout.viewportWidth}`);
    assert.ok(diag.adminResponses.some((item) => item.path === "/api/admin/audit" && item.status === 200), "desktop Audit API not observed");
    assert.deepEqual(diag.critical, [], `desktop critical browser errors: ${JSON.stringify(diag.critical)}`);
    return "PASS";
  } finally {
    await context.close();
  }
}

async function verifyMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const { page, diag } = await openAdminAudit(context, "mobile");
    await page.getByRole("link", { name: "Audit", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    const firstCard = page.locator(".admin-audit-mobile .admin-audit-card").first();
    await firstCard.waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("navigation", { name: "Paginazione audit", exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByRole("combobox", { name: "Azione", exact: true }).fill("ADMIN_ACCESS");
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/admin/audit?") && response.status() === 200, { timeout: 20000 }),
      page.getByRole("button", { name: "Applica filtri", exact: true }).click(),
    ]);
    await page.locator(".admin-audit-mobile .admin-audit-card").first().waitFor({ state: "visible", timeout: 20000 });
    const codes = await page.locator(".admin-audit-mobile .admin-audit-card code").allTextContents();
    assert.ok(codes.length > 0 && codes.every((value) => value === "ADMIN_ACCESS"), "mobile action filter mixed results");
    const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
    assert.ok(layout.scrollWidth <= layout.viewportWidth + 2, `mobile overflow ${layout.scrollWidth} > ${layout.viewportWidth}`);
    assert.ok(diag.adminResponses.some((item) => item.path === "/api/admin/audit" && item.status === 200), "mobile Audit API not observed");
    assert.deepEqual(diag.critical, [], `mobile critical browser errors: ${JSON.stringify(diag.critical)}`);
    return "PASS";
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const customer = await verifyCustomerOwner(browser);
  const desktop = await verifyDesktop(browser);
  const mobile = await verifyMobile(browser);
  console.log("AUDIT_VIEWER_BROWSER_RUNTIME: PASS", JSON.stringify({ ...customer, desktop, mobile }));
} finally {
  await browser.close();
}

await import("./session-runtime-browser-auth-shim.mjs");
await import("./session-management-ui-runtime.mjs");