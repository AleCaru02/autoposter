import { neon } from "@neondatabase/serverless";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

type CrossTenantEnv = {
  DATABASE_URL?: string;
  TENANT_CROSS_TEST_TOKEN?: string;
};

type IdentityInput = {
  email?: unknown;
  jwt?: unknown;
};

type TestPayload = {
  mode?: unknown;
  a?: IdentityInput;
  b?: IdentityInput;
};

type Fixture = {
  userId: string;
  jwt: string;
  email: string;
  profileId: string;
  profileName: string;
  membershipUserId: string;
  brandId: string | null;
};

type FixtureState = Partial<Fixture>;
type Check = { name: string; pass: boolean };
type JsonRecord = Record<string, unknown>;
type QueryResult = { ok: boolean; status: number; rows: JsonRecord[] };

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
  return secureEquals(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

function isJwt(value: unknown): value is string {
  return typeof value === "string" && value.length > 80 && value.split(".").length === 3;
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

function validQaEmail(value: unknown) {
  return typeof value === "string" && /^tenant-[ab]-[a-f0-9]+@example\.com$/i.test(value) ? value : null;
}

async function requestPayload(request: Request): Promise<TestPayload> {
  try {
    const value = await request.json();
    return value && typeof value === "object" ? value as TestPayload : {};
  } catch {
    return {};
  }
}

async function parsed(response: Response): Promise<unknown> {
  try { return await response.clone().json(); }
  catch { return null; }
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

async function query(token: string, path: string, init: RequestInit = {}): Promise<QueryResult> {
  const response = await dataApi(token, path, init);
  const body = await parsed(response);
  const rows = Array.isArray(body)
    ? body.filter((row): row is JsonRecord => Boolean(row) && typeof row === "object")
    : [];
  return { ok: response.ok, status: response.status, rows };
}

async function ownRows(token: string, table: string, profileId: string, select = "profile_id") {
  return query(token, `${table}?profile_id=eq.${encodeURIComponent(profileId)}&select=${encodeURIComponent(select)}`);
}

async function profileRows(token: string, profileId: string, select = "id,name") {
  return query(token, `profiles?id=eq.${encodeURIComponent(profileId)}&select=${encodeURIComponent(select)}`);
}

async function membershipRows(token: string, profileId: string) {
  return ownRows(token, "profile_members", profileId, "profile_id,user_id,role");
}

function identity(input: IdentityInput | undefined, label: "A" | "B", state: FixtureState) {
  const email = validQaEmail(input?.email);
  const jwt = input?.jwt;
  if (!email) throw new Error(`AUTH_EMAIL_${label}_INVALID`);
  state.email = email;
  if (!isJwt(jwt)) throw new Error(`AUTH_JWT_${label}_MISSING`);
  const userId = jwtSubject(jwt);
  if (!userId) throw new Error(`AUTH_SUB_${label}_MISSING`);
  state.jwt = jwt;
  state.userId = userId;
  return { email, jwt, userId };
}

function rowId(row: JsonRecord | undefined) {
  return typeof row?.id === "string" && row.id.length > 0 ? row.id : null;
}

function exactOwnerMembership(result: QueryResult, expectedUserId: string) {
  return result.ok
    && result.rows.length === 1
    && result.rows[0]?.user_id === expectedUserId
    && String(result.rows[0]?.role ?? "").toUpperCase() === "OWNER";
}

function mutationDenied(result: QueryResult) {
  return !result.ok || result.rows.length === 0;
}

async function createFixture(input: IdentityInput | undefined, label: "A" | "B", state: FixtureState): Promise<Fixture> {
  const auth = identity(input, label, state);
  const profileName = `Tenant QA ${label} ${crypto.randomUUID().slice(0, 8)}`;
  state.profileName = profileName;

  const insert = await query(auth.jwt, "profiles?select=id,name,owner_user_id", {
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
  const profileId = typeof insert.rows[0]?.id === "string" ? insert.rows[0].id : null;
  if (!profileId) throw new Error(`PROFILE_CREATE_${label}_NO_ID`);
  state.profileId = profileId;

  const member = await membershipRows(auth.jwt, profileId);
  if (!member.ok || member.rows.length !== 1) throw new Error(`PROFILE_MEMBERSHIP_${label}_MISSING`);
  const membershipUserId = typeof member.rows[0]?.user_id === "string" ? member.rows[0].user_id : null;
  if (!membershipUserId || String(member.rows[0]?.role ?? "").toUpperCase() !== "OWNER") throw new Error(`PROFILE_MEMBERSHIP_${label}_INVALID`);
  if (insert.rows[0]?.owner_user_id !== membershipUserId) throw new Error(`PROFILE_OWNER_LINK_${label}_INVALID`);
  state.membershipUserId = membershipUserId;

  const brand = await query(auth.jwt, "brand_profiles?select=*", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ profile_id: profileId, description: `private-${label}` }),
  });
  if (!brand.ok || brand.rows.length !== 1) throw new Error(`BRAND_CREATE_${label}_${brand.status}`);
  const brandId = rowId(brand.rows[0]);
  state.brandId = brandId;

  return { ...auth, profileId, profileName, membershipUserId, brandId };
}

function check(checks: Check[], name: string, pass: boolean) {
  checks.push({ name, pass });
}

async function ownAccessChecks(actor: Fixture, label: "A" | "B", checks: Check[]) {
  const ownProfile = await profileRows(actor.jwt, actor.profileId, "id,name,owner_user_id");
  check(checks, `${label}_can_read_own_profile`, ownProfile.ok && ownProfile.rows.length === 1 && ownProfile.rows[0]?.owner_user_id === actor.membershipUserId);

  const ownMembership = await membershipRows(actor.jwt, actor.profileId);
  check(checks, `${label}_can_read_own_owner_membership`, exactOwnerMembership(ownMembership, actor.membershipUserId));

  const ownBrand = await ownRows(actor.jwt, "brand_profiles", actor.profileId, "profile_id,description");
  check(checks, `${label}_can_read_own_brand`, ownBrand.ok && ownBrand.rows.length === 1 && ownBrand.rows[0]?.description === `private-${label}`);

  const ownChangedName = `${actor.profileName} verified`;
  const ownProfilePatch = await query(actor.jwt, `profiles?id=eq.${encodeURIComponent(actor.profileId)}&select=id,name`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name: ownChangedName }),
  });
  check(checks, `${label}_can_update_own_profile`, ownProfilePatch.ok && ownProfilePatch.rows.length === 1 && ownProfilePatch.rows[0]?.name === ownChangedName);
  const restoreProfile = await query(actor.jwt, `profiles?id=eq.${encodeURIComponent(actor.profileId)}&select=id`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name: actor.profileName }),
  });
  if (!restoreProfile.ok || restoreProfile.rows.length !== 1) throw new Error(`PROFILE_RESTORE_${label}_FAILED`);

  const ownBrandPatch = await query(actor.jwt, `brand_profiles?profile_id=eq.${encodeURIComponent(actor.profileId)}&select=profile_id,description`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ description: `private-${label}-updated` }),
  });
  check(checks, `${label}_can_update_own_brand`, ownBrandPatch.ok && ownBrandPatch.rows.length === 1 && ownBrandPatch.rows[0]?.description === `private-${label}-updated`);

  const ownBrandDelete = await query(actor.jwt, `brand_profiles?profile_id=eq.${encodeURIComponent(actor.profileId)}&select=profile_id`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  const afterDelete = await ownRows(actor.jwt, "brand_profiles", actor.profileId, "profile_id");
  check(checks, `${label}_can_delete_own_permitted_brand`, ownBrandDelete.ok && ownBrandDelete.rows.length === 1 && afterDelete.ok && afterDelete.rows.length === 0);

  const recreateBrand = await query(actor.jwt, "brand_profiles?select=profile_id,description", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ profile_id: actor.profileId, description: `private-${label}` }),
  });
  if (!recreateBrand.ok || recreateBrand.rows.length !== 1) throw new Error(`BRAND_RECREATE_${label}_FAILED`);
}

