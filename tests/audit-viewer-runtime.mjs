import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.AUDIT_SMOKE_MARKER || "";
const password = process.env.AUDIT_SMOKE_PASSWORD || "";
const controllerUrl = process.env.AUDIT_SMOKE_CONTROLLER_URL || "";
const controllerToken = process.env.AUDIT_SMOKE_TOKEN_VALUE || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24, "ephemeral smoke password missing");
assert.ok(controllerUrl.startsWith("https://"), "preview controller URL missing");
assert.ok(controllerToken.length >= 32, "preview controller token missing");

const emails = {
  customer: `audit-smoke-${marker}-customer@example.invalid`,
  admin: `audit-smoke-${marker}-admin@example.invalid`,
};

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    const list = headers.getSetCookie?.() || [];
    for (const raw of list) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  header() { return [...this.values.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { invalidJson: true }; }
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

function decodeSub(token) {
  const payload = token.split(".")[1];
  assert.ok(payload, "JWT payload missing");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  const body = JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  assert.equal(typeof body.sub, "string");
  return body.sub;
}

async function identityToken(jar) {
  const response = await authFetch(jar, "/token");
  const body = await readJson(response);
  const token = body?.token || body?.data?.token || "";
  assert.ok(response.ok && token.length > 40, `Managed Auth token unavailable (${response.status})`);
  return token;
}

async function signUp(email, name) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  assert.ok(response.ok, `Managed Auth signup failed (${response.status})`);
  const token = await identityToken(jar);
  return { jar, token, id: decodeSub(token) };
}

async function signIn(email) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  assert.ok(response.ok, `Managed Auth signin failed (${response.status})`);
  const token = await identityToken(jar);
  return { jar, token, id: decodeSub(token) };
}

