import { neon } from "@neondatabase/serverless";

const TENANT_TABLES = [
  "profiles", "profile_members", "brand_profiles", "website_scans", "website_pages",
  "content_strategies", "assets", "content_items", "content_variants", "social_connections",
  "schedules", "publication_jobs", "publication_attempts", "metric_snapshots", "learning_insights",
  "ai_usage_events", "audit_log",
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function sameSecret(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function validMarker(value) {
  return typeof value === "string" && /^[a-z0-9]{10,32}$/.test(value);
}

function expectedEmails(marker) {
  return new Set([
    `audit-smoke-${marker}-customer@example.invalid`,
    `audit-smoke-${marker}-customer-b@example.invalid`,
    `audit-smoke-${marker}-admin@example.invalid`,
  ]);
}

const recognizedSmokeEmail = /^audit-smoke-([a-z0-9]{10,32})-(customer|customer-b|admin)@example\.invalid$/;

function recognizedUser(user) {
  const match = recognizedSmokeEmail.exec(user.email || "");
  if (!match) return null;
  return { ...user, marker: match[1], kind: match[2] };
}

async function usersForMarker(sql, marker) {
  const pattern = `audit-smoke-${marker}-%@example.invalid`;
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

async function allRecognizedSmokeUsers(sql) {
  const rows = await sql`
    select u.id::text as id,
      lower(coalesce(to_jsonb(u)->>'email', '')) as email,
      lower(coalesce(u.role::text, '')) as role
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like 'audit-smoke-%@example.invalid'
    order by lower(coalesce(to_jsonb(u)->>'email', ''))
  `;
  return rows.map(recognizedUser).filter(Boolean);
}

async function state(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const recognized = await allRecognizedSmokeUsers(sql);
  const pattern = `audit-smoke-${marker}-%@example.invalid`;
  const metrics = await sql`
    select
      (select count(*)::int from neon_auth.user where lower(coalesce(role::text, '')) = 'admin') as super_admins,
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from public.profiles p where p.owner_auth_user_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_profiles,
      (select count(*)::int
        from public.app_users au
        join public.profile_members pm on pm.user_id = au.id
        where upper(pm.role) = 'OWNER'
          and au.auth_user_id in (
            select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
          )) as qa_owners,
      (select count(*)::int from public.app_users au where au.auth_user_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_app_users,
      (select count(*)::int from neon_auth.session s where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_sessions,
      (select count(*)::int from neon_auth.account a where coalesce(to_jsonb(a)->>'userId', to_jsonb(a)->>'user_id', '') in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_accounts,
      (select count(*)::int from public.platform_admin_audit a where a.actor_auth_user_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
      )) as qa_audit_rows,
      (select count(*)::int from (
        select p.id
        from public.profiles p
        left join public.profile_members pm on pm.profile_id = p.id and upper(pm.role) = 'OWNER'
        group by p.id
        having count(pm.user_id) <> 1
      ) broken) as profiles_without_owner,
      (select count(*)::int from (
        select p.id
        from public.profiles p
        join public.profile_members pm on pm.profile_id = p.id and upper(pm.role) = 'OWNER'
        group by p.id
        having count(pm.user_id) > 1
      ) broken) as profiles_multiple_owners,
      (select count(*)::int
       from public.profiles p
       left join neon_auth.user u on u.id::text = p.owner_auth_user_id
       where u.id is null) as owner_auth_mismatches
  `;
  const row = metrics[0] || {};
  return {
    qaUsers: users.length,
    qaAdmins: users.filter((user) => user.role === "admin").length,
    qaProfiles: Number(row.qa_profiles || 0),
    qaOwners: Number(row.qa_owners || 0),
    qaAppUsers: Number(row.qa_app_users || 0),
    qaSessions: Number(row.qa_sessions || 0),
    qaAccounts: Number(row.qa_accounts || 0),
    qaAuditRows: Number(row.qa_audit_rows || 0),
    recognizedQaUsers: recognized.length,
    recognizedQaAdmins: recognized.filter((user) => user.role === "admin").length,
    recognizedQaMarkers: [...new Set(recognized.map((user) => user.marker))].length,
    superAdmins: Number(row.super_admins || 0),
    profilesTotal: Number(row.profiles_total || 0),
    profilesWithoutOwner: Number(row.profiles_without_owner || 0),
    profilesMultipleOwners: Number(row.profiles_multiple_owners || 0),
    ownerAuthMismatches: Number(row.owner_auth_mismatches || 0),
  };
}

async function promote(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const allowed = expectedEmails(marker);
  if (users.length !== 3 || users.some((user) => !allowed.has(user.email))) {
    return { ok: false, status: 409, body: { error: "SMOKE_IDENTITY_SCOPE_MISMATCH", count: users.length } };
  }
  const targetEmail = `audit-smoke-${marker}-admin@example.invalid`;
  const target = users.find((user) => user.email === targetEmail);
  if (!target) return { ok: false, status: 409, body: { error: "SMOKE_ADMIN_NOT_FOUND" } };
  await sql`update neon_auth.user set role = 'admin' where id::text = ${target.id}`;
  const after = await state(sql, marker);
  if (after.qaAdmins !== 1 || after.superAdmins !== 2) {
    return { ok: false, status: 409, body: { error: "SMOKE_ADMIN_PROMOTION_POSTCONDITION", qaAdmins: after.qaAdmins, superAdmins: after.superAdmins } };
  }
  return { ok: true, status: 200, body: { promoted: true, ...after } };
}

async function banState(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const states = [];
  for (const user of users) {
    const rows = await sql`
      select
        coalesce(u.banned, false) as banned,
        nullif(to_jsonb(u)->>'banExpires', '') as ban_expires,
        (select count(*)::int from neon_auth.session s where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') = u.id::text) as sessions
      from neon_auth.user u
      where u.id::text = ${user.id}
      limit 1
    `;
    const row = rows[0] || {};
    states.push({ kind: user.kind, banned: row.banned === true, banExpires: row.ban_expires ?? null, sessions: Number(row.sessions || 0) });
  }
  return { states };
}

async function fixtureState(sql, marker) {
  const pattern = `audit-smoke-${marker}-%@example.invalid`;
  const rows = await sql`
    select p.id::text as id, p.name, p.slug,
      case
        when lower(coalesce(to_jsonb(u)->>'email','')) = ${`audit-smoke-${marker}-customer@example.invalid`} then 'customer'
        when lower(coalesce(to_jsonb(u)->>'email','')) = ${`audit-smoke-${marker}-customer-b@example.invalid`} then 'customer-b'
        else 'unknown'
      end as kind
    from public.profiles p
    join neon_auth.user u on u.id::text = p.owner_auth_user_id
    where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
    order by p.slug
  `;
  return { profiles: rows.map((row) => ({ id: String(row.id), name: String(row.name || ""), slug: String(row.slug || ""), kind: String(row.kind || "unknown") })) };
}

async function rlsState(sql) {
  const rows = await sql`
    select c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      (p.oid is not null) as policy_present,
      coalesce(not p.polpermissive, false) as restrictive,
      coalesce(pg_get_expr(p.polqual, p.polrelid), '') as using_expr,
      coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as check_expr
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    left join pg_policy p on p.polrelid = c.oid and p.polname = 'require_authenticated_identity'
    where c.relname = any(${TENANT_TABLES})
    order by c.relname
  `;
  const activeBarrierTables = rows.filter((row) =>
    row.policy_present === true && row.restrictive === true
    && String(row.using_expr).includes("current_auth_user_is_active")
    && String(row.check_expr).includes("current_auth_user_is_active")
  ).length;
  return {
    tenantTables: rows.length,
    rlsEnabled: rows.filter((row) => row.rls_enabled === true).length,
    restrictiveBarriers: rows.filter((row) => row.policy_present === true && row.restrictive === true).length,
    activeBarrierTables,
  };
}

async function applyBannedRls(sql) {
  await sql`
    CREATE OR REPLACE FUNCTION public.current_auth_user_is_active()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $function$
      SELECT EXISTS (
        SELECT 1
        FROM neon_auth.user nu
        WHERE nu.id::text = (SELECT auth.user_id())::text
          AND nu.banned IS FALSE
      )
    $function$
  `;
  await sql`REVOKE ALL ON FUNCTION public.current_auth_user_is_active() FROM PUBLIC`;
  await sql`GRANT EXECUTE ON FUNCTION public.current_auth_user_is_active() TO authenticated`;
  await sql`
    DO $barrier$
    DECLARE
      table_name text;
    BEGIN
      FOREACH table_name IN ARRAY ARRAY[
        'profiles', 'profile_members', 'brand_profiles', 'website_scans', 'website_pages',
        'content_strategies', 'assets', 'content_items', 'content_variants', 'social_connections',
        'schedules', 'publication_jobs', 'publication_attempts', 'metric_snapshots', 'learning_insights',
        'ai_usage_events', 'audit_log'
      ] LOOP
        IF to_regclass('public.' || quote_ident(table_name)) IS NULL THEN
          RAISE EXCEPTION 'required tenant table public.% does not exist', table_name;
        END IF;
        EXECUTE format('DROP POLICY IF EXISTS require_authenticated_identity ON public.%I', table_name);
        EXECUTE format(
          'CREATE POLICY require_authenticated_identity ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (((select auth.user_id()) IS NOT NULL) AND public.current_auth_user_is_active()) WITH CHECK (((select auth.user_id()) IS NOT NULL) AND public.current_auth_user_is_active())',
          table_name
        );
      END LOOP;
    END
    $barrier$
  `;
  await sql`
    CREATE OR REPLACE FUNCTION public.current_auth_user_is_active()
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $function$
    DECLARE
      current_banned boolean;
      current_ban_expires text;
    BEGIN
      SELECT nu.banned, nullif(to_jsonb(nu)->>'banExpires', '')
      INTO current_banned, current_ban_expires
      FROM neon_auth.user nu
      WHERE nu.id::text = (SELECT auth.user_id())::text
      LIMIT 1;
      IF NOT FOUND THEN RETURN FALSE; END IF;
      IF current_banned IS FALSE THEN RETURN TRUE; END IF;
      IF current_banned IS DISTINCT FROM TRUE THEN RETURN FALSE; END IF;
      IF current_ban_expires IS NULL THEN RETURN FALSE; END IF;
      BEGIN
        RETURN current_ban_expires::timestamptz <= now();
      EXCEPTION WHEN OTHERS THEN
        RETURN FALSE;
      END;
    END
    $function$
  `;
  await sql`REVOKE ALL ON FUNCTION public.current_auth_user_is_active() FROM PUBLIC`;
  await sql`GRANT EXECUTE ON FUNCTION public.current_auth_user_is_active() TO authenticated`;
  const after = await rlsState(sql);
  if (after.tenantTables !== TENANT_TABLES.length || after.rlsEnabled !== TENANT_TABLES.length || after.activeBarrierTables !== TENANT_TABLES.length) {
    throw new Error(`BANNED_RLS_POSTCONDITION_FAILED ${JSON.stringify(after)}`);
  }
  return { applied: true, ...after };
}

async function cleanupUsers(sql, users) {
  for (const user of users) {
    await sql`delete from public.profiles where owner_auth_user_id = ${user.id}`;
    await sql`
      delete from public.profile_members pm
      using public.app_users au
      where pm.user_id = au.id and au.auth_user_id = ${user.id}
    `;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') = ${user.id}`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId', to_jsonb(a)->>'user_id', '') = ${user.id}`;
    await sql`delete from public.app_users where auth_user_id = ${user.id}`;
    await sql`delete from neon_auth.user where id::text = ${user.id}`;
  }
}

async function cleanup(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const allowed = expectedEmails(marker);
  if (users.length > 3 || users.some((user) => !allowed.has(user.email))) {
    return { ok: false, status: 409, body: { error: "SMOKE_CLEANUP_SCOPE_MISMATCH", count: users.length } };
  }
  await cleanupUsers(sql, users);
  return { ok: true, status: 200, body: { cleaned: true, ...(await state(sql, marker)) } };
}

async function cleanupRecognizedResidue(sql, marker) {
  const users = await allRecognizedSmokeUsers(sql);
  if (users.some((user) => !recognizedSmokeEmail.test(user.email))) {
    return { ok: false, status: 409, body: { error: "STALE_SMOKE_SCOPE_MISMATCH" } };
  }
  const cleanedUsers = users.length;
  const cleanedAdmins = users.filter((user) => user.role === "admin").length;
  await cleanupUsers(sql, users);
  const after = await state(sql, marker);
  if (after.recognizedQaUsers !== 0 || after.recognizedQaAdmins !== 0) {
    return { ok: false, status: 409, body: { error: "STALE_SMOKE_CLEANUP_POSTCONDITION", recognizedQaUsers: after.recognizedQaUsers, recognizedQaAdmins: after.recognizedQaAdmins } };
  }
  return { ok: true, status: 200, body: { cleaned: true, cleanedUsers, cleanedAdmins, ...after } };
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const provided = request.headers.get("x-audit-smoke-token") || "";
    if (!sameSecret(provided, env.AUDIT_SMOKE_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

    let body;
    try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!validMarker(body?.marker)) return json({ error: "INVALID_MARKER" }, 400);
    if (!["preflight", "state", "promote", "ban-state", "fixture-state", "rls-state", "apply-banned-rls", "cleanup", "cleanup-residue"].includes(body?.action)) return json({ error: "INVALID_ACTION" }, 400);

    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "preflight" || body.action === "state") return json(await state(sql, body.marker));
      if (body.action === "ban-state") return json(await banState(sql, body.marker));
      if (body.action === "fixture-state") return json(await fixtureState(sql, body.marker));
      if (body.action === "rls-state") return json(await rlsState(sql));
      if (body.action === "apply-banned-rls") return json(await applyBannedRls(sql));
      if (body.action === "promote") {
        const result = await promote(sql, body.marker);
        return json(result.body, result.status);
      }
      if (body.action === "cleanup-residue") {
        const result = await cleanupRecognizedResidue(sql, body.marker);
        return json(result.body, result.status);
      }
      const result = await cleanup(sql, body.marker);
      return json(result.body, result.status);
    } catch (reason) {
      console.error("audit-viewer-preview-controller", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "CONTROLLER_FAILED" }, 500);
    }
  },
};