async function crossReadChecks(actor: Fixture, target: Fixture, actorLabel: "A" | "B", targetLabel: "A" | "B", checks: Check[]) {
  const profile = await profileRows(actor.jwt, target.profileId, "id,name");
  check(checks, `${actorLabel}_cannot_read_${targetLabel}_profile_by_hostile_tenant_id`, profile.ok && profile.rows.length === 0);

  const membership = await membershipRows(actor.jwt, target.profileId);
  check(checks, `${actorLabel}_cannot_read_${targetLabel}_membership_by_altered_profile_id`, membership.ok && membership.rows.length === 0);

  const membershipByCompositeId = await query(actor.jwt, `profile_members?profile_id=eq.${encodeURIComponent(target.profileId)}&user_id=eq.${encodeURIComponent(target.membershipUserId)}&select=profile_id,user_id,role`);
  check(checks, `${actorLabel}_cannot_read_${targetLabel}_membership_by_known_resource_id`, membershipByCompositeId.ok && membershipByCompositeId.rows.length === 0);

  const brand = await ownRows(actor.jwt, "brand_profiles", target.profileId, "*");
  check(checks, `${actorLabel}_cannot_read_${targetLabel}_brand_by_altered_profile_id`, brand.ok && brand.rows.length === 0);

  if (target.brandId) {
    const brandById = await query(actor.jwt, `brand_profiles?id=eq.${encodeURIComponent(target.brandId)}&select=*`);
    check(checks, `${actorLabel}_cannot_read_${targetLabel}_brand_by_known_resource_id`, brandById.ok && brandById.rows.length === 0);
  } else {
    check(checks, `${actorLabel}_cannot_read_${targetLabel}_brand_by_known_resource_id`, true);
  }
}