async function dataApi(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${DATA_API}${path}`, { ...init, headers });
}

async function adminApi(path, token, expected) {
  const response = await fetch(`${APP_BASE}${path}`, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
  const body = await readJson(response);
  assert.equal(response.status, expected, `${path} expected ${expected}, got ${response.status}`);
  return body;
}

async function controller(action) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-audit-smoke-token": controllerToken },
    body: JSON.stringify({ action, marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, `preview controller ${action} failed (${response.status})`);
  return body;
}

function assertPagination(body, expectedLimit) {
  assert.ok(Array.isArray(body?.audit), "audit list missing");
  assert.ok(body?.pagination && Number.isInteger(body.pagination.page), "pagination missing");
  assert.equal(body.pagination.limit, expectedLimit);
  assert.ok(body.pagination.total >= body.audit.length);
  assert.ok(body.pagination.totalPages >= 1);
}

function assertStableOrdering(rows) {
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
    const a = Date.parse(previous.created_at);
    const b = Date.parse(current.created_at);
    assert.ok(Number.isFinite(a) && Number.isFinite(b), "audit timestamp invalid");
    assert.ok(a >= b, "audit ordering is not descending by timestamp");
    if (a === b) assert.ok(String(previous.id) >= String(current.id), "audit tie ordering is unstable");
  }
}

function sensitiveFindings(value, path = "root", findings = []) {
  const sensitiveKeys = new Set(["password", "jwt", "authorization", "cookie", "sessiontoken", "accesstoken", "refreshtoken", "apikey", "databaseurl", "clientsecret", "oauthsecret", "fase3qatoken", "auditsmoketoken"]);
  if (Array.isArray(value)) {
    value.forEach((item, index) => sensitiveFindings(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (sensitiveKeys.has(normalized)) {
        if (child !== "[REDACTED]") findings.push({ category: normalized, path: `${path}.${key}` });
        continue;
      }
      sensitiveFindings(child, `${path}.${key}`, findings);
    }
    return findings;
  }
  if (typeof value === "string") {
    const checks = [
      ["smoke_password", value.includes(password)],
      ["controller_token", value.includes(controllerToken)],
      ["bearer", /\bbearer\s+[a-z0-9._-]+/i.test(value)],
      ["jwt", /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/.test(value)],
      ["database_url", /\bpostgres(?:ql)?:\/\//i.test(value)],
    ];
    for (const [category, found] of checks) if (found) findings.push({ category, path });
  }
  return findings;
}

const results = {};
const preflight = await controller("preflight");
assert.equal(preflight.qaUsers, 0);
assert.equal(preflight.qaProfiles, 0);
assert.equal(preflight.qaOwners, 0);
assert.equal(preflight.qaSessions, 0);
assert.equal(preflight.qaAdmins, 0);
assert.equal(preflight.superAdmins, 1, "real SUPER_ADMIN baseline must be exactly one");
assert.equal(preflight.profilesWithoutOwner, 0);
results.baselineProfiles = preflight.profilesTotal;

const customer = await signUp(emails.customer, "Audit Smoke Customer");
const adminCandidate = await signUp(emails.admin, "Audit Smoke Admin");
assert.notEqual(customer.id, adminCandidate.id);

await adminApi("/api/admin/audit", customer.token, 403);
results.customerApi = "PASS";

const profileResponse = await dataApi("/profiles?select=id,name,owner_auth_user_id,onboarding_completed", customer.token, {
  method: "POST",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({
    name: `Audit Smoke ${marker}`,
    slug: `audit-smoke-${marker}`,
    owner_auth_user_id: customer.id,
    onboarding_completed: true,
  }),
});
const profileBody = await readJson(profileResponse);
assert.ok(profileResponse.ok, `smoke profile creation failed (${profileResponse.status})`);
assert.equal(profileBody?.[0]?.owner_auth_user_id, customer.id);
const profileId = profileBody?.[0]?.id;
assert.equal(typeof profileId, "string");

const membershipResponse = await dataApi(`/profile_members?profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id,role`, customer.token);
const membershipBody = await readJson(membershipResponse);
assert.ok(membershipResponse.ok, `OWNER membership read failed (${membershipResponse.status})`);
assert.deepEqual(membershipBody?.map((row) => row.role), ["OWNER"]);
await adminApi("/api/admin/audit", customer.token, 403);
results.ownerApi = "PASS";

const ownProfilesResponse = await dataApi("/profiles?select=id,owner_auth_user_id", customer.token);
const ownProfiles = await readJson(ownProfilesResponse);
assert.ok(ownProfilesResponse.ok && Array.isArray(ownProfiles));
assert.ok(ownProfiles.some((row) => row.id === profileId));
assert.ok(ownProfiles.every((row) => row.owner_auth_user_id === customer.id), "CUSTOMER saw another tenant profile");

const directAudit = await dataApi("/platform_admin_audit?select=id&limit=1", customer.token);
assert.ok(!directAudit.ok, `CUSTOMER direct audit table read unexpectedly allowed (${directAudit.status})`);
results.directDbDenied = "PASS";

const beforePromotion = await controller("state");
assert.equal(beforePromotion.qaUsers, 2);
assert.equal(beforePromotion.qaProfiles, 1);
assert.equal(beforePromotion.qaOwners, 1);
assert.equal(beforePromotion.qaAdmins, 0);
assert.equal(beforePromotion.superAdmins, 1);

const promoted = await controller("promote");
assert.equal(promoted.qaAdmins, 1);
assert.equal(promoted.superAdmins, 2);

const admin = await signIn(emails.admin);
assert.equal(admin.id, adminCandidate.id);
const me = await adminApi("/api/admin/me", admin.token, 200);
assert.equal(me.platformRole, "SUPER_ADMIN");
results.superAdminApi = "PASS";

const runtimeFrom = new Date(Date.now() - 2000).toISOString();
for (let i = 0; i < 5; i += 1) {
  const body = await adminApi("/api/admin/me", admin.token, 200);
  assert.equal(body.platformRole, "SUPER_ADMIN");
}
const runtimeTo = new Date(Date.now() + 2000).toISOString();

const noFilters = await adminApi("/api/admin/audit?limit=25&page=1", admin.token, 200);
assertPagination(noFilters, 25);
assertStableOrdering(noFilters.audit);
results.noFilters = "PASS";

const maxLimit = await adminApi("/api/admin/audit?limit=100&page=1", admin.token, 200);
assertPagination(maxLimit, 100);

const action = await adminApi("/api/admin/audit?action=ADMIN_ACCESS&limit=25&page=1", admin.token, 200);
assertPagination(action, 25);
assert.ok(action.audit.length > 0 && action.audit.every((row) => row.action === "ADMIN_ACCESS"));
results.action = "PASS";

const actor = await adminApi(`/api/admin/audit?actor=${encodeURIComponent(admin.id)}&limit=25&page=1`, admin.token, 200);
assertPagination(actor, 25);
assert.ok(actor.audit.length > 0 && actor.audit.every((row) => row.actor_auth_user_id === admin.id));
results.actor = "PASS";

const target = await adminApi("/api/admin/audit?target=BACKOFFICE&limit=25&page=1", admin.token, 200);
assertPagination(target, 25);
assert.ok(target.audit.length > 0 && target.audit.every((row) => row.target_type === "PLATFORM" && row.target_id === "BACKOFFICE"));
results.target = "PASS";

const fromOnly = await adminApi(`/api/admin/audit?from=${encodeURIComponent(runtimeFrom)}&limit=100&page=1`, admin.token, 200);
assert.ok(fromOnly.audit.every((row) => Date.parse(row.created_at) >= Date.parse(runtimeFrom)));
const toOnly = await adminApi(`/api/admin/audit?to=${encodeURIComponent(runtimeTo)}&limit=100&page=1`, admin.token, 200);
assert.ok(toOnly.audit.every((row) => Date.parse(row.created_at) <= Date.parse(runtimeTo)));
const dateRange = await adminApi(`/api/admin/audit?from=${encodeURIComponent(runtimeFrom)}&to=${encodeURIComponent(runtimeTo)}&limit=100&page=1`, admin.token, 200);
assert.ok(dateRange.audit.length > 0 && dateRange.audit.every((row) => Date.parse(row.created_at) >= Date.parse(runtimeFrom) && Date.parse(row.created_at) <= Date.parse(runtimeTo)));
results.date = "PASS";

const combined = await adminApi(`/api/admin/audit?action=ADMIN_ACCESS&actor=${encodeURIComponent(admin.id)}&from=${encodeURIComponent(runtimeFrom)}&to=${encodeURIComponent(runtimeTo)}&limit=100&page=1`, admin.token, 200);
assert.ok(combined.audit.length >= 5);
assert.ok(combined.audit.every((row) => row.action === "ADMIN_ACCESS" && row.actor_auth_user_id === admin.id && Date.parse(row.created_at) >= Date.parse(runtimeFrom) && Date.parse(row.created_at) <= Date.parse(runtimeTo)));
results.combined = "PASS";

const page1 = await adminApi(`/api/admin/audit?action=ADMIN_ACCESS&actor=${encodeURIComponent(admin.id)}&limit=2&page=1`, admin.token, 200);
const page2 = await adminApi(`/api/admin/audit?action=ADMIN_ACCESS&actor=${encodeURIComponent(admin.id)}&limit=2&page=2`, admin.token, 200);
assertPagination(page1, 2);
assertPagination(page2, 2);
assert.equal(page1.audit.length, 2);
assert.equal(page2.audit.length, 2);
assert.equal(page1.audit.some((a) => page2.audit.some((b) => a.id === b.id)), false, "pagination duplicated an audit row");
assertStableOrdering(page1.audit);
assertStableOrdering(page2.audit);
results.pagination = "PASS";

const invalidCases = [
  "/api/admin/audit?limit=-1",
  "/api/admin/audit?limit=999999",
  "/api/admin/audit?from=not-a-date",
  `/api/admin/audit?from=${encodeURIComponent(runtimeTo)}&to=${encodeURIComponent(runtimeFrom)}`,
  `/api/admin/audit?action=${encodeURIComponent("x".repeat(121))}`,
  "/api/admin/audit?action=ADMIN_ACCESS&action=ADMIN_OVERVIEW_VIEW",
];
for (const path of invalidCases) await adminApi(path, admin.token, 400);
results.invalid = "PASS";

const emptyActor = `audit-smoke-no-match-${marker}`;
const empty = await adminApi(`/api/admin/audit?actor=${encodeURIComponent(emptyActor)}&limit=25&page=1`, admin.token, 200);
assertPagination(empty, 25);
assert.equal(empty.audit.length, 0);
assert.equal(empty.pagination.total, 0);
results.empty = "PASS";

const findings = sensitiveFindings(noFilters);
assert.deepEqual(findings, [], `sensitive audit response findings: ${JSON.stringify(findings)}`);
results.sensitive = "PASS";

const during = await controller("state");
assert.equal(during.qaUsers, 2);
assert.equal(during.qaProfiles, 1);
assert.equal(during.qaOwners, 1);
assert.equal(during.qaAdmins, 1);
assert.equal(during.superAdmins, 2);
assert.ok(during.qaSessions >= 2);

console.log("AUDIT_VIEWER_API_RUNTIME: PASS", JSON.stringify({
  customerApi: results.customerApi,
  ownerApi: results.ownerApi,
  superAdminApi: results.superAdminApi,
  noFilters: results.noFilters,
  action: results.action,
  actor: results.actor,
  target: results.target,
  date: results.date,
  combined: results.combined,
  pagination: results.pagination,
  invalid: results.invalid,
  sensitive: results.sensitive,
  empty: results.empty,
  directDbDenied: results.directDbDenied,
  temporarySuperAdmins: during.superAdmins,
  baselineProfiles: results.baselineProfiles,
}));
