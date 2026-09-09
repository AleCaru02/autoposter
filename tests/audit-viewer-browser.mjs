import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);

const ownerEmail = `audit-smoke-${marker}-customer@example.invalid`;

function sanitize(value) {
  return String(value || "")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .slice(0, 240);
}

async function login(page) {
  const response = await page.goto(`${base}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(response?.status(), 200, "login document unavailable");
  await page.locator('input[type="email"]').fill(ownerEmail);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 30000 });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
const writes = [];
page.on("pageerror", (error) => errors.push(`pageerror:${sanitize(error.message)}`));
page.on("console", (message) => { if (message.type() === "error") errors.push(`console:${sanitize(message.text())}`); });
page.on("response", (response) => {
  try {
    const url = new URL(response.url());
    if (url.hostname.includes("apirest") && url.pathname.endsWith("/brand_profiles") && ["POST", "PATCH"].includes(response.request().method())) {
      writes.push({ method: response.request().method(), status: response.status() });
    }
  } catch { /* ignore */ }
});

try {
  await login(page);
  await page.goto(`${base}/app/brand`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Identità dell’attività", exact: true }).waitFor({ timeout: 30000 });
  const editable = page.locator("details.editable-details");
  await editable.locator("summary").click();
  assert.equal(await editable.getAttribute("open"), "", "brand edit details did not open");
  assert.ok(await editable.locator("textarea").count() >= 10, "brand edit fields missing");
  const field = (root, label) => root.locator("label").filter({ hasText: label }).locator("textarea");

  const description = `Brand verificato nel browser ${marker}`;
  const services = `Consulenza strategica ${marker}\nGestione contenuti`;
  await field(editable, "Descrizione").fill(description);
  await field(editable, "Servizi").fill(services);
  await field(editable, "Segmenti del pubblico").fill("Retail\nProfessionisti");
  await field(editable, "Caratteristiche del tono").fill("Chiaro\nAffidabile");
  await page.getByRole("button", { name: "Salva modifiche", exact: true }).click();
  await page.getByText("Modifiche salvate", { exact: true }).waitFor({ timeout: 20000 });
  assert.ok(writes.some((item) => item.status >= 200 && item.status < 300), "brand persistence write not observed");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Identità dell’attività", exact: true }).waitFor({ timeout: 30000 });
  const reloadedEditable = page.locator("details.editable-details");
  await reloadedEditable.locator("summary").click();
  assert.equal(await reloadedEditable.getAttribute("open"), "", "reloaded brand edit details did not open");
  assert.equal(await field(reloadedEditable, "Descrizione").inputValue(), description);
  assert.equal(await field(reloadedEditable, "Servizi").inputValue(), services);
  assert.equal(await field(reloadedEditable, "Segmenti del pubblico").inputValue(), "Retail\nProfessionisti");
  assert.equal(await field(reloadedEditable, "Caratteristiche del tono").inputValue(), "Chiaro\nAffidabile");

  const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth }));
  assert.ok(layout.scrollWidth <= layout.viewportWidth + 2, `mobile overflow ${layout.scrollWidth} > ${layout.viewportWidth}`);
  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors)}`);

  console.log("FASE7A_BROWSER_RUNTIME: PASS", JSON.stringify({
    authenticatedDashboard: "PASS",
    brandEdit: "PASS",
    persistenceReload: "PASS",
    mobileViewport: "PASS",
  }));
} finally {
  await context.close();
  await browser.close();
}
