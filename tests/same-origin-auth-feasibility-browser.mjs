import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.AUTH_FEASIBILITY_BASE || "";
const marker = process.env.AUTH_FEASIBILITY_MARKER || "";
const password = process.env.AUTH_FEASIBILITY_PASSWORD || "";
assert.match(base, /^https:\/\/[a-z0-9-]+-autoposter\.02alessandrocaruso\.workers\.dev$/);
assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);

const email = `audit-smoke-${marker}-customer@example.invalid`;
const name = `Auth Feasibility ${marker}`;

function sessionInfo(body) {
  const root = body?.data && typeof body.data === "object" ? body.data : body;
  return { active: Boolean(root?.session && root?.user?.id) };
}

function cookieAttributes(raw) {
  const parts = String(raw).split(";").map((part) => part.trim()).filter(Boolean);
  const first = parts.shift() || "";
  const eq = first.indexOf("=");
  const name = eq > 0 ? first.slice(0, eq) : "";
  const attrs = new Map();
  for (const part of parts) {
    const index = part.indexOf("=");
    const key = (index >= 0 ? part.slice(0, index) : part).trim().toLowerCase();
    const value = index >= 0 ? part.slice(index + 1).trim() : true;
    attrs.set(key, value);
  }
  return {
    name,
    httpOnly: attrs.has("httponly"),
    secure: attrs.has("secure"),
    sameSite: typeof attrs.get("samesite") === "string" ? String(attrs.get("samesite")) : null,
    path: typeof attrs.get("path") === "string" ? String(attrs.get("path")) : null,
    domainPresent: attrs.has("domain"),
    domain: typeof attrs.get("domain") === "string" ? String(attrs.get("domain")) : null,
  };
}

async function pageJson(page, path, init = {}) {
  return page.evaluate(async ({ path, init }) => {
    const response = await fetch(path, { ...init, credentials: "include" });
    let body = null;
    try { body = await response.json(); } catch { /* non-JSON */ }
    return { status: response.status, ok: response.ok, body };
  }, { path, init });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
try {
  const loaded = await page.goto(`${base}/__qa/auth-feasibility`, { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(loaded?.status(), 200);

  const signUpResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/sign-up/email", { timeout: 30000 });
  const signUp = await pageJson(page, "/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, password, name }),
  });
  const signUpNetwork = await signUpResponsePromise;
  assert.ok(signUp.ok, `proxied sign-up failed (${signUp.status})`);

  const headerArray = await signUpNetwork.headersArray();
  const setCookieSummaries = headerArray.filter((header) => header.name.toLowerCase() === "set-cookie").map((header) => cookieAttributes(header.value));
  assert.ok(setCookieSummaries.length >= 1, "proxied sign-up did not return Set-Cookie");
  assert.ok(setCookieSummaries.every((cookie) => cookie.name && cookie.httpOnly && cookie.secure), "credential cookie missing HttpOnly/Secure");
  assert.ok(setCookieSummaries.every((cookie) => !cookie.domainPresent || !cookie.domain?.includes("neonauth")), "cookie remains bound to Neon auth domain");

  const stored = await context.cookies(base);
  const setNames = new Set(setCookieSummaries.map((cookie) => cookie.name));
  const storedRelevant = stored.filter((cookie) => setNames.has(cookie.name));
  assert.ok(storedRelevant.length >= 1, "browser did not store proxied auth cookie");
  assert.ok(storedRelevant.every((cookie) => cookie.httpOnly && cookie.secure), "stored auth cookie security attributes changed");
  assert.ok(storedRelevant.every((cookie) => !cookie.domain.includes("neonauth")), "browser stored cookie for Neon host instead of proxy host");

  let cookieReturned = false;
  page.on("request", async (request) => {
    try {
      if (new URL(request.url()).pathname !== "/api/auth/get-session") return;
      const headers = await request.allHeaders();
      if (typeof headers.cookie === "string" && headers.cookie.length > 0) cookieReturned = true;
    } catch { /* ignore */ }
  });

  const session = await pageJson(page, "/api/auth/get-session", { headers: { accept: "application/json" } });
  assert.equal(session.status, 200, "same-origin get-session failed");
  assert.equal(sessionInfo(session.body).active, true, "same-origin session not recognized");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(cookieReturned, true, "browser did not return cookie to same-origin proxy");

  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
  const refreshed = await pageJson(page, "/api/auth/get-session", { headers: { accept: "application/json" } });
  assert.equal(refreshed.status, 200);
  assert.equal(sessionInfo(refreshed.body).active, true, "session not recognized after refresh");

  const token = await pageJson(page, "/api/auth/token", { headers: { accept: "application/json" } });
  const nativeToken = token.body?.token || token.body?.data?.token || "";
  assert.ok(token.ok && typeof nativeToken === "string" && nativeToken.length > 40, "native token unavailable through same-origin proxy");

  const summary = {
    proxiedLoginResponse: "PASS",
    setCookieReceived: "PASS",
    cookies: setCookieSummaries.map(({ name: cookieName, httpOnly, secure, sameSite, path, domainPresent }) => ({ cookieName, httpOnly, secure, sameSite, path, domainPresent })),
    browserStoresCookie: "PASS",
    cookieReturnedToProxy: "PASS",
    sessionRecognized: "PASS",
    refreshPersistence: "PASS",
    nativeTokenFlow: "PASS",
    sensitiveFindings: 0,
  };
  console.log("SAME_ORIGIN_AUTH_COOKIE_FEASIBILITY: PASS", JSON.stringify(summary));
} finally {
  await context.close();
  await browser.close();
}
