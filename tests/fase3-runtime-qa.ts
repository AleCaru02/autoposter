import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.FASE3_QA_MARKER || "";
const password = process.env.FASE3_QA_PASSWORD || "";
const qaSecret = process.env.FASE3_QA_TOKEN_VALUE || "";

assert.match(marker, /^[a-z0-9]{8,40}$/, "FASE3_QA_MARKER missing/invalid");
assert.ok(password.length >= 16, "FASE3_QA_PASSWORD missing/too short");
assert.ok(qaSecret.length >= 32, "FASE3_QA_TOKEN_VALUE missing");

const emails = {
  customerA: `fase3-qa-${marker}-customer-a@example.invalid`,
  customerB: `fase3-qa-${marker}-customer-b@example.invalid`,
  admin: `fase3-qa-${marker}-admin@example.invalid`,
};

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

type Identity = { email: string; jar: CookieJar; token: string; id: string };

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

async function signUp(email: string, name: string): Promise<Identity> {
  const jar = new CookieJar();
  const signup = await authFetch(jar, "/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
  const signupBody = await readJson(signup);
  assert.ok(signup.ok, `QA signup failed (${signup.status}): ${JSON.stringify(signupBody)}`);
  const tokenResponse = await authFetch(jar, "/token");
  const tokenBody = await readJson(tokenResponse) as { token?: string; data?: { token?: string } } | null;
  assert.ok(tokenResponse.ok, `QA token failed (${tokenResponse.status})`);
  const token = tokenBody?.token ?? tokenBody?.data?.token ?? "";
  assert.ok(token.length > 40, "QA JWT missing");
  return { email, jar, token, id: decodeSub(token) };
}

async function signIn(email: string): Promise<Identity> {
  const jar = new CookieJar();
  const signin = await authFetch(jar, "/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const signinBody = await readJson(signin);
  assert.ok(signin.ok, `QA sign-in failed (${signin.status}): ${JSON.stringify(signinBody)}`);
  const tokenResponse = await authFetch(jar, "/token");
  const tokenBody = await readJson(tokenResponse) as { token?: string; data?: { token?: string } } | null;
  const token = tokenBody?.token ?? tokenBody?.data?.token ?? "";
  assert.ok(tokenResponse.ok && token.length > 40, "QA JWT missing after sign-in");
  return { email, jar, token, id: decodeSub(token) };
}

async function dataApi(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${DATA_API}${path}`, { ...init, headers });
}

async function createProfile(identity: Identity, suffix: "a" | "b", completed: boolean) {
  const response = await dataApi("/profiles?select=id,name,owner_auth_user_id,onboarding_completed", identity.token, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      name: `FASE3 QA ${suffix.toUpperCase()} ${marker}`,
      slug: `fase3-qa-${marker}-${suffix}`,
      owner_auth_user_id: identity.id,
      onboarding_completed: completed,
    }),
  });
  const body = await readJson(response) as Array<{ id?: string; owner_auth_user_id?: string }> | null;
  assert.ok(response.ok, `QA profile create failed (${response.status}): ${JSON.stringify(body)}`);
  assert.equal(body?.[0]?.owner_auth_user_id, identity.id);
  assert.equal(typeof body?.[0]?.id, "string");
  return body![0].id!;
}

async function qaControl(action: "promote_admin" | "state", expected = 200) {
  const response = await fetch(`${APP_BASE}/api/internal/fase3/qa-control`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-fase3-qa-token": qaSecret },
    body: JSON.stringify({ action, marker }),
  });
  const body = await readJson(response);
  assert.equal(response.status, expected, `QA control ${action} failed: ${JSON.stringify(body)}`);
  return body as any;
}

async function adminApi(path: string, token: string, expected: number) {
  const response = await fetch(`${APP_BASE}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  const body = await readJson(response);
  assert.equal(response.status, expected, `${path} expected ${expected}, got ${response.status}: ${JSON.stringify(body)}`);
  return body as any;
}

async function plugin(identity: Identity, path: string, init: RequestInit = {}) {
  const response = await authFetch(identity.jar, path, init);
  const body = await readJson(response);
  return { status: response.status, body };
}

function assertCustomerDenied(status: number, label: string) {
  assert.ok(status === 401 || status === 403, `${label} must be 401/403, got ${status}`);
}

function assertNoSensitiveKeys(value: unknown, path = "root") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`)); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase();
    assert.ok(!["password", "jwt", "cookie", "secret", "access_token", "refresh_token", "api_key", "accesstoken", "refreshtoken", "apikey"].includes(normalized), `sensitive key exposed at ${path}.${key}`);
    assertNoSensitiveKeys(child, `${path}.${key}`);
  }
}

const customerA = await signUp(emails.customerA, "FASE3 QA Customer A");
const customerB = await signUp(emails.customerB, "FASE3 QA Customer B");
const adminCandidate = await signUp(emails.admin, "FASE3 QA Admin");
const profileA = await createProfile(customerA, "a", true);
const profileB = await createProfile(customerB, "b", false);

for (const identity of [customerA, customerB]) {
  await adminApi("/api/admin/me", identity.token, 403);
  await adminApi("/api/admin/overview", identity.token, 403);
  await adminApi("/api/admin/customers", identity.token, 403);
  await adminApi(`/api/admin/customers/${encodeURIComponent(identity.id)}`, identity.token, 403);
  await adminApi("/api/admin/activities", identity.token, 403);
}
await adminApi(`/api/admin/me?role=admin&userId=${encodeURIComponent(adminCandidate.id)}`, customerA.token, 403);
const roleBodyAttempt = await fetch(`${APP_BASE}/api/admin/me`, {
  method: "POST",
  headers: { authorization: `Bearer ${customerA.token}`, "content-type": "application/json" },
  body: JSON.stringify({ role: "admin", userId: adminCandidate.id }),
});
assert.ok(roleBodyAttempt.status === 403 || roleBodyAttempt.status === 405, `role body escalation was not denied: ${roleBodyAttempt.status}`);

const setOwnRole = await plugin(customerA, "/admin/set-role", { method: "POST", body: JSON.stringify({ userId: customerA.id, role: "admin" }) });
assertCustomerDenied(setOwnRole.status, "CUSTOMER set-role self");
const setOtherRole = await plugin(customerA, "/admin/set-role", { method: "POST", body: JSON.stringify({ userId: adminCandidate.id, role: "admin" }) });
assertCustomerDenied(setOtherRole.status, "CUSTOMER set-role other");
const banOther = await plugin(customerA, "/admin/ban-user", { method: "POST", body: JSON.stringify({ userId: customerB.id, banReason: "QA denied" }) });
assertCustomerDenied(banOther.status, "CUSTOMER ban-user");
const listOtherSessions = await plugin(customerA, "/admin/list-user-sessions", { method: "POST", body: JSON.stringify({ userId: customerB.id }) });
assertCustomerDenied(listOtherSessions.status, "CUSTOMER list-user-sessions");
const revokeOtherSessions = await plugin(customerA, "/admin/revoke-user-sessions", { method: "POST", body: JSON.stringify({ userId: customerB.id }) });
assertCustomerDenied(revokeOtherSessions.status, "CUSTOMER revoke-user-sessions");
const impersonate = await plugin(customerA, "/admin/impersonate-user", { method: "POST", body: JSON.stringify({ userId: customerB.id }) });
assertCustomerDenied(impersonate.status, "CUSTOMER impersonate-user");
const stopImpersonating = await plugin(customerA, "/admin/stop-impersonating", { method: "POST", body: "{}" });
assertCustomerDenied(stopImpersonating.status, "CUSTOMER stop-impersonating");

const membershipAttempt = await dataApi(`/profile_members?profile_id=eq.${encodeURIComponent(profileA)}`, customerA.token, {
  method: "PATCH",
  headers: { prefer: "return=representation" },
  body: JSON.stringify({ role: "SUPER_ADMIN" }),
});
const membershipRowsResponse = await dataApi(`/profile_members?profile_id=eq.${encodeURIComponent(profileA)}&select=role`, customerA.token);
const membershipRows = await readJson(membershipRowsResponse) as Array<{ role?: string }>;
assert.ok(membershipRowsResponse.ok);
assert.deepEqual(membershipRows.map((row) => row.role), ["OWNER"], `workspace role changed after escalation attempt (PATCH status ${membershipAttempt.status})`);

for (const [method, body] of [["GET", undefined], ["POST", { actor_auth_user_id: customerA.id, action: "FORGED" }], ["PATCH", { action: "FORGED" }], ["DELETE", undefined]] as const) {
  const query = method === "GET" ? "?select=*" : method === "PATCH" || method === "DELETE" ? "?action=eq.INITIAL_SUPER_ADMIN_BOOTSTRAP" : "";
  const response = await dataApi(`/platform_admin_audit${query}`, customerA.token, { method, body: body ? JSON.stringify(body) : undefined });
  assert.ok(!response.ok, `CUSTOMER platform_admin_audit ${method} unexpectedly allowed (${response.status})`);
}

await qaControl("promote_admin");
const admin = await signIn(emails.admin);
assert.equal(admin.id, adminCandidate.id);

const me = await adminApi("/api/admin/me", admin.token, 200);
assert.equal(me.platformRole, "SUPER_ADMIN");
const overviewBody = await adminApi("/api/admin/overview", admin.token, 200);
const customersBody = await adminApi("/api/admin/customers", admin.token, 200);
const activitiesBody = await adminApi("/api/admin/activities", admin.token, 200);
const customerADetail = await adminApi(`/api/admin/customers/${encodeURIComponent(customerA.id)}`, admin.token, 200);
const customerBDetail = await adminApi(`/api/admin/customers/${encodeURIComponent(customerB.id)}`, admin.token, 200);
await adminApi(`/api/admin/customers/fase3-qa-nonexistent-${marker}`, admin.token, 404);

for (const body of [overviewBody, customersBody, activitiesBody, customerADetail, customerBDetail]) assertNoSensitiveKeys(body);
assert.ok(customersBody.customers.some((row: any) => row.auth_user_id === customerA.id && row.platform_role === "CUSTOMER"));
assert.ok(customersBody.customers.some((row: any) => row.auth_user_id === customerB.id && row.platform_role === "CUSTOMER"));
assert.ok(customersBody.customers.some((row: any) => row.auth_user_id === admin.id && row.platform_role === "SUPER_ADMIN" && Number(row.profile_count) === 0));
assert.ok(customerADetail.profiles.some((row: any) => row.id === profileA));
assert.ok(customerBDetail.profiles.some((row: any) => row.id === profileB));
assert.ok(customerADetail.memberships.some((row: any) => row.profile_id === profileA && row.role === "OWNER"));
assert.ok(customerBDetail.memberships.some((row: any) => row.profile_id === profileB && row.role === "OWNER"));
assert.ok(activitiesBody.activities.some((row: any) => row.id === profileA));
assert.ok(activitiesBody.activities.some((row: any) => row.id === profileB));

const pluginList = await plugin(admin, "/admin/list-users?limit=10");
assert.ok(pluginList.status >= 200 && pluginList.status < 300, `SUPER_ADMIN list-users failed: ${pluginList.status}`);
const pluginSessions = await plugin(admin, "/admin/list-user-sessions", { method: "POST", body: JSON.stringify({ userId: customerB.id }) });
assert.ok(pluginSessions.status >= 200 && pluginSessions.status < 300, `SUPER_ADMIN list-user-sessions failed: ${pluginSessions.status}`);
const pluginBan = await plugin(admin, "/admin/ban-user", { method: "POST", body: JSON.stringify({ userId: customerB.id, banReason: "FASE3 QA", banExpiresIn: 60 }) });
assert.ok(pluginBan.status >= 200 && pluginBan.status < 300, `SUPER_ADMIN ban-user failed: ${pluginBan.status}`);
const bannedSignin = await authFetch(new CookieJar(), "/sign-in/email", { method: "POST", body: JSON.stringify({ email: emails.customerB, password }) });
assert.ok(!bannedSignin.ok, `banned QA customer unexpectedly signed in (${bannedSignin.status})`);
const pluginUnban = await plugin(admin, "/admin/unban-user", { method: "POST", body: JSON.stringify({ userId: customerB.id }) });
assert.ok(pluginUnban.status >= 200 && pluginUnban.status < 300, `SUPER_ADMIN unban-user failed: ${pluginUnban.status}`);
await signIn(emails.customerB);
const pluginRevoke = await plugin(admin, "/admin/revoke-user-sessions", { method: "POST", body: JSON.stringify({ userId: customerB.id }) });
assert.ok(pluginRevoke.status >= 200 && pluginRevoke.status < 300, `SUPER_ADMIN revoke-user-sessions failed: ${pluginRevoke.status}`);

const controlState = await qaControl("state");
assert.equal(controlState.qaUsers, 3);
assert.equal(controlState.qaAdmins, 1);
assert.equal(controlState.qaProfiles, 2);
assert.equal(controlState.qaOwners, 2);
assert.equal(Number(controlState.metrics.super_admins), 2, "expected real SUPER_ADMIN + QA SUPER_ADMIN during test");
assert.equal(Number(controlState.metrics.bootstrap_audit), 1);
assert.deepEqual(overviewBody.overview, {
  users_total: Number(controlState.metrics.users_total),
  profiles_total: Number(controlState.metrics.profiles_total),
  onboarding_completed: Number(controlState.metrics.onboarding_completed),
  onboarding_incomplete: Number(controlState.metrics.onboarding_incomplete),
  social_connections_total: Number(controlState.metrics.social_connections_total),
});
const protection = controlState.auditProtection;
assert.equal(protection.rls_enabled, true);
for (const key of ["authenticated_select", "authenticated_insert", "authenticated_update", "authenticated_delete", "anonymous_select", "anonymous_insert", "anonymous_update", "anonymous_delete"]) assert.equal(protection[key], false, `audit privilege ${key} must be false`);
for (const action of ["ADMIN_ACCESS", "ADMIN_OVERVIEW_VIEW", "ADMIN_CUSTOMERS_LIST", "ADMIN_CUSTOMER_DETAIL_VIEW", "ADMIN_ACTIVITIES_LIST"]) assert.ok(Number(controlState.qaAuditActions[action] ?? 0) >= 1, `missing runtime audit action ${action}`);

const adminHtmlResponse = await fetch(`${APP_BASE}/admin`, { headers: { accept: "text/html" } });
const adminHtml = await adminHtmlResponse.text();
assert.equal(adminHtmlResponse.status, 200);
assert.ok(!adminHtml.includes("Post Automatici</strong><span>Backoffice") && !adminHtml.includes("Dati reali letti dal database di produzione"), "admin data must not be server-rendered into unauthenticated HTML");

console.log("FASE3_RUNTIME_QA: PASS", JSON.stringify({
  customerAdminApiDenied: true,
  ownerAdminDenied: true,
  customerRoleEscalationDenied: true,
  customerAdminPluginDenied: true,
  superAdminApi: true,
  adminPluginListSessions: true,
  adminPluginBanUnban: true,
  adminPluginRevokeSessions: true,
  adminDataMatchesDatabase: true,
  auditRuntime: true,
  auditCustomerDenied: true,
  profilesTested: 2,
  overview: overviewBody.overview,
}));
