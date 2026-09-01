import { neon } from "@neondatabase/serverless";

const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";

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
  return match ? { ...user, marker: match[1], kind: match[2] } : null;
}

async function usersForMarker(sql, marker) {
  const pattern = `audit-smoke-${marker}-%@example.invalid`;
  const rows = await sql`
    select u.id::text as id,
      lower(coalesce(to_jsonb(u)->>'email','')) as email,
      lower(coalesce(u.role::text,'')) as role,
      coalesce(u.banned,false) as banned,
      nullif(u."banReason",'') as ban_reason,
      u."banExpires"::text as ban_expires
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
    order by lower(coalesce(to_jsonb(u)->>'email',''))
  `;
  return rows.map(recognizedUser).filter(Boolean).filter((user) => user.marker === marker);
}

async function allRecognizedSmokeUsers(sql) {
  const rows = await sql`
    select u.id::text as id,
      lower(coalesce(to_jsonb(u)->>'email','')) as email,
      lower(coalesce(u.role::text,'')) as role,
      coalesce(u.banned,false) as banned,
      nullif(u."banReason",'') as ban_reason,
      u."banExpires"::text as ban_expires
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email','')) like 'audit-smoke-%@example.invalid'
    order by lower(coalesce(to_jsonb(u)->>'email',''))
  `;
  return rows.map(recognizedUser).filter(Boolean);
}

async function state(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const recognized = await allRecognizedSmokeUsers(sql);
  const pattern = `audit-smoke-${marker}-%@example.invalid`;
  const metrics = await sql`
    select
      (select count(*)::int from neon_auth.user where lower(coalesce(role::text,''))='admin') as super_admins,
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from public.profiles p where p.owner_auth_user_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
      )) as qa_profiles,
      (select count(*)::int from public.app_users au join public.profile_members pm on pm.user_id=au.id
        where upper(pm.role)='OWNER' and au.auth_user_id in (
          select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
        )) as qa_owners,
      (select count(*)::int from public.app_users au where au.auth_user_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
      )) as qa_app_users,
      (select count(*)::int from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','') in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
      )) as qa_sessions,
      (select count(*)::int from neon_auth.session s where coalesce(to_jsonb(s)->>'impersonatedBy',to_jsonb(s)->>'impersonated_by','') in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
      )) as qa_impersonation_sessions,
      (select count(*)::int from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','') in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
      )) as qa_accounts,
      (select count(*)::int from public.platform_admin_audit a where a.actor_auth_user_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
      ) or a.target_id in (
        select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}
      )) as qa_audit_rows,
      (select count(*)::int from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern} and coalesce(u.banned,false)=true) as qa_banned,
      (select count(*)::int from (
        select p.id from public.profiles p
        left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER'
        group by p.id having count(pm.user_id)<>1
      ) broken) as profiles_without_owner
  `;
  const row = metrics[0] || {};
  return {
    qaUsers: users.length,
    qaAdmins: users.filter((u) => u.role === "admin").length,
    qaProfiles: Number(row.qa_profiles || 0),
    qaOwners: Number(row.qa_owners || 0),
    qaAppUsers: Number(row.qa_app_users || 0),
    qaSessions: Number(row.qa_sessions || 0),
    qaImpersonationSessions: Number(row.qa_impersonation_sessions || 0),
    qaAccounts: Number(row.qa_accounts || 0),
    qaAuditRows: Number(row.qa_audit_rows || 0),
    qaBanned: Number(row.qa_banned || 0),
    recognizedQaUsers: recognized.length,
    recognizedQaAdmins: recognized.filter((u) => u.role === "admin").length,
    recognizedQaMarkers: [...new Set(recognized.map((u) => u.marker))].length,
    superAdmins: Number(row.super_admins || 0),
    profilesTotal: Number(row.profiles_total || 0),
    profilesWithoutOwner: Number(row.profiles_without_owner || 0),
  };
}