async function crossWriteChecks(actor: Fixture, target: Fixture, actorLabel: "A" | "B", targetLabel: "A" | "B", checks: Check[]) {
  const changedName = `forbidden-${actorLabel}-${crypto.randomUUID().slice(0, 6)}`;
  const profilePatch = await query(actor.jwt, `profiles?id=eq.${encodeURIComponent(target.profileId)}&select=id`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ name: changedName }),
  });
  const ownerProfile = await profileRows(target.jwt, target.profileId, "id,name");
  check(
    checks,
    `${actorLabel}_cannot_update_${targetLabel}_profile_by_direct_api`,
    mutationDenied(profilePatch) && ownerProfile.ok && ownerProfile.rows.length === 1 && ownerProfile.rows[0]?.name === target.profileName,
  );

  const brandPatch = await query(actor.jwt, `brand_profiles?profile_id=eq.${encodeURIComponent(target.profileId)}&select=profile_id`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ description: `forbidden-${actorLabel}` }),
  });
  const ownerBrand = await ownRows(target.jwt, "brand_profiles", target.profileId, "profile_id,description");
  check(
    checks,
    `${actorLabel}_cannot_update_${targetLabel}_brand_by_direct_api`,
    mutationDenied(brandPatch) && ownerBrand.ok && ownerBrand.rows.length === 1 && ownerBrand.rows[0]?.description === `private-${targetLabel}`,
  );

  const brandDelete = await query(actor.jwt, `brand_profiles?profile_id=eq.${encodeURIComponent(target.profileId)}&select=profile_id`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  const brandAfterDelete = await ownRows(target.jwt, "brand_profiles", target.profileId, "profile_id");
  check(
    checks,
    `${actorLabel}_cannot_delete_${targetLabel}_brand_by_direct_api`,
    mutationDenied(brandDelete) && brandAfterDelete.ok && brandAfterDelete.rows.length === 1,
  );

  const profileDelete = await query(actor.jwt, `profiles?id=eq.${encodeURIComponent(target.profileId)}&select=id`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  const profileAfterDelete = await profileRows(target.jwt, target.profileId, "id");
  check(
    checks,
    `${actorLabel}_cannot_delete_${targetLabel}_profile_by_direct_api`,
    mutationDenied(profileDelete) && profileAfterDelete.ok && profileAfterDelete.rows.length === 1,
  );

  const hostileBrandCreate = await query(actor.jwt, "brand_profiles?select=profile_id", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ profile_id: target.profileId, description: `forbidden-create-${actorLabel}` }),
  });
  const targetBrands = await ownRows(target.jwt, "brand_profiles", target.profileId, "profile_id,description");
  check(
    checks,
    `${actorLabel}_cannot_create_resource_with_${targetLabel}_profile_id`,
    mutationDenied(hostileBrandCreate) && targetBrands.ok && targetBrands.rows.length === 1 && targetBrands.rows[0]?.description === `private-${targetLabel}`,
  );
}

