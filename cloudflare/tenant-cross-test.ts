import { neon } from "@neondatabase/serverless";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

type CrossTenantEnv = {
  DATABASE_URL?: string;
  TENANT_CROSS_TEST_TOKEN?: string;
  APP_BASE_URL?: string;
};

type Fixture = {
  userId: string;
  jwt: string;
  profileId: string;
  profileName: string;
};

type FixtureState = Partial<Fixture> & { email?: string };
type Check = { name: string; pass: boolean };
type JsonRecord = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function secureEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function authorized(request: Request, secret?: string) {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  return secureEquals(header, `Bearer ${secret}`);
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `Qa9!${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function isJwt(value: unknown): value is string {
  return typeof value === "string" && value.split(".").length === 3 && value.length > 80;
}

function findJwt(value: unknown, depth = 0): string | null {
  if (depth > 5) return null;
  if (isJwt(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    if (["access_token", "accessToken", "jwt"].includes(key) && isJwt(child)) return child;
  }
  for (const child of Object.values(value as JsonRecord)) {
    const nested = findJwt(child, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function authUserId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const root = value as JsonRecord;
  const directUser = root.user && typeof root.user === "object" ? root.user as JsonRecord : null;
  const data = root.data && typeof root.data === "object" ? root.data as JsonRecord : null;
  const nestedUser = data?.user && typeof data.user === "object" ? data.user as JsonRecord : null;
  const id = directUser?.id ?? nestedUser?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function jwtSubject(token: string) {
  try {
    const segment = token.split(".")[1];
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((segment.length + 3) % 4);
    const payload = JSON.parse(atob(normalized)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

function sessionCookie(response: Response) {
  const raw = response.headers.get("set-cookie") ?? "";
  const match = raw.match(/(?:^|,\s*)((?:__Secure-)?(?:neonauth|better-auth)\.session_token=[^;,]+)/i);
  return match?.[1] ?? null;
}

async function parsed(response: Response): Promise<unknown> {
  try { return await response.clone().json(); }
  catch { return null; }
}

async function authPost(path: string, body: JsonRecord, origin: string) {
  return fetch(`${AUTH_URL}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", origin, referer: `${origin}/` },
    body: JSON.stringify(body),
  });
}

async function jwtFromCookie(cookie: string | null, origin: string) {
  if (!cookie) return null;
  for (const method of ["GET", "POST"] as const) {
    const response = await fetch(`${AUTH_URL}/token`, {
      method,
      headers: { accept: "application/json", cookie, origin, referer: `${origin}/` },
    });
    if (!response.ok) continue;
    const token = findJwt(await parsed(response));
    if (token) return token;
  }
  return null;
}

async function createIdentity(label: string, origin: string, state: FixtureState) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const email = `tenant-${label.toLowerCase()}-${nonce}@example.com`;
  const password = randomPassword();
  const name = `Tenant QA ${label}`;
  state.email = email;

  const signup = await authPost("sign-up/email", { name, email, password }, origin);
  if (!signup.ok) throw new Error(`AUTH_SIGNUP_${label}_${signup.status}`);
  const signupBody = await parsed(signup);
  state.userId = authUserId(signupBody) ?? state.userId;
  let jwt = findJwt(signupBody) ?? await jwtFromCookie(sessionCookie(signup), origin);

  if (!jwt) {
    const signin = await authPost("sign-in/email", { email, password }, origin);
    if (!signin.ok) throw new Error(`AUTH_SIGNIN_${label}_${signin.status}`);
    const signinBody = await parsed(signin);
    state.userId = authUserId(signinBody) ?? state.userId;
    jwt = findJwt(signinBody) ?? await jwtFromCookie(sessionCookie(signin), origin);
  }

  if (!jwt) throw new Error(`AUTH_JWT_${label}_MISSING`);
  const userId = jwtSubject(jwt) ?? state.userId;
  if (!userId) throw new Error(`AUTH_SUB_${label}_MISSING`);
  state.userId = userId;
  state.jwt = jwt;
  return { jwt, userId };
}