async function impersonationState(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const byId = new Map(users.map((user) => [user.id, user]));
  const ids = users.map((user) => user.id);
  if (!ids.length) return { sessions: [], summary: { total: 0, impersonated: 0, impersonatedByAdmin: 0, adminSessions: 0, customerSessions: 0, customerBSessions: 0 } };
  const rows = await sql`
    select coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','') as user_id,
      coalesce(to_jsonb(s)->>'impersonatedBy',to_jsonb(s)->>'impersonated_by','') as impersonated_by
    from neon_auth.session s
    where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','') = any(${ids})
       or coalesce(to_jsonb(s)->>'impersonatedBy',to_jsonb(s)->>'impersonated_by','') = any(${ids})
  `;
  const sessions = rows.map((row) => {
    const user = byId.get(String(row.user_id || ""));
    const actor = byId.get(String(row.impersonated_by || ""));
    return { currentKind: user?.kind || "OTHER", impersonated: Boolean(row.impersonated_by), impersonatedByKind: actor?.kind || (row.impersonated_by ? "OTHER" : null), actorMatchesAdmin: actor?.kind === "admin" };
  });
  return { sessions, summary: {
    total: sessions.length,
    impersonated: sessions.filter((item) => item.impersonated).length,
    impersonatedByAdmin: sessions.filter((item) => item.actorMatchesAdmin).length,
    adminSessions: sessions.filter((item) => item.currentKind === "admin").length,
    customerSessions: sessions.filter((item) => item.currentKind === "customer").length,
    customerBSessions: sessions.filter((item) => item.currentKind === "customer-b").length,
  } };
}

async function userState(sql, marker) {
  const users = await usersForMarker(sql, marker);
  return { users: users.map((user) => ({ kind: user.kind, role: user.role, banned: user.banned === true, banReasonPresent: Boolean(user.ban_reason), banExpiresPresent: Boolean(user.ban_expires) })) };
}

async function auditState(sql, marker) {
  const ids = (await usersForMarker(sql, marker)).map((user) => user.id);
  if (!ids.length) return { total: 0, actions: {} };
  const rows = await sql`
    select action::text as action, count(*)::int as count
    from public.platform_admin_audit
    where actor_auth_user_id = any(${ids}) or target_id = any(${ids})
    group by action::text order by action::text
  `;
  return { total: rows.reduce((sum, row) => sum + Number(row.count || 0), 0), actions: Object.fromEntries(rows.map((row) => [String(row.action || ""), Number(row.count || 0)])) };
}

async function passwordResetState(sql, marker) {
  const user = (await usersForMarker(sql, marker)).find((item) => item.kind === "customer");
  if (!user) return { present: false, count: 0 };
  const rows = await sql`
    select count(*)::int as count from neon_auth.verification v
    where coalesce(to_jsonb(v)->>'value','')=${user.id}
      and coalesce(to_jsonb(v)->>'identifier','') like 'reset-password:%'
  `;
  const count = Number(rows[0]?.count || 0);
  return { present: count > 0, count };
}

