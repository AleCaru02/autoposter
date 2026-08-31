import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.FASE3_QA_MARKER || "";
const password = process.env.FASE3_QA_PASSWORD || "";
const qaSecret = process.env.FASE3_QA_TOKEN_VALUE || "";

assert.match(marker, /^[a-z0-9]{8,40}$/);
assert.ok(password.length >= 16);
assert.ok(qaSecret.length >= 32);

const adminEmail = `fase3-qa-${marker}-admin@example.invalid`;
const customerAEmail = `fase3-qa-${marker}-customer-a@example.invalid`;
const customerBEmail = `fase3-qa-${marker}-customer-b@example.invalid`;

class CookieJar {
  private values = new Map<string, string>();
  absorb(headers: Headers) {
    const list = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const raw of list) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
}

type Identity = { id: string; token: string };
type AuditRow = {
  actor_auth_user_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;
  created_at: string;
};

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; }
}

async function authFetch(jar: CookieJar, path: string, init: RequestInit = {}) {
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

function decodeSub(token: string) {
  const part = token.split(".")[1];
  assert.ok(part, "JWT payload missing");
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  const payload = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  assert.equal(typeof payload.sub, "string");
  return payload.sub as string;
}

async function signIn(email: string): Promise<Identity> {
  const jar = new CookieJar();
  const signin = await authFetch(jar, "/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  assert.ok(signin.ok, `audit QA sign-in failed (${signin.status})`);
  const tokenResponse = await authFetch(jar, "/token");
  const tokenBody = await readJson(tokenResponse) as { token?: string; data?: { token?: string } } | null;
  const token = tokenBody?.token ?? tokenBody?.data?.token ?? "";
  assert.ok(tokenResponse.ok && token.length > 40, "audit QA JWT missing");
  return { id: decodeSub(token), token };
}

async function dataApi(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${DATA_API}${path}`, { ...init, headers });
}

async function qaState() {
  const response = await fetch(`${APP_BASE}/api/internal/fase3/qa-control`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fase3-qa-token": qaSecret },
    body: JSON.stringify({ action: "state", marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, `audit state failed: ${JSON.stringify(body)}`);
  return body as { qaAuditRows?: AuditRow[] };
}

function metadataObject(value: unknown) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "audit metadata must be an object");
  return value as Record<string, unknown>;
}

function assertTimestamp(value: string, action: string) {
  const timestamp = Date.parse(value);
  assert.ok(Number.isFinite(timestamp), `${action} timestamp invalid`);
  const now = Date.now();
  assert.ok(timestamp <= now + 60_000, `${action} timestamp is unexpectedly in the future`);
  assert.ok(timestamp >= now - 10 * 60_000, `${action} timestamp is not from this QA run`);
}

function assertSensitiveAuditScan(row: AuditRow) {
  const serialized = JSON.stringify(row).toLowerCase();
  const forbidden = [
    "password",
    "bearer ",
    "authorization",
    "cookie",
    "session token",
    "session_token",
    "access token",
    "access_token",
    "refresh token",
    "refresh_token",
    "api key",
    "api_key",
    "apikey",
    "database_url",
    "postgres://",
    "postgresql://",
    "cloudflare secret",
    "fase3_qa_token",
    "credential",
  ];
  for (const term of forbidden) assert.ok(!serialized.includes(term), `${row.action} audit contains forbidden sensitive material: ${term}`);
  assert.ok(!/eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/i.test(serialized), `${row.action} audit contains JWT-shaped material`);
  assert.ok(!/(^|[^a-z])token([^a-z]|$)/i.test(serialized), `${row.action} audit contains token material`);
}

function assertBaseRow(row: AuditRow, adminId: string, action: string, targetType: string, targetId: string) {
  assert.equal(row.actor_auth_user_id, adminId, `${action} actor mismatch`);
  assert.equal(row.action, action, `${action} action mismatch`);
  assert.equal(row.target_type, targetType, `${action} target type mismatch`);
  assert.equal(row.target_id, targetId, `${action} target id mismatch`);
  assertTimestamp(row.created_at, action);
  metadataObject(row.metadata);
  assertSensitiveAuditScan(row);
}

const admin = await signIn(adminEmail);
const customerA = await signIn(customerAEmail);
const customerB = await signIn(customerBEmail);
const state = await qaState();
const rows = Array.isArray(state.qaAuditRows) ? state.qaAuditRows : [];
assert.ok(rows.length >= 6, `expected structured Admin audit rows, got ${rows.length}`);

const access = rows.find((row) => row.action === "ADMIN_ACCESS");
assert.ok(access, "ADMIN_ACCESS audit row missing");
assertBaseRow(access, admin.id, "ADMIN_ACCESS", "PLATFORM", "BACKOFFICE");
assert.deepEqual(metadataObject(access.metadata), {});

const overview = rows.find((row) => row.action === "ADMIN_OVERVIEW_VIEW");
assert.ok(overview, "ADMIN_OVERVIEW_VIEW audit row missing");
assertBaseRow(overview, admin.id, "ADMIN_OVERVIEW_VIEW", "PLATFORM", "OVERVIEW");
assert.deepEqual(metadataObject(overview.metadata), {});

const customers = rows.find((row) => row.action === "ADMIN_CUSTOMERS_LIST");
assert.ok(customers, "ADMIN_CUSTOMERS_LIST audit row missing");
assertBaseRow(customers, admin.id, "ADMIN_CUSTOMERS_LIST", "PLATFORM", "CUSTOMERS");
const customersMetadata = metadataObject(customers.metadata);
assert.deepEqual(Object.keys(customersMetadata), ["resultCount"]);
assert.ok(Number.isInteger(Number(customersMetadata.resultCount)) && Number(customersMetadata.resultCount) >= 3);

const activities = rows.find((row) => row.action === "ADMIN_ACTIVITIES_LIST");
assert.ok(activities, "ADMIN_ACTIVITIES_LIST audit row missing");
assertBaseRow(activities, admin.id, "ADMIN_ACTIVITIES_LIST", "PLATFORM", "ACTIVITIES");
const activitiesMetadata = metadataObject(activities.metadata);
assert.deepEqual(Object.keys(activitiesMetadata), ["resultCount"]);
assert.ok(Number.isInteger(Number(activitiesMetadata.resultCount)) && Number(activitiesMetadata.resultCount) >= 2);

for (const targetId of [customerA.id, customerB.id]) {
  const detail = rows.find((row) => row.action === "ADMIN_CUSTOMER_DETAIL_VIEW" && row.target_id === targetId);
  assert.ok(detail, `ADMIN_CUSTOMER_DETAIL_VIEW missing for QA customer`);
  assertBaseRow(detail, admin.id, "ADMIN_CUSTOMER_DETAIL_VIEW", "AUTH_USER", targetId);
  const detailMetadata = metadataObject(detail.metadata);
  assert.deepEqual(Object.keys(detailMetadata), ["profileCount"]);
  assert.equal(Number(detailMetadata.profileCount), 1);
}

const customerCrud: Record<string, boolean> = { SELECT: false, INSERT: false, UPDATE: false, DELETE: false };
const crudCases = [
  ["SELECT", "GET", "/platform_admin_audit?select=*", undefined],
  ["INSERT", "POST", "/platform_admin_audit", { actor_auth_user_id: customerA.id, action: "FORGED" }],
  ["UPDATE", "PATCH", "/platform_admin_audit?action=eq.ADMIN_ACCESS", { action: "FORGED" }],
  ["DELETE", "DELETE", "/platform_admin_audit?action=eq.ADMIN_ACCESS", undefined],
] as const;
for (const [label, method, path, body] of crudCases) {
  const response = await dataApi(path, customerA.token, { method, body: body ? JSON.stringify(body) : undefined });
  assert.ok(!response.ok, `CUSTOMER platform_admin_audit ${label} unexpectedly allowed (${response.status})`);
  customerCrud[label] = true;
}

console.log("FASE3_AUDIT_DETAIL: PASS", JSON.stringify({
  actions: {
    ADMIN_ACCESS: true,
    ADMIN_OVERVIEW_VIEW: true,
    ADMIN_CUSTOMERS_LIST: true,
    ADMIN_CUSTOMER_DETAIL_VIEW: true,
    ADMIN_ACTIVITIES_LIST: true,
  },
  actor: true,
  target: true,
  timestamp: true,
  metadata: true,
  sensitiveScan: true,
  customerCrud,
}));