async function dataApi(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${DATA_API}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function responseRows(response: Response): Promise<JsonRecord[]> {
  if (!response.ok) return [];
  const body = await parsed(response);
  return Array.isArray(body) ? body.filter((row): row is JsonRecord => Boolean(row) && typeof row === "object") : [];
}

async function ownRows(token: string, table: string, profileId: string, select = "profile_id") {
  return responseRows(await dataApi(token, `${table}?profile_id=eq.${encodeURIComponent(profileId)}&select=${select}`));
}

async function profileRows(token: string, profileId: string, select = "id,name") {
  return responseRows(await dataApi(token, `profiles?id=eq.${encodeURIComponent(profileId)}&select=${select}`));
}

async function createFixture(label: string, origin: string, state: FixtureState): Promise<Fixture> {
  const identity = await createIdentity(label, origin, state);
  const profileName = `Tenant QA ${label} ${crypto.randomUUID().slice(0, 8)}`;
  state.profileName = profileName;
  const insert = await dataApi(identity.jwt, "profiles?select=id,name", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      name: profileName,
      slug: `tenant-qa-${label.toLowerCase()}-${crypto.randomUUID().slice(0, 12)}`,
      website_url: null,
      industry: "QA security",
    }),
  });
  if (!insert.ok) throw new Error(`PROFILE_CREATE_${label}_${insert.status}`);
  const rows = await responseRows(insert);
  const profileId = typeof rows[0]?.id === "string" ? rows[0].id : null;
  if (!profileId) throw new Error(`PROFILE_CREATE_${label}_NO_ID`);
  state.profileId = profileId;

  const member = await ownRows(identity.jwt, "profile_members", profileId, "profile_id");
  if (member.length !== 1) throw new Error(`PROFILE_MEMBERSHIP_${label}_MISSING`);

  const brand = await dataApi(identity.jwt, "brand_profiles?select=profile_id,description", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ profile_id: profileId, description: `private-${label}` }),
  });
  if (!brand.ok || (await responseRows(brand)).length !== 1) throw new Error(`BRAND_CREATE_${label}_${brand.status}`);

  return { ...identity, profileId, profileName };
}

function check(checks: Check[], name: string, pass: boolean) {
  checks.push({ name, pass });
}

async function crossReadChecks(actor: Fixture, target: Fixture, actorLabel: string, targetLabel: string, checks: Check[]) {
  check(checks, `${actorLabel}_cannot_read_${targetLabel}_profile`, (await profileRows(actor.jwt, target.profileId)).length === 0);
  check(checks, `${actorLabel}_cannot_read_${targetLabel}_membership`, (await ownRows(actor.jwt, "profile_members", target.profileId)).length === 0);
  check(checks, `${actorLabel}_cannot_read_${targetLabel}_brand`, (await ownRows(actor.jwt, "brand_profiles", target.profileId, "profile_id,description")).length === 0);
}

