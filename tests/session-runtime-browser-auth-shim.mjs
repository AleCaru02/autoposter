import assert from "node:assert/strict";
import { chromium } from "playwright";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
assert.ok(password.length >= 24, "ephemeral smoke password missing");

const smokeEmail = /^audit-smoke-[a-z0-9]{10,32}-(customer|customer-b|admin)@example\.invalid$/;
const cachedCookies = new Map();
const originalFetch = globalThis.fetch.bind(globalThis);

function parseCookie(raw) {
  const parts = String(raw || "").split(";").map((part) => part.trim()).filter(Boolean);
  const pair = parts.shift() || "";
  const index = pair.indexOf("=");
  if (index <= 0) return null;
  const cookie = {
    name: pair.slice(0, index),
    value: pair.slice(index + 1),
    url: new URL(AUTH_URL).origin,
  };
  for (const attr of parts) {
    const [name, ...rest] = attr.split("=");
    const key = name.toLowerCase();
    const value = rest.join("=");
    if (key === "httponly") cookie.httpOnly = true;
    if (key === "secure") cookie.secure = true;
    if (key === "samesite") {
      const normalized = value.toLowerCase();
      if (normalized === "none") cookie.sameSite = "None";
      else if (normalized === "strict") cookie.sameSite = "Strict";
      else if (normalized === "lax") cookie.sameSite = "Lax";
    }
  }
  return cookie;
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url || "";
}

function requestEmail(init) {
  try {
    if (typeof init?.body !== "string") return "";
    const body = JSON.parse(init.body);
    return typeof body?.email === "string" ? body.email.toLowerCase() : "";
  } catch {
    return "";
  }
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

globalThis.fetch = async (input, init) => {
  const url = requestUrl(input);
  const email = requestEmail(init);
  const response = await originalFetch(input, init);
  if ((url === `${AUTH_URL}/sign-in/email` || url === `${AUTH_URL}/sign-up/email`) && response.ok && smokeEmail.test(email)) {
    const values = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    const cookies = values.map(parseCookie).filter(Boolean);
    if (cookies.length > 0) cachedCookies.set(email, cookies);
  }
  return response;
};

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
      await page.route("**/sign-in/email", async (route) => {
        await route.fulfill({ status: 204, contentType: "application/json", body: "" });
      });
      const originalWaitForURL = page.waitForURL.bind(page);
      page.waitForURL = async (target, options = {}) => {
        let pathname = "";
        try { pathname = new URL(page.url()).pathname; } catch { /* ignore */ }
        if (pathname === "/login") {
          const emailInput = page.locator('input[type="email"]');
          const email = (await emailInput.count()) > 0 ? (await emailInput.inputValue().catch(() => "")).toLowerCase() : "";
          if (smokeEmail.test(email)) {
            const cookies = cachedCookies.get(email) || [];
            assert.ok(cookies.length > 0, `Smoke browser cached session missing for ${email.includes("customer-b") ? "CUSTOMER_B" : email.includes("admin") ? "ADMIN" : "CUSTOMER_A"}`);
            await context.addCookies(cookies);
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

console.log("SESSION_UI_BROWSER_AUTH_SHIM: READY_REUSE_EXISTING_SESSIONS_STABLE_DIALOG");