async function membershipEscalationChecks(actor: Fixture, target: Fixture, actorLabel: "A" | "B", targetLabel: "A" | "B", checks: Check[]) {
  const joinTarget = await query(actor.jwt, "profile_members?select=profile_id,user_id,role", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ profile_id: target.profileId, user_id: actor.membershipUserId, role: "OWNER" }),
  });
  const targetAfterJoin = await membershipRows(target.jwt, target.profileId);
  check(checks, `${actorLabel}_cannot_join_${targetLabel}_profile`, mutationDenied(joinTarget) && exactOwnerMembership(targetAfterJoin, target.membershipUserId));

  const addOtherUser = await query(actor.jwt, "profile_members?select=profile_id,user_id,role", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ profile_id: actor.profileId, user_id: target.membershipUserId, role: "OWNER" }),
  });
  const actorAfterAddOther = await membershipRows(actor.jwt, actor.profileId);
  check(checks, `${actorLabel}_cannot_add_arbitrary_user_membership`, mutationDenied(addOtherUser) && exactOwnerMembership(actorAfterAddOther, actor.membershipUserId));

  const changeOwnRole = await query(actor.jwt, `profile_members?profile_id=eq.${encodeURIComponent(actor.profileId)}&user_id=eq.${encodeURIComponent(actor.membershipUserId)}&select=profile_id,user_id,role`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ role: "SUPER_ADMIN" }),
  });
  const actorAfterRole = await membershipRows(actor.jwt, actor.profileId);
  check(checks, `${actorLabel}_cannot_escalate_own_membership_role`, mutationDenied(changeOwnRole) && exactOwnerMembership(actorAfterRole, actor.membershipUserId));

  const moveOwnMembership = await query(actor.jwt, `profile_members?profile_id=eq.${encodeURIComponent(actor.profileId)}&user_id=eq.${encodeURIComponent(actor.membershipUserId)}&select=profile_id,user_id,role`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ profile_id: target.profileId }),
  });
  const actorAfterMove = await membershipRows(actor.jwt, actor.profileId);
  const targetAfterMove = await membershipRows(target.jwt, target.profileId);
  check(checks, `${actorLabel}_cannot_move_membership_to_${targetLabel}_profile`, mutationDenied(moveOwnMembership) && exactOwnerMembership(actorAfterMove, actor.membershipUserId) && exactOwnerMembership(targetAfterMove, target.membershipUserId));

  const changeTargetRole = await query(actor.jwt, `profile_members?profile_id=eq.${encodeURIComponent(target.profileId)}&user_id=eq.${encodeURIComponent(target.membershipUserId)}&select=profile_id,user_id,role`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ role: "OWNER" }),
  });
  const targetAfterRole = await membershipRows(target.jwt, target.profileId);
  check(checks, `${actorLabel}_cannot_modify_${targetLabel}_membership`, mutationDenied(changeTargetRole) && exactOwnerMembership(targetAfterRole, target.membershipUserId));

  const deleteTargetMembership = await query(actor.jwt, `profile_members?profile_id=eq.${encodeURIComponent(target.profileId)}&user_id=eq.${encodeURIComponent(target.membershipUserId)}&select=profile_id,user_id`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  const targetAfterMembershipDelete = await membershipRows(target.jwt, target.profileId);
  check(checks, `${actorLabel}_cannot_delete_${targetLabel}_membership`, mutationDenied(deleteTargetMembership) && exactOwnerMembership(targetAfterMembershipDelete, target.membershipUserId));

  const deleteOwnMembership = await query(actor.jwt, `profile_members?profile_id=eq.${encodeURIComponent(actor.profileId)}&user_id=eq.${encodeURIComponent(actor.membershipUserId)}&select=profile_id,user_id`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
  const actorAfterMembershipDelete = await membershipRows(actor.jwt, actor.profileId);
  check(checks, `${actorLabel}_cannot_delete_own_owner_membership`, mutationDenied(deleteOwnMembership) && exactOwnerMembership(actorAfterMembershipDelete, actor.membershipUserId));

  const replaceOwnerUser = await query(actor.jwt, `profiles?id=eq.${encodeURIComponent(actor.profileId)}&select=id,owner_user_id`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ owner_user_id: target.membershipUserId }),
  });
  const actorProfileAfterOwnerReplace = await profileRows(actor.jwt, actor.profileId, "id,owner_user_id");
  check(
    checks,
    `${actorLabel}_cannot_replace_server_derived_owner_user_id`,
    mutationDenied(replaceOwnerUser)
      && actorProfileAfterOwnerReplace.ok
      && actorProfileAfterOwnerReplace.rows.length === 1
      && actorProfileAfterOwnerReplace.rows[0]?.owner_user_id === actor.membershipUserId,
  );
}

