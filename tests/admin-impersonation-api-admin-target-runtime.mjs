import assert from "node:assert/strict";

const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const AUTH_URL = `${APP_BASE}/api/auth`;
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";
const controllerUrl = process.env.AUDIT_SMOKE_CONTROLLER_URL || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24);
assert.ok(controllerToken.length >= 32);
assert.ok(controllerUrl.startsWith("https://"));

const adminEmail = `audit-smoke-${marker}-admin@example.invalid`;

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

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function authFetch(jar, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("origin", APP_BASE);
  headers.set("referer", `${APP_BASE}/`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" });
  jar.absorb(response.headers);
  return response;
}

async function controller(action) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-audit-smoke-token": controllerToken },
    body: JSON.stringify({ action, marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, `${action} controller failed`);
  return body;
}

const jar = new CookieJar();
const signIn = await authFetch(jar, "/sign-in/email", {
  method: "POST",
  body: JSON.stringify({ email: adminEmail, password }),
});
assert.ok(signIn.ok, `QA Admin sign-in failed (${signIn.status})`);

const tokenResponse = await authFetch(jar, "/token");
const tokenBody = await readJson(tokenResponse);
const token = tokenBody?.token || tokenBody?.data?.token || "";
assert.ok(tokenResponse.ok && typeof token === "string" && token.length > 40, "QA Admin token unavailable");

const target = await controller("real-admin-target");
assert.equal(typeof target?.id, "string", "existing Admin target unavailable");

const response = await fetch(`${APP_BASE}/api/admin/customers/${encodeURIComponent(target.id)}/impersonate`, {
  method: "POST",
  headers: {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    cookie: jar.header(),
    origin: APP_BASE,
    referer: `${APP_BASE}/`,
  },
  body: "{}",
  redirect: "manual",
});
const body = await readJson(response);
assert.equal(response.status, 400, `distinct Admin target was not denied (${response.status})`);
assert.equal(body?.error, "ADMIN_TARGET_DENIED", "distinct Admin target denial reason mismatch");
const session = await authFetch(jar, "/get-session");
const sessionBody = await readJson(session);
const root = sessionBody?.data && typeof sessionBody.data === "object" ? sessionBody.data : sessionBody;
assert.equal(root?.session?.impersonatedBy ?? root?.session?.impersonated_by ?? null, null, "Admin-target denial created impersonation state");

console.log("IMPERSONATION_API_ADMIN_TARGET: DENIED", JSON.stringify({ status: response.status, sensitiveFindings: 0 }));
