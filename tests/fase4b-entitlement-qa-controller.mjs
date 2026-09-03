import { neon } from "@neondatabase/serverless";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function sameSecret(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function validMarker(value) {
  return typeof value === "string" && /^[0-9]{8,24}$/.test(value);
}

const recognizedEmail = /^fase4b-entitlement-([0-9]{8,24})-(a|b)@example\.invalid$/;

function expectedEmails(marker) {
  return new Set([
    `fase4b-entitlement-${marker}-a@example.invalid`,
    `fase4b-entitlement-${marker}-b@example.invalid`,
  ]);
}

function recognizedUser(user) {
  const match = recognizedEmail.exec(user.email || "");
  if (!match) return null;
  return { ...user, marker: match[1], kind: match[2] };
}

async function usersForMarker(sql, marker) {
  const pattern = `fase4b-entitlement-${marker}-%@example.invalid`;
  const rows = await sql`
    select u.id::text as id,
      lower(coalesce(to_jsonb(u)->>'email', '')) as email,
      lower(coalesce(u.role::text, '')) as role
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
    order by lower(coalesce(to_jsonb(u)->>'email', ''))
  `;
  return rows.map(recognizedUser).filter(Boolean).filter((user) => user.marker === marker);
}

async function allRecognizedUsers(sql) {
  const rows = await sql`
    select u.id::text as id,
      lower(coalesce(to_jsonb(u)->>'email', '')) as email,
      lower(coalesce(u.role::text, '')) as role
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like 'fase4b-entitlement-%@example.invalid'
    order by lower(coalesce(to_jsonb(u)->>'email', ''))
  `;
  return rows.map(recognizedUser).filter(Boolean);
}

async function profileMap(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const byKind = Object.fromEntries(users.map((user) => [user.kind, user]));
  const rows = await sql`
    select p.id::text as id, p.owner_auth_user_id
    from public.profiles p
    where p.owner_auth_user_id in (
      select u.id::text from neon_auth.user u
      where lower(coalesce(to_jsonb(u)->>'email', '')) like ${`fase4b-entitlement-${marker}-%@example.invalid`}
    )
    order by p.owner_auth_user_id
  `;
  const result = {};
  for (const kind of ["a", "b"]) {
    const user = byKind[kind];
    if (!user) continue;
    const profile = rows.find((row) => row.owner_auth_user_id === user.id);
    if (profile) result[kind] = { user, profileId: profile.id };
  }
  return result;
}

async function state(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const recognized = await allRecognizedUsers(sql);
  const pattern = `fase4b-entitlement-${marker}-%@example.invalid`;
  const rows = await sql`
    select
      (select count(*)::int from neon_auth.user where lower(coalesce(role::text, '')) = 'admin') as super_admins,
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from public.profiles p where p.owner_auth_user_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_profiles,
      (select count(*)::int
         from public.profile_members pm
         join public.app_users au on au.id = pm.user_id
        where upper(pm.role)='OWNER' and au.auth_user_id in (
          select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
        )) as qa_owners,
      (select count(*)::int from public.profile_entitlements pe where pe.profile_id in (
        select p.id from public.profiles p where p.owner_auth_user_id in (
          select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
        )) and pe.source='QA_RUNTIME') as qa_entitlement_overrides,
      (select count(*)::int from public.capability_usage_events e where e.profile_id in (
        select p.id from public.profiles p where p.owner_auth_user_id in (
          select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
        ))) as qa_usage_events,
      (select count(*)::int from public.capability_usage_buckets b where b.profile_id in (
        select p.id from public.profiles p where p.owner_auth_user_id in (
          select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
        ))) as qa_usage_buckets,
      (select count(*)::int from public.app_users au where au.auth_user_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_app_users,
      (select count(*)::int from neon_auth.session s where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_sessions,
      (select count(*)::int from neon_auth.account a where coalesce(to_jsonb(a)->>'userId', to_jsonb(a)->>'user_id', '') in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_accounts,
      (select count(*)::int from (
        select p.id from public.profiles p
        left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER'
        group by p.id having count(pm.user_id) <> 1
      ) x) as profiles_without_owner,
      (select count(*)::int from (
        select p.id from public.profiles p
        left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER'
        group by p.id having count(pm.user_id) > 1
      ) x) as multiple_owners,
      (select count(*)::int from public.profiles p
        where exists (select 1 from public.profile_members pm where pm.profile_id=p.id and upper(pm.role)='OWNER')
          and not exists (
            select 1 from public.profile_members pm
            where pm.profile_id=p.id and upper(pm.role)='OWNER' and pm.user_id=p.owner_user_id
          )) as owner_mismatch,
      (select count(*)::int from pg_policies where schemaname='public' and (qual='true' or with_check='true')) as open_policies,
      (select count(distinct table_name)::int from information_schema.role_table_grants
        where table_schema='public' and grantee in ('PUBLIC','anonymous')
          and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) as anonymous_privileged_tables
  `;
  const row = rows[0] || {};
  return {
    qaUsers: users.length,
    qaProfiles: Number(row.qa_profiles || 0),
    qaOwners: Number(row.qa_owners || 0),
    qaEntitlementOverrides: Number(row.qa_entitlement_overrides || 0),
    qaUsageEvents: Number(row.qa_usage_events || 0),
    qaUsageBuckets: Number(row.qa_usage_buckets || 0),
    qaAppUsers: Number(row.qa_app_users || 0),
    qaSessions: Number(row.qa_sessions || 0),
    qaAccounts: Number(row.qa_accounts || 0),
    recognizedQaUsers: recognized.length,
    superAdmins: Number(row.super_admins || 0),
    profilesTotal: Number(row.profiles_total || 0),
    profilesWithoutOwner: Number(row.profiles_without_owner || 0),
    multipleOwners: Number(row.multiple_owners || 0),
    ownerMismatch: Number(row.owner_mismatch || 0),
    openPolicies: Number(row.open_policies || 0),
    anonymousPrivilegedTables: Number(row.anonymous_privileged_tables || 0),
  };
}

async function cleanupUsers(sql, users) {
  for (const user of users) {
    await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;
    await sql`
      delete from public.profile_members pm using public.app_users au
      where pm.user_id=au.id and au.auth_user_id=${user.id}
    `;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id}`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;
    await sql`delete from public.app_users where auth_user_id=${user.id}`;
    await sql`delete from neon_auth.user where id::text=${user.id}`;
  }
}

async function cleanup(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const allowed = expectedEmails(marker);
  if (users.length > 2 || users.some((user) => !allowed.has(user.email))) {
    return { ok: false, status: 409, body: { error: "QA_CLEANUP_SCOPE_MISMATCH", count: users.length } };
  }
  await cleanupUsers(sql, users);
  return { ok: true, status: 200, body: { cleaned: true, ...(await state(sql, marker)) } };
}

async function cleanupResidue(sql, marker) {
  const users = await allRecognizedUsers(sql);
  if (users.some((user) => !recognizedEmail.test(user.email))) {
    return { ok: false, status: 409, body: { error: "QA_RESIDUE_SCOPE_MISMATCH" } };
  }
  const cleanedUsers = users.length;
  await cleanupUsers(sql, users);
  return { ok: true, status: 200, body: { cleaned: true, cleanedUsers, ...(await state(sql, marker)) } };
}

function monthBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

function dayBounds(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function reserve(sql, { profileId, capability, limit = 1, start, end, idempotencyKey }) {
  const rows = await sql`
    select * from public.reserve_capability_usage(
      ${profileId}::uuid, ${capability}, 1::numeric, ${limit}::numeric,
      ${start}::timestamptz, ${end}::timestamptz,
      ${idempotencyKey}, 'QA_RUNTIME', null, '{}'::jsonb
    )
  `;
  return rows[0];
}

async function release(sql, eventId) {
  const rows = await sql`select (public.release_capability_usage(${eventId}::uuid)).*`;
  return rows[0];
}

async function commit(sql, eventId) {
  const rows = await sql`select (public.commit_capability_usage(${eventId}::uuid)).*`;
  return rows[0];
}

async function bucket(sql, profileId, capability, start, end) {
  const rows = await sql`
    select reserved_quantity::text as reserved, committed_quantity::text as committed,
           period_start::text as period_start, period_end::text as period_end
    from public.capability_usage_buckets
    where profile_id=${profileId}::uuid and capability_key=${capability}
      and period_start=${start}::timestamptz and period_end=${end}::timestamptz
  `;
  return rows[0] || { reserved: "0", committed: "0", period_start: start, period_end: end };
}

async function setup(sql, marker) {
  const map = await profileMap(sql, marker);
  if (!map.a || !map.b) return { ok: false, status: 409, body: { error: "QA_PROFILE_SCOPE_MISMATCH" } };

  const month = monthBounds();
  const day = dayBounds();
  const a = map.a.profileId;
  const b = map.b.profileId;

  const monthlyKeys = ["website.scan", "brand.analyze", "ai.strategy.generate", "ai.research.factcheck", "ai.image.generate"];
  for (const key of monthlyKeys) {
    await sql`
      update public.profile_entitlements
      set enabled=true, limit_type='COUNT_PER_MONTH', limit_value=1, period_type='MONTH', source='QA_RUNTIME', updated_at=now()
      where profile_id=${a}::uuid and capability_key=${key}
    `;
  }
  await sql`
    update public.profile_entitlements
    set enabled=true, limit_type='COUNT_PER_DAY', limit_value=1, period_type='DAY', source='QA_RUNTIME', updated_at=now()
    where profile_id=${a}::uuid and capability_key='autopilot.hourly'
  `;
  await sql`
    update public.profile_entitlements
    set enabled=false, limit_type='BOOLEAN', limit_value=null, period_type='NONE', source='QA_RUNTIME', updated_at=now()
    where profile_id=${a}::uuid and capability_key='autopilot.manage'
  `;

  for (const [profileId, suffix] of [[a, "a"], [b, "b"]]) {
    const seeded = await reserve(sql, {
      profileId,
      capability: "social.facebook.publish",
      limit: null,
      start: month.start,
      end: month.end,
      idempotencyKey: `seed-${marker}-${suffix}`,
    });
    if (!seeded?.allowed || !seeded?.event_id) return { ok: false, status: 409, body: { error: "QA_USAGE_SEED_FAILED", suffix } };
    await commit(sql, seeded.event_id);
  }

  return { ok: true, status: 200, body: { configured: true, profileA: a, profileB: b, month, day } };
}

async function usageSuite(sql, marker) {
  const map = await profileMap(sql, marker);
  if (!map.a) return { ok: false, status: 409, body: { error: "QA_PROFILE_A_MISSING" } };
  const profileId = map.a.profileId;
  const month = monthBounds();
  const day = dayBounds();

  const first = await reserve(sql, { profileId, capability: "website.scan", limit: 1, start: month.start, end: month.end, idempotencyKey: `first-${marker}` });
  const duplicate = await reserve(sql, { profileId, capability: "website.scan", limit: 1, start: month.start, end: month.end, idempotencyKey: `first-${marker}` });
  const over = await reserve(sql, { profileId, capability: "website.scan", limit: 1, start: month.start, end: month.end, idempotencyKey: `second-${marker}` });
  if (!first?.allowed || first?.duplicate || !first?.event_id) throw new Error("FIRST_RESERVE_FAILED");
  if (!duplicate?.allowed || !duplicate?.duplicate || duplicate?.event_id !== first.event_id) throw new Error("DUPLICATE_RESERVE_FAILED");
  if (over?.allowed) throw new Error("OVER_LIMIT_RESERVE_ALLOWED");
  await commit(sql, first.event_id);
  const committedBucket = await bucket(sql, profileId, "website.scan", month.start, month.end);
  if (committedBucket.reserved !== "0" || committedBucket.committed !== "1") throw new Error("COMMIT_BUCKET_INVALID");

  const releaseFirst = await reserve(sql, { profileId, capability: "brand.analyze", limit: 1, start: month.start, end: month.end, idempotencyKey: `release-1-${marker}` });
  if (!releaseFirst?.allowed || !releaseFirst?.event_id) throw new Error("RELEASE_RESERVE_FAILED");
  await release(sql, releaseFirst.event_id);
  const releasedBucket = await bucket(sql, profileId, "brand.analyze", month.start, month.end);
  if (releasedBucket.reserved !== "0" || releasedBucket.committed !== "0") throw new Error("RELEASE_BUCKET_INVALID");
  const releaseSecond = await reserve(sql, { profileId, capability: "brand.analyze", limit: 1, start: month.start, end: month.end, idempotencyKey: `release-2-${marker}` });
  if (!releaseSecond?.allowed || !releaseSecond?.event_id) throw new Error("QUOTA_NOT_AVAILABLE_AFTER_RELEASE");
  await release(sql, releaseSecond.event_id);

  const distinct = await Promise.all([
    reserve(sql, { profileId, capability: "ai.strategy.generate", limit: 1, start: month.start, end: month.end, idempotencyKey: `concurrent-a-${marker}` }),
    reserve(sql, { profileId, capability: "ai.strategy.generate", limit: 1, start: month.start, end: month.end, idempotencyKey: `concurrent-b-${marker}` }),
  ]);
  const distinctAllowed = distinct.filter((row) => row?.allowed);
  if (distinctAllowed.length !== 1) throw new Error(`CONCURRENT_LIMIT_UNSAFE_${distinctAllowed.length}`);
  await release(sql, distinctAllowed[0].event_id);

  const same = await Promise.all([
    reserve(sql, { profileId, capability: "ai.research.factcheck", limit: 1, start: month.start, end: month.end, idempotencyKey: `same-${marker}` }),
    reserve(sql, { profileId, capability: "ai.research.factcheck", limit: 1, start: month.start, end: month.end, idempotencyKey: `same-${marker}` }),
  ]);
  if (same.some((row) => !row?.allowed)) throw new Error("CONCURRENT_IDEMPOTENCY_DENIED");
  if (new Set(same.map((row) => row.event_id)).size !== 1) throw new Error("CONCURRENT_IDEMPOTENCY_EVENT_DUPLICATED");
  if (same.filter((row) => row.duplicate).length !== 1) throw new Error("CONCURRENT_IDEMPOTENCY_DUPLICATE_FLAG_INVALID");
  const sameBucket = await bucket(sql, profileId, "ai.research.factcheck", month.start, month.end);
  if (sameBucket.reserved !== "1" || sameBucket.committed !== "0") throw new Error("CONCURRENT_IDEMPOTENCY_BUCKET_INVALID");
  await release(sql, same[0].event_id);

  const dayReserve = await reserve(sql, { profileId, capability: "autopilot.hourly", limit: 1, start: day.start, end: day.end, idempotencyKey: `day-${marker}` });
  if (!dayReserve?.allowed || !dayReserve?.event_id) throw new Error("DAY_RESERVE_FAILED");
  const dayBucket = await bucket(sql, profileId, "autopilot.hourly", day.start, day.end);
  if (new Date(dayBucket.period_start).toISOString() !== day.start || new Date(dayBucket.period_end).toISOString() !== day.end) throw new Error("DAY_BOUNDARY_INVALID");
  await release(sql, dayReserve.event_id);

  const monthReserve = await reserve(sql, { profileId, capability: "ai.image.generate", limit: 1, start: month.start, end: month.end, idempotencyKey: `month-${marker}` });
  if (!monthReserve?.allowed || !monthReserve?.event_id) throw new Error("MONTH_RESERVE_FAILED");
  const monthBucket = await bucket(sql, profileId, "ai.image.generate", month.start, month.end);
  if (new Date(monthBucket.period_start).toISOString() !== month.start || new Date(monthBucket.period_end).toISOString() !== month.end) throw new Error("MONTH_BOUNDARY_INVALID");
  await release(sql, monthReserve.event_id);

  return {
    ok: true,
    status: 200,
    body: {
      firstReserve: "PASS",
      duplicateReserve: "PASS",
      overLimitReserve: "PASS",
      commit: "PASS",
      release: "PASS",
      concurrentDistinct: "PASS",
      concurrentIdempotency: "PASS",
      day: "PASS",
      month: "PASS",
      committedFinal: committedBucket.committed,
      reservedFinal: committedBucket.reserved,
    },
  };
}

async function privileges(sql) {
  const tables = ["profile_entitlements", "capability_usage_events", "capability_usage_buckets"];
  const rows = [];
  for (const table of tables) {
    const result = await sql`
      select
        ${table}::text as table_name,
        has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') as authenticated_select,
        has_table_privilege('authenticated', ${`public.${table}`}, 'INSERT') as authenticated_insert,
        has_table_privilege('authenticated', ${`public.${table}`}, 'UPDATE') as authenticated_update,
        has_table_privilege('authenticated', ${`public.${table}`}, 'DELETE') as authenticated_delete,
        has_table_privilege('anonymous', ${`public.${table}`}, 'SELECT') as anonymous_select
    `;
    rows.push(result[0]);
  }
  const fn = await sql`
    select
      has_function_privilege('authenticated','public.reserve_capability_usage(uuid,text,numeric,numeric,timestamptz,timestamptz,text,text,text,jsonb)','EXECUTE') as reserve_auth,
      has_function_privilege('authenticated','public.commit_capability_usage(uuid)','EXECUTE') as commit_auth,
      has_function_privilege('authenticated','public.release_capability_usage(uuid)','EXECUTE') as release_auth,
      has_function_privilege('authenticated','public.bootstrap_profile_entitlements(uuid)','EXECUTE') as bootstrap_auth,
      has_function_privilege('PUBLIC','public.reserve_capability_usage(uuid,text,numeric,numeric,timestamptz,timestamptz,text,text,text,jsonb)','EXECUTE') as reserve_public
  `;
  return { tables: rows, functions: fn[0] };
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const provided = request.headers.get("x-fase4b-qa-token") || "";
    if (!sameSecret(provided, env.FASE4B_QA_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

    let body;
    try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!validMarker(body?.marker)) return json({ error: "INVALID_MARKER" }, 400);
    const action = body?.action;
    if (!["preflight","state","setup","usage-suite","privileges","cleanup","cleanup-residue"].includes(action)) return json({ error: "INVALID_ACTION" }, 400);

    const sql = neon(env.DATABASE_URL);
    try {
      if (action === "preflight" || action === "state") return json(await state(sql, body.marker));
      if (action === "privileges") return json(await privileges(sql));
      if (action === "setup") {
        const result = await setup(sql, body.marker);
        return json(result.body, result.status);
      }
      if (action === "usage-suite") {
        const result = await usageSuite(sql, body.marker);
        return json(result.body, result.status);
      }
      if (action === "cleanup-residue") {
        const result = await cleanupResidue(sql, body.marker);
        return json(result.body, result.status);
      }
      const result = await cleanup(sql, body.marker);
      return json(result.body, result.status);
    } catch (reason) {
      console.error("fase4b-entitlement-runtime-controller", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "CONTROLLER_FAILED" }, 500);
    }
  },
};
