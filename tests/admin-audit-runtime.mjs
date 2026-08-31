import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const APP_BASE = process.env.ADMIN_SMOKE_BASE || "https://autoposter.02alessandrocaruso.workers.dev";
const adminEmail = process.env.ADMIN_SMOKE_EMAIL || "";
const adminPassword = process.env.ADMIN_SMOKE_PASSWORD || "";
const customerEmail = process.env.CUSTOMER_SMOKE_EMAIL || "";
const customerPassword = process.env.CUSTOMER_SMOKE_PASSWORD || "";

for (const [key, value] of Object.entries({ ADMIN_SMOKE_EMAIL: adminEmail, ADMIN_SMOKE_PASSWORD: adminPassword, CUSTOMER_SMOKE_EMAIL: customerEmail, CUSTOMER_SMOKE_PASSWORD: customerPassword })) {
  assert.ok(value, `${key} is required`);
}

class CookieJar {
  values = new Map();
  absorb(headers) {
    const list = headers.getSetCookie?.() ?? [];
    for (const raw of list) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 160) }; }
}

async function signIn(email, password) {
  const jar = new CookieJar();
  const headers = { accept: "application/json", "content-type": "application/json", origin: APP_BASE, referer: `${APP_BASE}/` };
  const signin = await fetch(`${AUTH_URL}/sign-in/email`, { method: "POST", headers, body: JSON.stringify({ email, password }), redirect: "manual" });
  jar.absorb(signin.headers);
  assert.equal(signin.ok, true, `sign-in failed (${signin.status})`);
  const tokenHeaders = { accept: "application/json", origin: APP_BASE, referer: `${APP_BASE}/`, cookie: jar.header() };
  const tokenResponse = await fetch(`${AUTH_URL}/token`, { headers: tokenHeaders, redirect: "manual" });
  jar.absorb(tokenResponse.headers);
  const body = await readJson(tokenResponse);
  const token = body?.token ?? body?.data?.token ?? "";
  assert.ok(tokenResponse.ok && token.length > 40, "Managed Auth JWT missing");
  return token;
}

async function api(path, token, expected = 200) {
  const response = await fetch(`${APP_BASE}${path}`, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  assert.equal(response.status, expected, `${path} expected ${expected}, got ${response.status}`);
  return body;
}

function auditRows(body) {
  assert.ok(Array.isArray(body?.audit), "audit records missing");
  assert.ok(body?.pagination && Number.isInteger(body.pagination.page), "pagination missing");
  return body.audit;
}

function assertNewestFirst(rows) {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = Date.parse(rows[index - 1].created_at);
    const current = Date.parse(rows[index].created_at);
    assert.ok(Number.isFinite(previous) && Number.isFinite(current), "invalid audit timestamp");
    assert.ok(previous >= current, "audit is not newest-first");
  }
}