async function completePasswordReset(sql, marker, env) {
  if (!env.AUDIT_SMOKE_NEXT_PASSWORD || env.AUDIT_SMOKE_NEXT_PASSWORD.length < 24) return { status: 503, body: { error: "NEXT_PASSWORD_NOT_CONFIGURED" } };
  const user = (await usersForMarker(sql, marker)).find((item) => item.kind === "customer");
  if (!user) return { status: 404, body: { error: "SMOKE_CUSTOMER_NOT_FOUND" } };
  const rows = await sql`
    select coalesce(to_jsonb(v)->>'identifier','') as identifier
    from neon_auth.verification v
    where coalesce(to_jsonb(v)->>'value','')=${user.id}
      and coalesce(to_jsonb(v)->>'identifier','') like 'reset-password:%'
    order by coalesce(to_jsonb(v)->>'createdAt',to_jsonb(v)->>'created_at','') desc limit 1
  `;
  const identifier = String(rows[0]?.identifier || "");
  if (!identifier.startsWith("reset-password:") || identifier.length <= 15) return { status: 409, body: { error: "RESET_CHALLENGE_NOT_FOUND" } };
  const token = identifier.slice("reset-password:".length);
  const response = await fetch(`${APP_BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", origin: APP_BASE, referer: `${APP_BASE}/reimposta-password` },
    body: JSON.stringify({ newPassword: env.AUDIT_SMOKE_NEXT_PASSWORD, token }),
  });
  try { await response.body?.cancel(); } catch { /* ignore */ }
  return { status: response.ok ? 200 : 409, body: { completed: response.ok, providerStatus: response.status } };
}

async function promote(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const allowed = expectedEmails(marker);
  if (users.length !== 3 || users.some((user) => !allowed.has(user.email))) return { status: 409, body: { error: "SMOKE_IDENTITY_SCOPE_MISMATCH", count: users.length } };
  const target = users.find((user) => user.kind === "admin");
  if (!target) return { status: 409, body: { error: "SMOKE_ADMIN_NOT_FOUND" } };
  await sql`update neon_auth.user set role='admin' where id::text=${target.id}`;
  const after = await state(sql, marker);
  if (after.qaAdmins !== 1 || after.superAdmins !== 2) return { status: 409, body: { error: "SMOKE_ADMIN_PROMOTION_POSTCONDITION", qaAdmins: after.qaAdmins, superAdmins: after.superAdmins } };
  return { status: 200, body: { promoted: true, ...after } };
}

async function cleanupUsers(sql, users) {
  for (const user of users) {
    await sql`delete from public.platform_admin_audit where actor_auth_user_id=${user.id} or target_id=${user.id}`;
    await sql`delete from neon_auth.verification v where coalesce(to_jsonb(v)->>'value','')=${user.id}`;
    await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;
    await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=${user.id}`;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id} or coalesce(to_jsonb(s)->>'impersonatedBy',to_jsonb(s)->>'impersonated_by','')=${user.id}`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;
    await sql`delete from public.app_users where auth_user_id=${user.id}`;
    await sql`delete from neon_auth.user where id::text=${user.id}`;
  }
}

async function cleanup(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const allowed = expectedEmails(marker);
  if (users.length > 3 || users.some((user) => !allowed.has(user.email))) return { status: 409, body: { error: "SMOKE_CLEANUP_SCOPE_MISMATCH", count: users.length } };
  await cleanupUsers(sql, users);
  return { status: 200, body: { cleaned: true, ...await state(sql, marker) } };
}

async function cleanupRecognizedResidue(sql, marker) {
  const users = await allRecognizedSmokeUsers(sql);
  if (users.some((user) => !recognizedSmokeEmail.test(user.email))) return { status: 409, body: { error: "STALE_SMOKE_SCOPE_MISMATCH" } };
  const cleanedUsers = users.length;
  const cleanedAdmins = users.filter((user) => user.role === "admin").length;
  await cleanupUsers(sql, users);
  const after = await state(sql, marker);
  if (after.recognizedQaUsers !== 0 || after.recognizedQaAdmins !== 0) return { status: 409, body: { error: "STALE_SMOKE_CLEANUP_POSTCONDITION" } };
  return { status: 200, body: { cleaned: true, cleanedUsers, cleanedAdmins, ...after } };
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
    const allowed = ["preflight", "state", "promote", "impersonation-state", "user-state", "audit-state", "password-reset-state", "complete-password-reset", "cleanup", "cleanup-residue"];
    if (!allowed.includes(body?.action)) return json({ error: "INVALID_ACTION" }, 400);
    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "preflight" || body.action === "state") return json(await state(sql, body.marker));
      if (body.action === "impersonation-state") return json(await impersonationState(sql, body.marker));
      if (body.action === "user-state") return json(await userState(sql, body.marker));
      if (body.action === "audit-state") return json(await auditState(sql, body.marker));
      if (body.action === "password-reset-state") return json(await passwordResetState(sql, body.marker));
      if (body.action === "complete-password-reset") { const result = await completePasswordReset(sql, body.marker, env); return json(result.body, result.status); }
      if (body.action === "promote") { const result = await promote(sql, body.marker); return json(result.body, result.status); }
      if (body.action === "cleanup-residue") { const result = await cleanupRecognizedResidue(sql, body.marker); return json(result.body, result.status); }
      const result = await cleanup(sql, body.marker); return json(result.body, result.status);
    } catch (reason) {
      console.error("same-origin-auth-boundary-preview-controller", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "CONTROLLER_FAILED" }, 500);
    }
  },
};
