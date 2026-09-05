import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.PROVIDER_COST_QA_MARKER || "";
const password = process.env.PROVIDER_COST_QA_PASSWORD || "";
const controllerUrl = process.env.PROVIDER_COST_PREVIEW_URL || "";
const controllerToken = process.env.PROVIDER_COST_QA_TOKEN_VALUE || "";

assert.match(marker, /^[0-9]{10,32}$/);
assert.ok(password.length >= 24);
assert.ok(controllerUrl.startsWith("https://"));
assert.ok(controllerToken.length >= 32);

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) {
    for (const raw of headers.getSetCookie?.() || []) {
      const pair = raw.split(";", 1)[0];
      const index = pair.indexOf("=");
      if (index > 0) this.values.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
  }
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
}

async function readJson(response) {
  const value = await response.text();
  try { return value ? JSON.parse(value) : null; } catch { return { invalidJson: true }; }
}

async function authFetch(jar, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("origin", APP_BASE);
  headers.set("referer", `${APP_BASE}/`);
  if (init.body) headers.set("content-type", "application/json");
  if (jar.header()) headers.set("cookie", jar.header());
  const response = await fetch(`${AUTH_URL}${path}`, { ...init, headers, redirect: "manual" });
  jar.absorb(response.headers);
  return response;
}

function subject(token) {
  const payload = token.split(".")[1];
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")).sub;
}

async function signUp(email, name) {
  const jar = new CookieJar();
  const response = await authFetch(jar, "/sign-up/email", { method: "POST", body: JSON.stringify({ email, password, name }) });
  assert.ok(response.ok, `signup failed ${response.status}`);
  const tokenResponse = await authFetch(jar, "/token");
  const body = await readJson(tokenResponse);
  const token = body?.token || body?.data?.token || "";
  assert.ok(tokenResponse.ok && token.length > 40);
  return { token, id: subject(token) };
}

