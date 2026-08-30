import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.FASE3_QA_MARKER || "";
const password = process.env.FASE3_QA_PASSWORD || "";
assert.match(marker, /^[a-z0-9]{8,40}$/);
assert.ok(password.length >= 16);

const customerEmail = `fase3-qa-${marker}-customer-a@example.invalid`;
const adminEmail = `fase3-qa-${marker}-admin@example.invalid`;

async function login(page, email) {
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => window.location.pathname !== "/login", null, { timeout: 20000 });
}

const browser = await chromium.launch({ headless: true });
try {
  const customerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const customerPage = await customerContext.newPage();
  await login(customerPage, customerEmail);
  await customerPage.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await customerPage.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });
  const customerBody = await customerPage.locator("body").innerText();
  assert.ok(!customerBody.includes("Backoffice"), "CUSTOMER received Backoffice content");
  assert.ok(!customerBody.includes("Amministrazione"), "CUSTOMER received admin page content");
  await customerContext.close();

  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const adminPage = await adminContext.newPage();
  await login(adminPage, adminEmail);
  await adminPage.goto(`${base}/admin`, { waitUntil: "domcontentloaded" });
  await adminPage.getByText("Backoffice", { exact: true }).waitFor({ timeout: 20000 });
  await adminPage.getByRole("heading", { name: "Overview", exact: true }).waitFor({ timeout: 20000 });
  const adminBody = await adminPage.locator("body").innerText();
  assert.ok(adminBody.includes("Amministrazione"));
  assert.ok(adminBody.includes("Utenti"));
  assert.ok(adminBody.includes("Attività"));
  await adminContext.close();

  console.log("FASE3_BROWSER_QA: PASS — CUSTOMER /admin denied, SUPER_ADMIN /admin allowed at 390x844");
} finally {
  await browser.close();
}
