import { neon } from "@neondatabase/serverless";

type QaEnv = { DATABASE_URL?: string; FASE3_QA_TOKEN?: string };
type QaUser = { id: string; email: string; role: string | null };
type QaAction = "promote_admin" | "state" | "cleanup";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function equalSecret(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function validMarker(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{8,40}$/.test(value);
}

async function qaUsers(sql: ReturnType<typeof neon>, marker: string) {
  const pattern = `fase3-qa-${marker}-%@example.invalid`;
  return await sql`
    select u.id::text as id,
      lower(coalesce(to_jsonb(u)->>'email', '')) as email,
      u.role::text as role
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
    order by lower(coalesce(to_jsonb(u)->>'email', ''))
  ` as QaUser[];
}

async function state(sql: ReturnType<typeof neon>, marker: string) {
  const users = await qaUsers(sql, marker);
  const metrics = await sql`
    select
      (select count(*)::int from neon_auth.user) as users_total,
      (select count(*)::int from neon_auth.user where lower(coalesce(role::text, '')) = 'admin') as super_admins,
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from public.profiles where onboarding_completed is true) as onboarding_completed,
      (select count(*)::int from public.profiles where coalesce(onboarding_completed, false) is false) as onboarding_incomplete,
      (select count(*)::int from public.social_connections) as social_connections_total,
      (select count(*)::int from public.profile_members where upper(role) = 'OWNER') as owner_memberships,
      (select count(*)::int from public.platform_admin_audit where action = 'INITIAL_SUPER_ADMIN_BOOTSTRAP') as bootstrap_audit
  ` as Array<Record<string, number>>;
  const protection = await sql`
    select c.relrowsecurity as rls_enabled,
      has_table_privilege('authenticated', 'public.platform_admin_audit', 'SELECT') as authenticated_select,
      has_table_privilege('authenticated', 'public.platform_admin_audit', 'INSERT') as authenticated_insert,
      has_table_privilege('authenticated', 'public.platform_admin_audit', 'UPDATE') as authenticated_update,
      has_table_privilege('authenticated', 'public.platform_admin_audit', 'DELETE') as authenticated_delete,
      has_table_privilege('anonymous', 'public.platform_admin_audit', 'SELECT') as anonymous_select,
      has_table_privilege('anonymous', 'public.platform_admin_audit', 'INSERT') as anonymous_insert,
      has_table_privilege('anonymous', 'public.platform_admin_audit', 'UPDATE') as anonymous_update,
      has_table_privilege('anonymous', 'public.platform_admin_audit', 'DELETE') as anonymous_delete
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'platform_admin_audit'
    limit 1
  ` as Array<Record<string, boolean>>;

  const auditCounts = new Map<string, number>();
  let qaProfiles = 0;
  let qaOwners = 0;
  for (const user of users) {
    const rows = await sql`
      select action, count(*)::int as count
      from public.platform_admin_audit
      where actor_auth_user_id = ${user.id}
      group by action
    ` as Array<{ action: string; count: number }>;
    for (const row of rows) auditCounts.set(row.action, (auditCounts.get(row.action) ?? 0) + Number(row.count));
    const profileRows = await sql`
      select
        (select count(*)::int from public.profiles where owner_auth_user_id = ${user.id}) as profiles,
        (select count(*)::int
          from public.app_users au
          join public.profile_members pm on pm.user_id = au.id
          where au.auth_user_id = ${user.id} and upper(pm.role) = 'OWNER') as owners
    ` as Array<{ profiles: number; owners: number }>;
    qaProfiles += Number(profileRows[0]?.profiles ?? 0);
    qaOwners += Number(profileRows[0]?.owners ?? 0);
  }

  return {
    qaUsers: users.length,
    qaAdmins: users.filter((user) => user.role?.toLowerCase() === "admin").length,
    qaProfiles,
    qaOwners,
    metrics: metrics[0] ?? null,
    auditProtection: protection[0] ?? null,
    qaAuditActions: Object.fromEntries([...auditCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export async function handleFase3QaControl(request: Request, env: QaEnv) {
  if (!env.FASE3_QA_TOKEN) return json({ error: "API_NOT_FOUND" }, 404);
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const provided = request.headers.get("x-fase3-qa-token") || "";
  if (!equalSecret(provided, env.FASE3_QA_TOKEN)) return json({ error: "FORBIDDEN" }, 403);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  let body: { action?: QaAction; marker?: unknown } = {};
  try { body = await request.json() as typeof body; } catch { return json({ error: "INVALID_JSON" }, 400); }
  if (!validMarker(body.marker)) return json({ error: "INVALID_QA_MARKER" }, 400);
  const marker = body.marker;
  const sql = neon(env.DATABASE_URL);

  try {
    if (body.action === "promote_admin") {
      const users = await qaUsers(sql, marker);
      const adminCandidate = users.filter((user) => user.email === `fase3-qa-${marker}-admin@example.invalid`);
      if (users.length !== 3 || adminCandidate.length !== 1) {
        return json({ error: "QA_IDENTITIES_NOT_EXACT", qaUsers: users.length, adminCandidates: adminCandidate.length }, 409);
      }
      const target = adminCandidate[0];
      await sql`update neon_auth.user set role = 'admin' where id::text = ${target.id}`;
      await sql`
        insert into public.platform_admin_audit (actor_auth_user_id, action, target_type, target_id, metadata)
        values (${target.id}, 'FASE3_QA_ADMIN_PROMOTED', 'QA_AUTH_USER', ${target.id}, ${JSON.stringify({ qa: true, marker })}::jsonb)
      `;
      return json({ promoted: true, qaUsers: users.length });
    }

    if (body.action === "state") return json(await state(sql, marker));

    if (body.action === "cleanup") {
      const users = await qaUsers(sql, marker);
      if (users.length > 3) return json({ error: "QA_SCOPE_TOO_LARGE", qaUsers: users.length }, 409);
      for (const user of users) {
        await sql`delete from public.profiles where owner_auth_user_id = ${user.id}`;
        await sql`delete from public.platform_admin_audit where actor_auth_user_id = ${user.id}`;
        await sql`delete from public.app_users where auth_user_id = ${user.id}`;
        await sql`delete from neon_auth.user where id::text = ${user.id}`;
      }
      const finalState = await state(sql, marker);
      return json({ cleaned: true, ...finalState });
    }

    return json({ error: "INVALID_QA_ACTION" }, 400);
  } catch (reason) {
    console.error("fase3-qa-control", reason instanceof Error ? reason.message : "unknown");
    return json({ error: "QA_CONTROL_FAILED" }, 500);
  }
}
