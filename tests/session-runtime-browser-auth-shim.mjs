import assert from "node:assert/strict";
import { chromium } from "playwright";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
assert.ok(password.length >= 24, "ephemeral smoke password missing");

const originalLaunch = chromium.launch.bind(chromium);
chromium.launch = async (...launchArgs) => {
  const browser = await originalLaunch(...launchArgs);
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...contextArgs) => {
    const context = await originalNewContext(...contextArgs);
    const originalNewPage = context.newPage.bind(context);
    context.newPage = async (...pageArgs) => {
      const page = await originalNewPage(...pageArgs);
      const originalWaitForURL = page.waitForURL.bind(page);
      page.waitForURL = async (target, options = {}) => {
        let pathname = "";
        try { pathname = new URL(page.url()).pathname; } catch { /* ignore */ }
        if (pathname === "/login") {
          const emailInput = page.locator('input[type="email"]');
          const email = (await emailInput.count()) > 0 ? await emailInput.inputValue().catch(() => "") : "";
          if (email.includes("-customer-b@example.invalid")) {
            const status = await page.evaluate(async ({ authUrl, emailValue, passwordValue }) => {
              const response = await fetch(`${authUrl}/sign-in/email`, {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email: emailValue, password: passwordValue }),
              });
              return response.status;
            }, { authUrl: AUTH_URL, emailValue: email, passwordValue: password });
            assert.ok(status >= 200 && status < 300, `CUSTOMER_B browser Managed Auth signin failed (${status})`);
            await page.goto(`${APP_BASE}/app/dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
          }
        }
        return originalWaitForURL(target, options);
      };
      return page;
    };
    return context;
  };
  return browser;
};

console.log("SESSION_UI_BROWSER_AUTH_SHIM: READY");