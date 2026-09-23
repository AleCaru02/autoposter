import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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
  owner: `audit-smoke-${marker}-customer@example.invalid`,
  outsider: `audit-smoke-${marker}-admin@example.invalid`,
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
  header() { return [...this.values.entries()].map(([key, value]) => `${key}=${value}`).join("; "); }
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { invalidJson: true, text: text.slice(0, 120) }; }
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
  return { token, id: decodeSub(token) };
}

async function dataApi(path, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${DATA_API}${path}`, { ...init, headers });
}

async function waitForDataApiIdentity(token, expectedId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await dataApi("/rpc/current_auth_user_id", token, { method: "POST", body: "{}" });
    const body = await readJson(response);
    const identity = typeof body === "string" ? body : Array.isArray(body) ? body[0] : body?.current_auth_user_id;
    if (response.ok && identity === expectedId) return;
    await sleep(500);
  }
  throw new Error("Data API did not recognize freshly authenticated identity");
}

async function appApi(path, token, payload, expected) {
  const response = await fetch(`${APP_BASE}${path}`, {
    method: "POST",
    headers: { accept: "application/json", authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  assert.equal(response.status, expected, `${path} expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`);
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

async function provision(identity, label) {
  const body = await appApi("/api/onboarding-provision", identity.token, {
    operationId: randomUUID(),
    name: `Fase 7A ${label} ${marker}`,
    websiteUrl: null,
    industry: "Servizi professionali",
  }, 201);
  assert.equal(body?.profile?.onboarding_completed, false);
  await appApi("/api/onboarding-complete", identity.token, { profileId: body.profile.id }, 200);
  return body.profile;
}

const baseline = await controller("preflight");
for (const key of ["qaUsers", "qaProfiles", "qaBrandProfiles", "qaOwners", "qaSessions", "qaAdmins"]) assert.equal(baseline[key], 0, `preflight residue ${key}`);
assert.equal(baseline.superAdmins, 1);
assert.equal(baseline.profilesWithoutOwner, 0);

const owner = await signUp(emails.owner, "Fase 7A Owner");
const outsider = await signUp(emails.outsider, "Fase 7A Outsider");
await waitForDataApiIdentity(owner.token, owner.id);
await waitForDataApiIdentity(outsider.token, outsider.id);

const ownerProfile = await provision(owner, "Owner");
const outsiderProfile = await provision(outsider, "Outsider");
assert.notEqual(ownerProfile.id, outsiderProfile.id);

const inserted = await dataApi("/brand_profiles?select=profile_id", owner.token, {
  method: "POST",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({
    profile_id: ownerProfile.id,
    description: `Descrizione iniziale ${marker}`,
    business_model: "Consulenza",
    location: "Milano",
    service_area: "Italia",
    target_audience: { summary: "PMI", segments: ["Retail"] },
    tone_of_voice: { summary: "Professionale", traits: ["Chiaro"] },
    goals: ["Più richieste"],
    services: ["Consulenza iniziale"],
    differentiators: ["Metodo proprietario"],
    value_propositions: ["Più semplicità"],
    visual_identity: { observedColors: ["#16c55f"], summary: "Pulito" },
  }),
});
assert.equal(inserted.status, 201, `owner brand insert failed (${inserted.status})`);

const ownRead = await dataApi(`/brand_profiles?profile_id=eq.${encodeURIComponent(ownerProfile.id)}&select=profile_id,services,target_audience`, owner.token);
const ownRows = await readJson(ownRead);
assert.ok(ownRead.ok && ownRows?.[0]?.profile_id === ownerProfile.id, "owner cannot read own brand");

const crossRead = await dataApi(`/brand_profiles?profile_id=eq.${encodeURIComponent(ownerProfile.id)}&select=profile_id`, outsider.token);
assert.deepEqual(await readJson(crossRead), [], "outsider read another tenant brand");
const crossUpdate = await dataApi(`/brand_profiles?profile_id=eq.${encodeURIComponent(ownerProfile.id)}&select=profile_id`, outsider.token, {
  method: "PATCH",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({ description: "cross-tenant write" }),
});
assert.ok(crossUpdate.ok, `RLS-filtered cross update returned unexpected transport error ${crossUpdate.status}`);
assert.deepEqual(await readJson(crossUpdate), [], "outsider updated another tenant brand");

const dashboard = await fetch(`${APP_BASE}/app/dashboard`, { headers: { accept: "text/html" }, redirect: "manual" });
assert.equal(dashboard.status, 200, "dashboard direct document route unavailable");
assert.match(dashboard.headers.get("content-type") || "", /text\/html/i);

const during = await controller("state");
assert.equal(during.qaUsers, 2);
assert.equal(during.qaProfiles, 2);
assert.equal(during.qaBrandProfiles, 1);
assert.equal(during.qaOwners, 2);
assert.equal(during.qaAdmins, 0);
assert.equal(during.superAdmins, 1);
assert.equal(during.profilesWithoutOwner, 0);

console.log("FASE7A_API_RUNTIME: PASS", JSON.stringify({
  serverSideProvisioning: "PASS",
  onboardingCompletion: "PASS",
  ownBrandReadWrite: "PASS",
  tenantIsolation: "PASS",
  directDashboardSpa: "PASS",
  qaProfiles: during.qaProfiles,
  qaBrandProfiles: during.qaBrandProfiles,
}));
