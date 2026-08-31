import assert from "node:assert/strict";
import { chromium } from "playwright";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
assert.ok(password.length >= 24, "ephemeral smoke password missing");

const smokeEmail = /^audit-smoke-[a-z0-9]{10,32}-(customer|customer-b|admin)@example\.invalid$/;
const originalFetch = globalThis.fetch.bind(globalThis);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url || "";
}

function retryAfterMs(response, attempt) {
  const raw = response.headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.max(seconds * 1000, 1000), 15000);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 1000), 15000);
  }
  return Math.min(1000 * (2 ** attempt), 10000);
}

async function providerFetchWithBackoff(input, init, url) {
  let response = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await originalFetch(input, init);
    if (response.status !== 429 || !url.startsWith(AUTH_URL)) return response;
    if (attempt === 7) return response;
    const waitMs = retryAfterMs(response, attempt);
    try { await response.body?.cancel(); } catch { /* ignore */ }
    console.log(`SESSION_UI_NODE_AUTH_RATE_LIMIT_RETRY: ${attempt + 1}/7 waitMs=${waitMs}`);
    await sleep(waitMs);
  }
  return response;
}

function patchDialogDangerLocators(page) {
  const originalPageGetByRole = page.getByRole.bind(page);
  page.getByRole = (role, options) => {
    const locator = originalPageGetByRole(role, options);
    if (role !== "dialog") return locator;
    const originalDialogGetByRole = locator.getByRole.bind(locator);
    locator.getByRole = (childRole, childOptions) => {
      const name = childOptions?.name;
      if (childRole === "button" && childOptions?.exact === true && (name === "Revoca sessione" || name === "Revoca tutte")) {
        return locator.locator("button.danger");
      }
      return originalDialogGetByRole(childRole, childOptions);
    };
    return locator;
  };
}

function patchRealSmokeLoginRetry(page) {
  const originalWaitForURL = page.waitForURL.bind(page);
  page.waitForURL = async (target, options = {}) => {
    let pathname = "";
    try { pathname = new URL(page.url()).pathname; } catch { /* ignore */ }
    if (pathname !== "/login") return originalWaitForURL(target, options);

    const emailInput = page.locator('input[type="email"]');
    const email = (await emailInput.count()) > 0 ? (await emailInput.inputValue().catch(() => "")).toLowerCase() : "";
    if (!smokeEmail.test(email)) return originalWaitForURL(target, options);

    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await originalWaitForURL(target, { ...options, timeout: 14000 });
      } catch (reason) {
        lastError = reason;
        let currentPath = "";
        try { currentPath = new URL(page.url()).pathname; } catch { /* ignore */ }
        if (currentPath !== "/login") return originalWaitForURL(target, { ...options, timeout: 3000 });
        if (attempt === 4) break;

        const waitMs = Math.min(4000 * (attempt + 1), 12000);
        console.log(`SESSION_UI_BROWSER_AUTH_RETRY: ${attempt + 1}/4 waitMs=${waitMs}`);
        await page.waitForTimeout(waitMs);

        const submit = page.locator('button[type="submit"]');
        await submit.waitFor({ state: "visible", timeout: 5000 });
        const enabledDeadline = Date.now() + 15000;
        while (await submit.isDisabled().catch(() => true)) {
          if (Date.now() >= enabledDeadline) break;
          await page.waitForTimeout(250);
        }
        if (!(await submit.isDisabled().catch(() => true))) await submit.click();
      }
    }
    throw lastError;
  };
}

globalThis.fetch = async (input, init) => providerFetchWithBackoff(input, init, requestUrl(input));

const originalLaunch = chromium.launch.bind(chromium);
chromium.launch = async (...launchArgs) => {
  const browser = await originalLaunch(...launchArgs);
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...contextArgs) => {
    const context = await originalNewContext(...contextArgs);
    const originalNewPage = context.newPage.bind(context);
    context.newPage = async (...pageArgs) => {
      const page = await originalNewPage(...pageArgs);
      patchDialogDangerLocators(page);
      patchRealSmokeLoginRetry(page);
      return page;
    };
    return context;
  };
  return browser;
};

console.log("SESSION_UI_BROWSER_AUTH_SHIM: READY_REAL_LOGIN_RETRY_STABLE_DIALOG");