export function evaluateCrossTenantChecks(checks: Check[], cleanupOk: boolean) {
  return cleanupOk && checks.length >= 48 && checks.every((item) => item.pass);
}

async function resolveUserId(sql: ReturnType<typeof neon>, state: FixtureState) {
  if (state.userId) return state.userId;
  if (!state.email) return null;
  const rows = await sql`select id from neon_auth.user where email = ${state.email} limit 1` as Array<{ id: string }>;
  return typeof rows[0]?.id === "string" ? rows[0].id : null;
}

async function cleanupOwnedProfiles(sql: ReturnType<typeof neon>, authUserId: string) {
  const profiles = await sql`
    select distinct p.id
    from public.profiles p
    left join public.app_users au on au.auth_user_id = ${authUserId}
    left join public.profile_members pm on pm.profile_id = p.id and pm.user_id = au.id
    where p.owner_auth_user_id = ${authUserId} or pm.user_id is not null
  ` as Array<{ id: string }>;
  for (const row of profiles) {
    if (typeof row.id !== "string") continue;
    await sql`delete from public.brand_profiles where profile_id = ${row.id}`;
    await sql`delete from public.profile_members where profile_id = ${row.id}`;
    await sql`delete from public.profiles where id = ${row.id}`;
  }
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
    if (!state.profileId) await cleanupOwnedProfiles(sql, userId);
    await sql`delete from public.app_users where auth_user_id = ${userId}`;
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
  if (state.userId) {
    const profiles = await sql`select count(*)::int as count from public.profiles where owner_auth_user_id = ${state.userId}` as Array<{ count: number | string }>;
    if (Number(profiles[0]?.count ?? 1) !== 0) return false;
    const appUsers = await sql`select count(*)::int as count from public.app_users where auth_user_id = ${state.userId}` as Array<{ count: number | string }>;
    if (Number(appUsers[0]?.count ?? 1) !== 0) return false;
  }
  if (state.email) {
    const users = await sql`select count(*)::int as count from neon_auth.user where email = ${state.email}` as Array<{ count: number | string }>;
    if (Number(users[0]?.count ?? 1) !== 0) return false;
  }
  return true;
}

async function cleanupOnly(sql: ReturnType<typeof neon>, payload: TestPayload) {
  const aState: FixtureState = { email: validQaEmail(payload.a?.email) ?? undefined };
  const bState: FixtureState = { email: validQaEmail(payload.b?.email) ?? undefined };
  try {
    const aUserId = await resolveUserId(sql, aState);
    const bUserId = await resolveUserId(sql, bState);
    if (aUserId) aState.userId = aUserId;
    if (bUserId) bState.userId = bUserId;
    await cleanupFixture(sql, aState);
    await cleanupFixture(sql, bState);
    const clean = await verifyCleanup(sql, aState) && await verifyCleanup(sql, bState);
    return json({ service: "post-automatici", cleanup: clean ? "PASS" : "FAIL" }, clean ? 200 : 503);
  } catch {
    return json({ service: "post-automatici", cleanup: "FAIL" }, 503);
  }
}

export async function handleTenantCrossTest(request: Request, env: CrossTenantEnv) {
  if (request.method !== "POST") return json({ error: "API_NOT_FOUND" }, 404);
  if (!authorized(request, env.TENANT_CROSS_TEST_TOKEN)) return json({ error: "API_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return json({ ready: false, error: "DATABASE_NOT_CONFIGURED" }, 503);

  const payload = await requestPayload(request);
  const sql = neon(env.DATABASE_URL);
  if (payload.mode === "cleanup") return cleanupOnly(sql, payload);

  const checks: Check[] = [];
  const aState: FixtureState = { email: validQaEmail(payload.a?.email) ?? undefined };
  const bState: FixtureState = { email: validQaEmail(payload.b?.email) ?? undefined };
  let executionError: string | null = null;
  let cleanupOk = false;

  try {
    const a = await createFixture(payload.a, "A", aState);
    const b = await createFixture(payload.b, "B", bState);

    await ownAccessChecks(a, "A", checks);
    await ownAccessChecks(b, "B", checks);
    await crossReadChecks(a, b, "A", "B", checks);
    await crossReadChecks(b, a, "B", "A", checks);
    await crossWriteChecks(a, b, "A", "B", checks);
    await crossWriteChecks(b, a, "B", "A", checks);
    await membershipEscalationChecks(a, b, "A", "B", checks);
    await membershipEscalationChecks(b, a, "B", "A", checks);
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
