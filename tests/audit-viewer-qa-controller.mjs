import { neon } from "@neondatabase/serverless";

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
    `audit-smoke-${marker}-admin@example.invalid`,
  ]);
}

async function usersForMarker(sql, marker) {
  const pattern = `audit-smoke-${marker}-%@example.invalid`;
  return await sql`
    select u.id::text as id,
      lower(coalesce(to_jsonb(u)->>'email', '')) as email,
      lower(coalesce(u.role::text, '')) as role
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like ${pattern}
    order by lower(coalesce(to_jsonb(u)->>'email', ''))
  `;
}

async function state(sql, marker) {
  const users = await usersForMarker(sql, marker);
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
      ) broken) as profiles_without_owner
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
    superAdmins: Number(row.super_admins || 0),
    profilesTotal: Number(row.profiles_total || 0),
    profilesWithoutOwner: Number(row.profiles_without_owner || 0),
  };
}

async function promote(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const allowed = expectedEmails(marker);
  if (users.length !== 2 || users.some((user) => !allowed.has(user.email))) {
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

async function cleanup(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const allowed = expectedEmails(marker);
  if (users.length > 2 || users.some((user) => !allowed.has(user.email))) {
    return { ok: false, status: 409, body: { error: "SMOKE_CLEANUP_SCOPE_MISMATCH", count: users.length } };
  }

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

  return { ok: true, status: 200, body: { cleaned: true, ...(await state(sql, marker)) } };
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
    if (!["preflight", "state", "promote", "cleanup"].includes(body?.action)) return json({ error: "INVALID_ACTION" }, 400);

    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "preflight" || body.action === "state") return json(await state(sql, body.marker));
      if (body.action === "promote") {
        const result = await promote(sql, body.marker);
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
