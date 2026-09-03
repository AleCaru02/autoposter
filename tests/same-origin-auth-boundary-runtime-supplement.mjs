import assert from "node:assert/strict";
import { chromium } from "playwright";

const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const AUTH_URL = `${APP_BASE}/api/auth`;
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const nextPassword = process.env.AUDIT_SMOKE_NEXT_PASSWORD || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);
assert.ok(nextPassword.length >= 24);

const customerEmail = `audit-smoke-${marker}-customer@example.invalid`;
const adminEmail = `audit-smoke-${marker}-admin@example.invalid`;
const customerSlug = `qa-auth-boundary-a-${marker}`;

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
      const parts = String(raw).split(";").map((part) => part.trim());
      const pair = parts[0] || "";
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const expired = parts.some((part) => /^max-age=0$/i.test(part));
      if (expired || !value) this.values.delete(name); else this.values.set(name, value);
    }
  }
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
}

function cookieMetadata(headers) {
  return (headers.getSetCookie?.() || []).map((raw) => {
    const parts = String(raw).split(";").map((part) => part.trim()).filter(Boolean);
    const first = parts.shift() || "";
    const index = first.indexOf("=");
    const name = index > 0 ? first.slice(0, index) : "";
    const attrs = new Map();
    for (const part of parts) {
      const eq = part.indexOf("=");
      attrs.set((eq >= 0 ? part.slice(0, eq) : part).toLowerCase(), eq >= 0 ? part.slice(eq + 1) : true);
    }
    return {
      name,
      httpOnly: attrs.has("httponly"),
      secure: attrs.has("secure"),
      sameSite: typeof attrs.get("samesite") === "string" ? String(attrs.get("samesite")) : null,
      path: typeof attrs.get("path") === "string" ? String(attrs.get("path")) : null,
      domainPresent: attrs.has("domain"),
      neonDomain: typeof attrs.get("domain") === "string" && String(attrs.get("domain")).includes("neonauth"),
    };
  });
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function authFetch(jar, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.method === "POST") {
    headers.set("origin", APP_BASE);
    headers.set("referer", `${APP_BASE}/`);
  }
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const cookie = jar?.header?.() || "";
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" });
  jar?.absorb?.(response.headers);
  return response;
}

async function signIn(email, credential) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", { method: "POST", body: JSON.stringify({ email, password: credential }) });
  const metadata = cookieMetadata(response.headers);
  if (!response.ok) return { ok: false, status: response.status, jar, metadata };
  const tokenResponse = await authFetch(jar, "/token");
  const tokenBody = await readJson(tokenResponse);
  const token = tokenBody?.token || tokenBody?.data?.token || "";
  assert.ok(tokenResponse.ok && typeof token === "string" && token.length > 40);
  return { ok: true, status: response.status, jar, metadata, token };
}

async function session(jar) {
  const response = await authFetch(jar, "/get-session");
  const body = await readJson(response);
  const root = body?.data && typeof body.data === "object" ? body.data : body;
  return { status: response.status, active: Boolean(root?.session && root?.user?.id), userId: root?.user?.id || null };
}

async function productRequest(token, path, method = "GET", body) {
  const headers = new Headers({ accept: "application/json", authorization: `Bearer ${token}` });
  let payload;
  if (body !== undefined) { headers.set("content-type", "application/json"); payload = JSON.stringify(body); }
  const response = await fetch(`${APP_BASE}${path}`, { method, headers, body: payload });
  return { status: response.status, ok: response.ok, body: await readJson(response) };
}

async function dataPatch(token, industry) {
  const response = await fetch(`${DATA_API}/profiles?slug=eq.${encodeURIComponent(customerSlug)}&select=id,slug,industry`, {
    method: "PATCH",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify({ industry }),
  });
  return { response, body: await readJson(response) };
}

const failed = await signIn(customerEmail, `${password}-wrong`);
assert.equal(failed.ok, false, "failed login unexpectedly succeeded");
assert.equal(failed.metadata.filter((item) => item.name.includes("session")).length, 0, "failed login emitted authenticated session cookie");
assert.equal((await session(failed.jar)).active, false, "failed login created session");

const customer = await signIn(customerEmail, password);
assert.equal(customer.ok, true);
const credentialCookies = customer.metadata.filter((item) => item.name.includes("session"));
assert.ok(credentialCookies.length >= 1, "login emitted no session credential cookie");
assert.ok(credentialCookies.every((item) => item.httpOnly && item.secure && !item.neonDomain));
assert.ok(credentialCookies.every((item) => item.path === "/"), "session cookie Path is not root");
const sameSite = credentialCookies[0]?.sameSite || null;
assert.ok(typeof sameSite === "string" && sameSite.length > 0, "session cookie SameSite missing");

const preBanWrite = await dataPatch(customer.token, `QA Auth Boundary pre-ban ${marker}`);
assert.ok(preBanWrite.response.ok && Array.isArray(preBanWrite.body) && preBanWrite.body.length === 1, "safe own write before ban failed");