const forbiddenKeys = new Set(["password", "jwt", "authorization", "cookie", "sessiontoken", "accesstoken", "refreshtoken", "apikey", "databaseurl", "clientsecret", "oauthsecret", "fase3qatoken"]);
function scanSensitive(value, path = "audit") {
  if (Array.isArray(value)) return value.forEach((child, index) => scanSensitive(child, `${path}[${index}]`));
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      assert.equal(forbiddenKeys.has(normalized), false, `sensitive key exposed at ${path}.${key}`);
      scanSensitive(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") return;
  assert.equal(/\bBearer\s+[A-Za-z0-9._-]+/i.test(value), false, `Bearer credential exposed at ${path}`);
  assert.equal(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(value), false, `JWT-shaped credential exposed at ${path}`);
  assert.equal(/postgres(?:ql)?:\/\//i.test(value), false, `database connection string exposed at ${path}`);
}

const adminToken = await signIn(adminEmail, adminPassword);
const customerToken = await signIn(customerEmail, customerPassword);

const denied = await api("/api/admin/audit", customerToken, 403);
assert.equal(denied?.error, "FORBIDDEN");

const customers = await api("/api/admin/customers", adminToken);
const runtimeCustomer = customers?.customers?.find((row) => String(row.email || "").toLowerCase() === customerEmail.toLowerCase());
assert.ok(runtimeCustomer, "runtime CUSTOMER account not present in Admin customer list");
assert.ok(Number(runtimeCustomer.profile_count || 0) >= 1, "runtime CUSTOMER is not an OWNER of a workspace; OWNER denial cannot be certified");

const base = await api("/api/admin/audit?limit=100&page=1", adminToken);
const rows = auditRows(base);
assert.ok(rows.length > 0, "production Audit Viewer returned no real records");
assertNewestFirst(rows);
scanSensitive(rows);
assert.ok(rows.some((row) => row.actor_name || row.actor_email), "no production audit actor resolves to a readable identity");

const pivot = rows.find((row) => row.action && (row.actor_email || row.actor_name || row.actor_auth_user_id) && (row.target_id || row.target_type)) ?? rows[0];
assert.ok(pivot?.action, "no usable production audit pivot row");
const actorFilter = pivot.actor_email || pivot.actor_name || pivot.actor_auth_user_id;
const targetFilter = pivot.target_id || pivot.target_type;

const byAction = await api(`/api/admin/audit?action=${encodeURIComponent(pivot.action)}&limit=100`, adminToken);
assert.ok(auditRows(byAction).length >= 1 && auditRows(byAction).every((row) => row.action === pivot.action), "action filter mismatch");

const byActor = await api(`/api/admin/audit?actor=${encodeURIComponent(actorFilter)}&limit=100`, adminToken);
assert.ok(auditRows(byActor).some((row) => row.id === pivot.id), "actor filter did not include pivot record");

const byTarget = await api(`/api/admin/audit?target=${encodeURIComponent(targetFilter)}&limit=100`, adminToken);
assert.ok(auditRows(byTarget).some((row) => row.id === pivot.id), "target filter did not include pivot record");

const pivotTime = Date.parse(pivot.created_at);
assert.ok(Number.isFinite(pivotTime));
const from = new Date(pivotTime - 1000).toISOString();
const to = new Date(pivotTime + 1000).toISOString();
const byDate = await api(`/api/admin/audit?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`, adminToken);
assert.ok(auditRows(byDate).some((row) => row.id === pivot.id), "date filter did not include pivot record");

const combined = await api(`/api/admin/audit?action=${encodeURIComponent(pivot.action)}&actor=${encodeURIComponent(actorFilter)}&target=${encodeURIComponent(targetFilter)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`, adminToken);
assert.ok(auditRows(combined).some((row) => row.id === pivot.id), "combined filters did not include pivot record");

const page1 = await api("/api/admin/audit?page=1&limit=1", adminToken);
const page1Rows = auditRows(page1);
assert.equal(page1Rows.length, 1);
assert.ok(page1.pagination.total >= rows.length, "pagination total is inconsistent");
if (page1.pagination.total > 1) {
  const page2 = await api("/api/admin/audit?page=2&limit=1", adminToken);
  const page2Rows = auditRows(page2);
  assert.equal(page2Rows.length, 1);
  assert.notEqual(page1Rows[0].id, page2Rows[0].id, "pagination repeated the same record");
}

for (const path of [
  "/api/admin/audit?limit=-1",
  "/api/admin/audit?limit=999999",
  "/api/admin/audit?page=0",
  "/api/admin/audit?from=not-a-date",
  "/api/admin/audit?from=2026-08-31T12%3A00%3A00.000Z&to=2026-08-30T12%3A00%3A00.000Z",
  `/api/admin/audit?action=${"x".repeat(121)}`,
  `/api/admin/audit?actor=${"x".repeat(257)}`,
  `/api/admin/audit?target=${"x".repeat(257)}`,
  "/api/admin/audit?action=ADMIN_ACCESS&action=ADMIN_OVERVIEW_VIEW",
]) await api(path, adminToken, 400);

const injectionLike = await api(`/api/admin/audit?action=${encodeURIComponent("ADMIN_ACCESS' OR 1=1 --")}`, adminToken);
assert.equal(auditRows(injectionLike).length, 0, "SQL-like action unexpectedly broadened the result set");

console.log("ADMIN_AUDIT_RUNTIME: PASS", JSON.stringify({
  customerDenied: true,
  ownerDenied: true,
  realRecords: rows.length,
  actionFilter: true,
  actorFilter: true,
  targetFilter: true,
  dateFilter: true,
  combinedFilters: true,
  pagination: true,
  invalidInput: true,
  sensitiveExposure: 0,
}));