async function dataApi(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${DATA_API}${path}`, { ...init, headers });
}

async function controller(action) {
  const response = await fetch(controllerUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-provider-cost-qa-token": controllerToken },
    body: JSON.stringify({ action, marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, 200, `controller ${action}: ${response.status} ${body?.detail || body?.error || ""}`);
  return body;
}

const initial = await controller("preflight");
for (const key of ["qaUsers","recognizedQaUsers","qaProfiles","qaAssignments","qaEntitlements","qaUsageEvents","qaUsageBuckets","qaAttempts","qaAiEvents","qaAudit","recognizedQaAudit"]) assert.equal(initial[key], 0, `preflight ${key}`);
assert.equal(initial.packageLifecycle, "ACTIVE");
assert.equal(initial.packageCap, 5);
assert.equal(initial.authenticatedAttemptSelect, false);
assert.equal(initial.authenticatedBudgetExecute, false);
assert.equal(initial.attemptRlsForced, true);

const primary = await signUp(`cost-smoke-${marker}-primary@example.invalid`, "Provider Cost Primary");
const other = await signUp(`cost-smoke-${marker}-other@example.invalid`, "Provider Cost Other");
assert.notEqual(primary.id, other.id);

async function createProfile(identity, kind) {
  const response = await dataApi("/profiles?select=id,owner_auth_user_id", identity.token, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name: `Cost Smoke ${kind} ${marker}`, slug: `cost-smoke-${marker}-${kind}`, owner_auth_user_id: identity.id, onboarding_completed: true }),
  });
  const body = await readJson(response);
  assert.ok(response.ok, `profile ${kind} failed ${response.status}`);
  assert.equal(body?.[0]?.owner_auth_user_id, identity.id);
  return body[0].id;
}

const primaryProfile = await createProfile(primary, "primary");
await createProfile(other, "other");

const missingEntitlements = await dataApi(`/profile_entitlements?profile_id=eq.${primaryProfile}&select=capability_key`, primary.token);
assert.deepEqual(await readJson(missingEntitlements), [], "new profile must fail closed before provisioning");

for (const rpc of ["apply_entitlement_package", "begin_provider_cost_attempt"]) {
  const response = await dataApi(`/rpc/${rpc}`, primary.token, { method: "POST", body: "{}" });
  assert.equal(response.ok, false, `${rpc} unexpectedly customer-callable`);
}

const provisioned = await controller("provision");
assert.equal(provisioned.profileId, primaryProfile);
assert.equal(provisioned.mapped, 23);
assert.equal(provisioned.enabled, 4);

const ownResponse = await dataApi(`/profile_entitlements?profile_id=eq.${primaryProfile}&select=capability_key,enabled,limit_value,source&order=capability_key`, primary.token);
const own = await readJson(ownResponse);
assert.ok(ownResponse.ok && own.length === 23);
assert.equal(own.filter((row) => row.enabled).length, 4);
assert.ok(own.every((row) => row.source === "PACKAGE:commercial_guarded:v1"));

const isolatedResponse = await dataApi(`/profile_entitlements?profile_id=eq.${primaryProfile}&select=capability_key`, other.token);
assert.deepEqual(await readJson(isolatedResponse), [], "other tenant saw package rows");
const directAttempts = await dataApi(`/provider_cost_attempts?profile_id=eq.${primaryProfile}&select=id`, primary.token);
assert.equal(directAttempts.ok, false, "customer read provider cost ledger");

const fill = await controller("exercise-fill");
assert.equal(fill.profileId, primaryProfile);
assert.equal(fill.accountedUsd, 5);
assert.equal(fill.attempts, 6);
assert.equal(fill.reconciled, 1);
assert.equal(fill.reserveExceeded, 1);
assert.equal(fill.releasedAttemptRetained, 1);
assert.equal(fill.releasedLogicalState, "RELEASED");
assert.equal(fill.duplicateAttempt, true);
assert.equal(fill.providerStarts, 6);
const denials = await controller("exercise-denials");
assert.equal(denials.accountedUsd, 5);
assert.equal(denials.attempts, 6);
assert.equal(denials.providerStartsAfterDenial, 0);
assert.deepEqual(denials.denialCodes, Array(4).fill("PROVIDER_COST_BUDGET_REACHED"));

const ownEventsResponse = await dataApi(`/capability_usage_events?profile_id=eq.${primaryProfile}&select=id,state,capability_key`, primary.token);
const ownEvents = await readJson(ownEventsResponse);
assert.ok(ownEventsResponse.ok && ownEvents.length >= 10);
const otherEventsResponse = await dataApi(`/capability_usage_events?profile_id=eq.${primaryProfile}&select=id`, other.token);
assert.deepEqual(await readJson(otherEventsResponse), [], "other tenant saw usage events");

const during = await controller("state");
assert.equal(during.qaUsers, 2);
assert.equal(during.qaProfiles, 2);
assert.equal(during.qaAssignments, 1);
assert.equal(during.qaEntitlements, 23);
assert.equal(during.qaAttempts, 6);
assert.equal(during.qaAiEvents, 1);
assert.equal(during.qaAudit, 1);

console.log("FASE_4F_PROVIDER_COST_RUNTIME: PASS", JSON.stringify({
  packageLifecycle: initial.packageLifecycle,
  packageCapUsd: initial.packageCap,
  mappedEntitlements: provisioned.mapped,
  enabledEntitlements: provisioned.enabled,
  exactCapAccountedUsd: fill.accountedUsd,
  providerAttempts: fill.attempts,
  idempotency: fill.duplicateAttempt,
  technicalReconciliation: fill.reconciled === 1,
  releaseConservative: fill.releasedAttemptRetained === 1,
  denials: denials.denialCodes.length,
  providerStartsOnDenial: denials.providerStartsAfterDenial,
  tenantIsolation: true,
  directCustomerLedgerAccess: false,
}));
