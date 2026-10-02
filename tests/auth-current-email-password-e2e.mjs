import assert from "node:assert/strict";
import { chromium } from "playwright";

const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUTHQA_MARKER || "";
const password = process.env.AUTHQA_PASSWORD || "";
const email = `authqa-${marker}-email@example.com`;

assert.match(marker, /^[0-9]{6,20}$/);
assert.ok(password.length >= 24);

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
      const pair = raw.split(";", 1)[0];
      const i = pair.indexOf("=");
      if (i > 0) this.values.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() { return [...this.values].map(([key, value]) => `${key}=${value}`).join("; "); }
}

async function readJson(response) {
  const raw = await response.text();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function sameOriginAuth(jar, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("origin", APP_BASE);
  headers.set("referer", `${APP_BASE}/`);
  if (init.body) headers.set("content-type", "application/json");
  if (jar.header()) headers.set("cookie", jar.header());
  const response = await fetch(`${APP_BASE}/api/auth${path}`, { ...init, headers, redirect: "manual" });
  jar.absorb(response.headers);
  return response;
}

function jwtSub(token) {
  const part = token.split(".")[1] || "";
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")).sub;
}

const bootstrapJar = new CookieJar();
const signup = await sameOriginAuth(bootstrapJar, "/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email, password, name: "Post Automatici Auth QA" }),
});
assert.equal(signup.ok, true, `signup failed with HTTP ${signup.status}`);

const tokenResponse = await sameOriginAuth(bootstrapJar, "/token", { method: "GET" });
const tokenBody = await readJson(tokenResponse);
const bootstrapToken = tokenBody?.token || tokenBody?.data?.token || "";
assert.ok(tokenResponse.ok && typeof bootstrapToken === "string" && bootstrapToken.length > 40, "signup session token unavailable");
const authUserId = jwtSub(bootstrapToken);
assert.ok(typeof authUserId === "string" && authUserId.length > 10, "auth user id unavailable");

const bootstrapSession = await sameOriginAuth(bootstrapJar, "/get-session?disableCookieCache=true", { method: "GET" });
const bootstrapSessionBody = await readJson(bootstrapSession);
assert.equal(bootstrapSession.ok, true);
assert.equal(bootstrapSessionBody?.user?.id || bootstrapSessionBody?.data?.user?.id, authUserId);

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const diagnostics = [];
  page.on("pageerror", (error) => diagnostics.push(`page:${error.message}`));
  page.on("console", (message) => {
    const value = message.text();
    if (message.type() === "error") diagnostics.push(`console:${value}`);
    assert.equal(value.includes(password), false, "password leaked to browser console");
  });

  await page.goto(`${APP_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Bentornato" }).waitFor({ timeout: 15000 });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 30000 });

  const loginSession = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session?disableCookieCache=true", { credentials: "include" });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  assert.equal(loginSession.status, 200);
  assert.equal(loginSession.body?.user?.id || loginSession.body?.data?.user?.id, authUserId);

  const cookies = await context.cookies(APP_BASE);
  assert.ok(cookies.some((cookie) => cookie.httpOnly && cookie.secure), "same-origin secure HttpOnly auth cookie missing");

  await page.goto(`${APP_BASE}/app/profili`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Le tue attività" }).waitFor({ timeout: 20000 });
  assert.equal(new URL(page.url()).pathname, "/app/profili");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("heading", { name: "Le tue attività" }).waitFor({ timeout: 20000 });
  const refreshSession = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session?disableCookieCache=true", { credentials: "include" });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  assert.equal(refreshSession.status, 200);
  assert.equal(refreshSession.body?.user?.id || refreshSession.body?.data?.user?.id, authUserId);

  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 20000 });

  await page.goto(`${APP_BASE}/app/profili`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 20000 });

  const postLogoutSession = await page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session?disableCookieCache=true", { credentials: "include" });
    return { status: response.status, body: await response.json().catch(() => null) };
  });
  assert.equal(postLogoutSession.status, 200);
  assert.equal(Boolean(postLogoutSession.body?.user || postLogoutSession.body?.data?.user), false, "session survived logout");

  assert.deepEqual(diagnostics, [], `browser diagnostics: ${JSON.stringify(diagnostics)}`);
  await context.close();

  console.log("AUTH_EMAIL_PASSWORD_E2E: PASS", JSON.stringify({
    login: "PASS",
    session: "PASS",
    sameOrigin: "PASS",
    authenticatedRoute: "PASS",
    refreshSession: "PASS",
    logout: "PASS",
    postLogoutDenial: "PASS",
    secretExposure: 0,
  }));
} finally {
  await browser.close();
}
