import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.FASE4B_QA_MARKER || "";
const password = process.env.FASE4B_QA_PASSWORD || "";
const controllerUrl = process.env.FASE4B_QA_CONTROLLER_URL || "";
const controllerToken = process.env.FASE4B_QA_TOKEN_VALUE || "";

assert.match(marker, /^[0-9]{8,24}$/);
assert.ok(password.length >= 24, "ephemeral QA password missing");
assert.ok(controllerUrl.startsWith("https://"), "controller URL missing");
assert.ok(controllerToken.length >= 32, "controller token missing");

const emails = {
  a: `fase4b-entitlement-${marker}-a@example.invalid`,
  b: `fase4b-entitlement-${marker}-b@example.invalid`,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
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
  try { return JSON.parse(text); } catch { return { invalidJson: true, status: response.status }; }
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

async function tokenFor(jar) {
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
  const token = await tokenFor(jar);
  return { jar, token, id: decodeSub(token) };
}

async function dataApi(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${DATA_API}${path}`, { ...init, headers });
}

function rpcIdentity(body) {
  if (typeof body === "string") return body.trim() || null;
  if (Array.isArray(body)) {
    const first = body[0];
    if (typeof first === "string") return first.trim() || null;
    if (first && typeof first === "object") return first.current_auth_user_id || first.auth_user_id || null;
  }
  if (body && typeof body === "object") return body.current_auth_user_id || body.auth_user_id || null;
  return null;
}

async function waitForIdentity(token, expectedId) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await dataApi("/rpc/current_auth_user_id", token, { method: "POST", body: "{}" });
    lastStatus = response.status;
    const body = await readJson(response);
    if (response.ok && rpcIdentity(body) === expectedId) return;
    await sleep(500);
  }
  throw new Error(`Data API identity unavailable (${lastStatus})`);
}

async function controller(action) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fase4b-qa-token": controllerToken },
    body: JSON.stringify({ action, marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, `controller ${action} failed (${response.status})`);
  return body;
}

async function createProfile(identity, suffix) {
  const response = await dataApi("/profiles?select=id,name,owner_auth_user_id,onboarding_completed", identity.token, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      name: `FASE4B QA ${suffix.toUpperCase()} ${marker}`,
      slug: `fase4b-qa-${marker}-${suffix}`,
      owner_auth_user_id: identity.id,
      onboarding_completed: true,
    }),
  });
  const body = await readJson(response);
  assert.ok(response.ok, `profile ${suffix} creation failed (${response.status})`);
  const profile = body?.[0];
  assert.equal(profile?.owner_auth_user_id, identity.id);
  assert.equal(typeof profile?.id, "string");
  return profile.id;
}

async function getRows(path, token) {
  const response = await dataApi(path, token);
  const body = await readJson(response);
  assert.ok(response.ok, `${path} read failed (${response.status})`);
  assert.ok(Array.isArray(body), `${path} did not return rows`);
  return body;
}

async function assertDenied(response, label) {
  const body = await readJson(response);
  assert.equal(response.ok, false, `${label} unexpectedly allowed (${response.status})`);
  return { status: response.status, error: body?.code || body?.error || null };
}

const results = {};
const preflight = await controller("preflight");
for (const key of ["qaUsers","qaProfiles","qaOwners","qaEntitlementOverrides","qaUsageEvents","qaUsageBuckets"]) assert.equal(preflight[key], 0, `preflight ${key}`);
assert.equal(preflight.superAdmins, 1, "SUPER_ADMIN baseline");
assert.equal(preflight.profilesWithoutOwner, 0);
assert.equal(preflight.multipleOwners, 0);
assert.equal(preflight.ownerMismatch, 0);
assert.equal(preflight.openPolicies, 0);
assert.equal(preflight.anonymousPrivilegedTables, 0);
results.baselineProfiles = preflight.profilesTotal;

const privileges = await controller("privileges");
assert.equal(privileges.tables.length, 3);
for (const row of privileges.tables) {
  assert.equal(row.authenticated_select, true, `${row.table_name} authenticated SELECT`);
  assert.equal(row.authenticated_insert, false, `${row.table_name} authenticated INSERT`);
  assert.equal(row.authenticated_update, false, `${row.table_name} authenticated UPDATE`);
  assert.equal(row.authenticated_delete, false, `${row.table_name} authenticated DELETE`);
  assert.equal(row.anonymous_select, false, `${row.table_name} anonymous SELECT`);
}
for (const [key, value] of Object.entries(privileges.functions)) assert.equal(value, false, `${key} must remain denied`);
results.privileges = "PASS";

const customerA = await signUp(emails.a, "FASE4B QA Customer A");
const customerB = await signUp(emails.b, "FASE4B QA Customer B");
assert.notEqual(customerA.id, customerB.id);
await waitForIdentity(customerA.token, customerA.id);
await waitForIdentity(customerB.token, customerB.id);
const profileA = await createProfile(customerA, "a");
const profileB = await createProfile(customerB, "b");
assert.notEqual(profileA, profileB);

const setup = await controller("setup");
assert.equal(setup.configured, true);
assert.equal(setup.profileA, profileA);
assert.equal(setup.profileB, profileB);

const aEntitlement = await getRows(`/profile_entitlements?profile_id=eq.${encodeURIComponent(profileA)}&select=profile_id,capability_key,enabled,limit_type,limit_value,period_type,source`, customerA.token);
assert.ok(aEntitlement.length > 0, "Customer A own entitlements empty");
assert.ok(aEntitlement.every((row) => row.profile_id === profileA));
const aCrossEntitlement = await getRows(`/profile_entitlements?profile_id=eq.${encodeURIComponent(profileB)}&select=profile_id,capability_key`, customerA.token);
assert.deepEqual(aCrossEntitlement, [], "Customer A saw Customer B entitlement rows");

const bEntitlement = await getRows(`/profile_entitlements?profile_id=eq.${encodeURIComponent(profileB)}&select=profile_id,capability_key`, customerB.token);
assert.ok(bEntitlement.length > 0, "Customer B own entitlements empty");
assert.ok(bEntitlement.every((row) => row.profile_id === profileB));
const bCrossEntitlement = await getRows(`/profile_entitlements?profile_id=eq.${encodeURIComponent(profileA)}&select=profile_id,capability_key`, customerB.token);
assert.deepEqual(bCrossEntitlement, [], "Customer B saw Customer A entitlement rows");
results.entitlementIsolation = "PASS";

for (const [table, ownId, foreignId, identity] of [
  ["capability_usage_events", profileA, profileB, customerA],
  ["capability_usage_buckets", profileA, profileB, customerA],
  ["capability_usage_events", profileB, profileA, customerB],
  ["capability_usage_buckets", profileB, profileA, customerB],
]) {
  const own = await getRows(`/${table}?profile_id=eq.${encodeURIComponent(ownId)}&select=profile_id,capability_key`, identity.token);
  assert.ok(own.length > 0, `${table} own rows empty`);
  assert.ok(own.every((row) => row.profile_id === ownId));
  const cross = await getRows(`/${table}?profile_id=eq.${encodeURIComponent(foreignId)}&select=profile_id,capability_key`, identity.token);
  assert.deepEqual(cross, [], `${table} cross-tenant rows exposed`);
}
results.usageReadIsolation = "PASS";

const noTokenRead = await dataApi("/profile_entitlements?select=id&limit=1", null);
await assertDenied(noTokenRead, "anonymous entitlement read");
results.anonymousRead = "PASS";

const selfInsert = await dataApi("/profile_entitlements", customerA.token, {
  method: "POST",
  body: JSON.stringify({ profile_id: profileA, capability_key: "qa.self.insert", enabled: true, limit_type: "UNLIMITED", period_type: "NONE", source: "CUSTOMER" }),
});
await assertDenied(selfInsert, "customer entitlement insert");

const selfLimit = await dataApi(`/profile_entitlements?profile_id=eq.${encodeURIComponent(profileA)}&capability_key=eq.website.scan`, customerA.token, {
  method: "PATCH",
  body: JSON.stringify({ limit_value: 999999 }),
});
await assertDenied(selfLimit, "customer limit update");

const selfEnable = await dataApi(`/profile_entitlements?profile_id=eq.${encodeURIComponent(profileA)}&capability_key=eq.autopilot.manage`, customerA.token, {
  method: "PATCH",
  body: JSON.stringify({ enabled: true }),
});
await assertDenied(selfEnable, "customer enabled update");

const selfDelete = await dataApi(`/profile_entitlements?profile_id=eq.${encodeURIComponent(profileA)}&capability_key=eq.website.scan`, customerA.token, { method: "DELETE" });
await assertDenied(selfDelete, "customer entitlement delete");

const usageInsert = await dataApi("/capability_usage_events", customerA.token, {
  method: "POST",
  body: JSON.stringify({
    profile_id: profileA,
    capability_key: "website.scan",
    quantity: 1,
    state: "COMMITTED",
    idempotency_key: `abuse-${marker}`,
    period_start: setup.month.start,
    period_end: setup.month.end,
  }),
});
await assertDenied(usageInsert, "customer arbitrary usage write");

const functionAbuse = await dataApi("/rpc/reserve_capability_usage", customerA.token, {
  method: "POST",
  body: JSON.stringify({
    p_profile_id: profileA,
    p_capability_key: "website.scan",
    p_quantity: 1,
    p_limit_value: 1,
    p_period_start: setup.month.start,
    p_period_end: setup.month.end,
    p_idempotency_key: `rpc-abuse-${marker}`,
    p_source: "CUSTOMER",
    p_reference_id: null,
    p_metadata: {},
  }),
});
await assertDenied(functionAbuse, "customer direct reserve function");
results.selfUpgradeDenied = "PASS";
results.functionAbuseDenied = "PASS";

const postAbuseEntitlement = await getRows(`/profile_entitlements?profile_id=eq.${encodeURIComponent(profileA)}&capability_key=in.(website.scan,autopilot.manage)&select=capability_key,enabled,limit_value,source`, customerA.token);
const website = postAbuseEntitlement.find((row) => row.capability_key === "website.scan");
const autopilot = postAbuseEntitlement.find((row) => row.capability_key === "autopilot.manage");
assert.equal(Number(website?.limit_value), 1, "customer changed limit despite denial");
assert.equal(autopilot?.enabled, false, "customer enabled gated capability despite denial");
assert.equal(website?.source, "QA_RUNTIME");
assert.equal(autopilot?.source, "QA_RUNTIME");

const usage = await controller("usage-suite");
for (const key of ["firstReserve","duplicateReserve","overLimitReserve","commit","release","concurrentDistinct","concurrentIdempotency","day","month"]) assert.equal(usage[key], "PASS", key);
assert.equal(usage.reservedFinal, "0");
assert.equal(usage.committedFinal, "1");
results.usageEngine = "PASS";

const during = await controller("state");
assert.equal(during.qaUsers, 2);
assert.equal(during.qaProfiles, 2);
assert.equal(during.qaOwners, 2);
assert.ok(during.qaEntitlementOverrides > 0);
assert.ok(during.qaUsageEvents > 0);
assert.ok(during.qaUsageBuckets > 0);
assert.equal(during.superAdmins, 1);
assert.equal(during.profilesWithoutOwner, 0);
assert.equal(during.multipleOwners, 0);
assert.equal(during.ownerMismatch, 0);
assert.equal(during.openPolicies, 0);
assert.equal(during.anonymousPrivilegedTables, 0);

console.log("FASE4B_ENTITLEMENT_RUNTIME: PASS", JSON.stringify({
  privilegeModel: results.privileges,
  entitlementIsolation: results.entitlementIsolation,
  usageReadIsolation: results.usageReadIsolation,
  anonymousRead: results.anonymousRead,
  selfUpgradeDenied: results.selfUpgradeDenied,
  functionAbuseDenied: results.functionAbuseDenied,
  usageEngine: results.usageEngine,
  baselineProfiles: results.baselineProfiles,
  qaProfiles: during.qaProfiles,
  superAdmins: during.superAdmins,
  profilesWithoutOwner: during.profilesWithoutOwner,
}));