async function crossWriteChecks(actor: Fixture, target: Fixture, actorLabel: string, targetLabel: string, checks: Check[]) {
  const changedName = `forbidden-${actorLabel}-${crypto.randomUUID().slice(0, 6)}`;
  const profilePatch = await dataApi(actor.jwt, `profiles?id=eq.${encodeURIComponent(target.profileId)}&select=id`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name: changedName }),
  });
  const patchedProfiles = await responseRows(profilePatch);
  const ownerProfile = await profileRows(target.jwt, target.profileId, "id,name");
  check(checks, `${actorLabel}_cannot_update_${targetLabel}_profile`, patchedProfiles.length === 0 && ownerProfile.length === 1 && ownerProfile[0]?.name === target.profileName);

  const brandPatch = await dataApi(actor.jwt, `brand_profiles?profile_id=eq.${encodeURIComponent(target.profileId)}&select=profile_id`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ description: `forbidden-${actorLabel}` }),
  });
  const patchedBrands = await responseRows(brandPatch);
  const ownerBrand = await ownRows(target.jwt, "brand_profiles", target.profileId, "profile_id,description");
  check(checks, `${actorLabel}_cannot_update_${targetLabel}_brand`, patchedBrands.length === 0 && ownerBrand.length === 1 && ownerBrand[0]?.description === `private-${targetLabel}`);

  const brandDelete = await dataApi(actor.jwt, `brand_profiles?profile_id=eq.${encodeURIComponent(target.profileId)}&select=profile_id`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  const deletedBrands = await responseRows(brandDelete);
  const brandAfterDelete = await ownRows(target.jwt, "brand_profiles", target.profileId, "profile_id");
  check(checks, `${actorLabel}_cannot_delete_${targetLabel}_brand`, deletedBrands.length === 0 && brandAfterDelete.length === 1);

  const profileDelete = await dataApi(actor.jwt, `profiles?id=eq.${encodeURIComponent(target.profileId)}&select=id`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  const deletedProfiles = await responseRows(profileDelete);
  const profileAfterDelete = await profileRows(target.jwt, target.profileId, "id");
  check(checks, `${actorLabel}_cannot_delete_${targetLabel}_profile`, deletedProfiles.length === 0 && profileAfterDelete.length === 1);
}

export function evaluateCrossTenantChecks(checks: Check[], cleanupOk: boolean) {
  return cleanupOk && checks.length >= 16 && checks.every((item) => item.pass);
}

async function resolveUserId(sql: ReturnType<typeof neon>, state: FixtureState) {
  if (state.userId) return state.userId;
  if (!state.email) return null;
  const rows = await sql`select id from neon_auth.user where email = ${state.email} limit 1` as Array<{ id: string }>;
  return typeof rows[0]?.id === "string" ? rows[0].id : null;
}

async function cleanupFixture(sql: ReturnType<typeof neon>, state: FixtureState) {
  if (state.profileId) {
    await sql`delete from public.brand_profiles where profile_id = ${state.profileId}`;
    await sql`delete from public.profile_members where profile_id = ${state.profileId}`;
    await sql`delete from public.profiles where id = ${state.profileId}`;
  }
  const userId = await resolveUserId(sql, state);
  if (userId) {
    state.userId = userId;
    await sql`delete from neon_auth.session where "userId" = ${userId}`;
    await sql`delete from neon_auth.account where "userId" = ${userId}`;
    await sql`delete from neon_auth.user where id = ${userId}`;
  }
}

async function verifyCleanup(sql: ReturnType<typeof neon>, state: FixtureState) {
  if (state.profileId) {
    const profiles = await sql`select count(*)::int as count from public.profiles where id = ${state.profileId}` as Array<{ count: number | string }>;
    if (Number(profiles[0]?.count ?? 1) !== 0) return false;
  }
  if (state.email) {
    const users = await sql`select count(*)::int as count from neon_auth.user where email = ${state.email}` as Array<{ count: number | string }>;
    if (Number(users[0]?.count ?? 1) !== 0) return false;
  }
  return true;
}

export async function handleTenantCrossTest(request: Request, env: CrossTenantEnv) {
  if (request.method !== "POST") return json({ error: "API_NOT_FOUND" }, 404);
  if (!authorized(request, env.TENANT_CROSS_TEST_TOKEN)) return json({ error: "API_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return json({ ready: false, error: "DATABASE_NOT_CONFIGURED" }, 503);

  const origin = (() => {
    try { return new URL(env.APP_BASE_URL || "https://autoposter.02alessandrocaruso.workers.dev").origin; }
    catch { return "https://autoposter.02alessandrocaruso.workers.dev"; }
  })();
  const sql = neon(env.DATABASE_URL);
  const checks: Check[] = [];
  const aState: FixtureState = {};
  const bState: FixtureState = {};
  let executionError: string | null = null;
  let cleanupOk = false;

  try {
    const a = await createFixture("A", origin, aState);
    const b = await createFixture("B", origin, bState);

    check(checks, "A_can_read_own_profile", (await profileRows(a.jwt, a.profileId)).length === 1);
    check(checks, "B_can_read_own_profile", (await profileRows(b.jwt, b.profileId)).length === 1);

    await crossReadChecks(a, b, "A", "B", checks);
    await crossReadChecks(b, a, "B", "A", checks);
    await crossWriteChecks(a, b, "A", "B", checks);
    await crossWriteChecks(b, a, "B", "A", checks);
  } catch (reason) {
    executionError = reason instanceof Error ? reason.message : "TENANT_CROSS_TEST_FAILED";
  } finally {
    try {
      await cleanupFixture(sql, aState);
      await cleanupFixture(sql, bState);
      cleanupOk = await verifyCleanup(sql, aState) && await verifyCleanup(sql, bState);
    } catch {
      cleanupOk = false;
    }
  }

  const ready = executionError === null && evaluateCrossTenantChecks(checks, cleanupOk);
  return json({
    service: "post-automatici",
    ready,
    scenario: "synthetic-tenant-a-vs-b",
    checks,
    cleanup: cleanupOk ? "PASS" : "FAIL",
    error: executionError,
  }, ready ? 200 : 503);
}