const admin = await signIn(adminEmail, password);
assert.equal(admin.ok, true);
const ban = await productRequest(admin.token, `/api/admin/customers/${encodeURIComponent((await session(customer.jar)).userId)}/ban`, "POST", { reason: `qa-supplement-${marker}` });
assert.ok(ban.status === 200 || ban.status === 207, `supplement ban failed (${ban.status})`);
const postBanWrite = await dataPatch(customer.token, `QA Auth Boundary forbidden ${marker}`);
assert.ok(!postBanWrite.response.ok || !Array.isArray(postBanWrite.body) || postBanWrite.body.length === 0, "same exact pre-ban JWT retained write access after ban");
const unban = await productRequest(admin.token, `/api/admin/customers/${encodeURIComponent((await session(customer.jar)).userId || ban.body?.customer?.id || "")}/unban`, "POST", {});
assert.ok(unban.status === 200 || unban.status === 207, `supplement unban failed (${unban.status})`);
assert.equal((await signIn(customerEmail, password)).ok, true, "login not restored after supplement unban");

const foreignOrigin = await fetch(`${AUTH_URL}/sign-in/social`, {
  method: "POST",
  headers: { accept: "application/json", "content-type": "application/json", origin: "https://evil.invalid", referer: "https://evil.invalid/" },
  body: JSON.stringify({ provider: "google", callbackURL: `${APP_BASE}/app/dashboard`, disableRedirect: true }),
  redirect: "manual",
});
assert.equal(foreignOrigin.status, 403, `foreign OAuth Origin was not denied (${foreignOrigin.status})`);
try { await foreignOrigin.body?.cancel(); } catch { /* ignore */ }

const evilCallback = await authFetch(new CookieJar(), "/sign-in/social", {
  method: "POST",
  body: JSON.stringify({ provider: "google", callbackURL: "https://evil.invalid/after-oauth", disableRedirect: true }),
});
assert.ok([400, 401, 403, 404].includes(evilCallback.status), `untrusted OAuth callback was accepted (${evilCallback.status})`);
try { await evilCallback.body?.cancel(); } catch { /* ignore */ }

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let directNeon = 0;
  let sameOriginAuth = 0;
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (url.hostname.includes("neonauth")) directNeon += 1;
      if (url.origin === APP_BASE && url.pathname.startsWith("/api/auth/")) sameOriginAuth += 1;
    } catch { /* ignore */ }
  });

  await page.goto(`${APP_BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('input[type="email"]').fill(customerEmail);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });

  await page.goto(`${APP_BASE}/admin/clienti`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL((url) => url.pathname === "/app/dashboard", { timeout: 20000 });

  const oauth = await page.evaluate(async (appBase) => {
    const response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      credentials: "include",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: `${appBase}/app/dashboard`, disableRedirect: true }),
    });
    let body = null;
    try { body = await response.json(); } catch { /* ignore */ }
    return { status: response.status, ok: response.ok, url: body?.url || body?.data?.url || null };
  }, APP_BASE);
  assert.equal(oauth.ok, true, `browser Google OAuth start failed (${oauth.status})`);
  assert.ok(oauth.url, "browser Google OAuth start returned no URL");

  const handoff = new URL(oauth.url);
  assert.equal(handoff.hostname, "ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech", "unexpected Neon OAuth handoff host");
  assert.match(handoff.pathname, /\/auth\/sign-in\/social\/init$/, "unexpected Neon OAuth handoff path");
  assert.equal(Boolean(handoff.searchParams.get("token")), true, "Neon OAuth init handoff token missing");

  const initResponse = await fetch(handoff, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" }, redirect: "manual" });
  const providerLocation = initResponse.headers.get("location") || "";
  try { await initResponse.body?.cancel(); } catch { /* ignore */ }
  assert.ok(initResponse.status >= 300 && initResponse.status < 400 && providerLocation, `Neon OAuth init did not redirect (${initResponse.status})`);

  const providerUrl = new URL(providerLocation);
  assert.ok(providerUrl.hostname === "accounts.google.com" || providerUrl.hostname.endsWith(".google.com"));
  const redirectRaw = providerUrl.searchParams.get("redirect_uri");
  assert.ok(redirectRaw);
  const redirect = new URL(redirectRaw);
  assert.equal(redirect.hostname, "neonauth.us-west-2.aws.neon.tech");
  assert.equal(redirect.pathname, "/auth/oauth/callback/google");
  assert.equal(Boolean(providerUrl.searchParams.get("state")), true);
  assert.equal(Boolean(providerUrl.searchParams.get("code_challenge")), true);

  await page.getByRole("button", { name: "Esci", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 20000 });
  await page.goto(`${APP_BASE}/app/dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForURL((url) => url.pathname === "/login", { timeout: 20000 });
  assert.equal(directNeon, 0, "supplement browser made direct Neon Auth request");
  assert.ok(sameOriginAuth >= 3, "supplement browser did not use same-origin Auth boundary");
  await context.close();
} finally {
  await browser.close();
}

console.log("SAME_ORIGIN_AUTH_BOUNDARY_SUPPLEMENT: PASS", JSON.stringify({
  failedLoginNoAuthenticatedCookie: true,
  cookiePath: "/",
  cookieSameSite: sameSite,
  ownSafeWriteBeforeBan: "PASS",
  samePreBanJwtWriteAfterBan: "DENIED",
  ownerAdminRoute: "DENIED",
  logoutProtectedRoute: "DENIED",
  googleOauthBrowserStart: "PASS",
  googleOauthForeignOrigin: "DENIED",
  googleOauthUntrustedCallback: "DENIED",
  directBrowserNeonAuth: 0,
  sensitiveFindings: 0,
}));
