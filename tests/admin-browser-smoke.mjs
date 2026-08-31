import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.ADMIN_SMOKE_BASE || "https://autoposter.02alessandrocaruso.workers.dev";
const adminEmail = process.env.ADMIN_SMOKE_EMAIL || "";
const adminPassword = process.env.ADMIN_SMOKE_PASSWORD || "";
const customerEmail = process.env.CUSTOMER_SMOKE_EMAIL || "";
const customerPassword = process.env.CUSTOMER_SMOKE_PASSWORD || "";

for (const [label, value] of [
  ["ADMIN_SMOKE_EMAIL", adminEmail],
  ["ADMIN_SMOKE_PASSWORD", adminPassword],
  ["CUSTOMER_SMOKE_EMAIL", customerEmail],
  ["CUSTOMER_SMOKE_PASSWORD", customerPassword],
]) assert.ok(value, `${label} is required`);

function trackAdminFlow(page) {
  const flow = [];
  page.on("response", (response) => {
    try {
      const url = new URL(response.url());
      if (url.hostname.includes(".neonauth.") && url.pathname.endsWith("/token")) {
        flow.push({ kind: "token", path: "/token", method: response.request().method(), status: response.status(), search: "" });
      } else if (url.origin === base && url.pathname.startsWith("/api/admin/")) {
        flow.push({ kind: "admin", path: url.pathname, method: response.request().method(), status: response.status(), search: url.search });
      }
    } catch { /* ignore malformed browser events */ }
  });
  return flow;
}

function assertTokenBefore(flow, path) {
  const apiIndex = flow.findIndex((item) => item.kind === "admin" && item.path === path && item.status === 200);
  assert.ok(apiIndex >= 0, `${path} did not return 200`);
  assert.ok(flow.slice(0, apiIndex).some((item) => item.kind === "token" && item.method === "GET" && item.status === 200), `${path} was not preceded by Managed Auth /token 200`);
}

async function login(page, email, password) {
  const response = await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(response?.status(), 200);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20000 });
}

async function verifyCustomer(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await login(page, customerEmail, customerPassword);
    await page.goto(`${base}/app/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
    const body = await page.locator("body").innerText();
    assert.ok(!body.includes("Backoffice") && !body.includes("Amministrazione"));
    for (const adminPath of ["/admin", "/admin/audit"]) {
      await page.goto(`${base}${adminPath}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL((url) => !url.pathname.startsWith("/admin"), { timeout: 20000 });
      assert.equal(page.url().includes("/app/dashboard"), true, `CUSTOMER ${adminPath} must fail closed to dashboard`);
    }
  } finally { await context.close(); }
}

async function verifyAudit(page, flow) {
  await page.getByRole("link", { name: "Audit", exact: true }).click();
  await page.getByRole("heading", { name: "Audit", exact: true }).waitFor({ timeout: 20000 });
  assertTokenBefore(flow, "/api/admin/audit");
  const actionCode = await page.locator(".admin-audit-mobile .admin-audit-card code, .admin-audit-desktop tbody code").first().textContent();
  assert.ok(actionCode?.trim(), "Audit Viewer did not render real production audit rows");
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/admin/audit?") && response.url().includes("action=") && response.status() === 200, { timeout: 20000 });
  await page.getByLabel("Azione").fill(actionCode.trim());
  await page.getByRole("button", { name: "Applica filtri", exact: true }).click();
  await responsePromise;
  assert.ok(flow.some((item) => item.path === "/api/admin/audit" && item.status === 200 && item.search.includes("action=")), "Audit action filter did not execute");
  await page.getByRole("button", { name: "Azzera", exact: true }).click();
  await page.waitForResponse((response) => response.url().includes("/api/admin/audit?") && !response.url().includes("action=") && response.status() === 200, { timeout: 20000 });
}

async function verifyAdmin(browser, viewport, label, deep) {
  const context = await browser.newContext({ viewport });
  const loginPage = await context.newPage();
  try {
    await login(loginPage, adminEmail, adminPassword);
    const page = await context.newPage();
    const flow = trackAdminFlow(page);
    await page.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Overview", exact: true }).waitFor({ timeout: 20000 });
    assertTokenBefore(flow, "/api/admin/me");
    assertTokenBefore(flow, "/api/admin/overview");
    if (deep) {
      await page.getByRole("link", { name: "Clienti", exact: true }).click();
      await page.getByRole("heading", { name: "Clienti", exact: true }).waitFor({ timeout: 20000 });
      assertTokenBefore(flow, "/api/admin/customers");
      const first = page.locator("a.admin-row-link").first();
      await first.click();
      await page.getByRole("heading", { name: "Account", exact: true }).waitFor({ timeout: 20000 });
      assert.ok(flow.some((item) => item.kind === "admin" && item.path.startsWith("/api/admin/customers/") && item.status === 200));
      await page.getByRole("link", { name: "Attività", exact: true }).click();
      await page.getByRole("heading", { name: "Attività", exact: true }).waitFor({ timeout: 20000 });
      assertTokenBefore(flow, "/api/admin/activities");
      await verifyAudit(page, flow);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      assert.equal(overflow, false, "mobile Admin/Audit must not have document-level horizontal overflow");
    } else {
      await verifyAudit(page, flow);
    }
    console.log("ADMIN_BROWSER_SMOKE", JSON.stringify({ viewport: label, flow }));
  } finally { await context.close(); }
}

const browser = await chromium.launch({ headless: true });
try {
  await verifyCustomer(browser);
  await verifyAdmin(browser, { width: 390, height: 844 }, "390x844", true);
  await verifyAdmin(browser, { width: 1440, height: 900 }, "1440x900", false);
  console.log("ADMIN_BROWSER_SMOKE: PASS");
} finally { await browser.close(); }
