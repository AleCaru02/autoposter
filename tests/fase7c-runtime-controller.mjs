import { neon } from "@neondatabase/serverless";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function sameSecret(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

const markerPattern = /^[a-z0-9]{10,32}$/;
const emailPattern = /^fase7c-([a-z0-9]{10,32})-(owner|other)@example\.invalid$/;

function recognizedUser(user) {
  const match = emailPattern.exec(user.email || "");
  return match ? { ...user, marker: match[1], kind: match[2] } : null;
}

async function usersForMarker(sql, marker) {
  const like = `fase7c-${marker}-%@example.invalid`;
  const rows = await sql`
    select u.id::text as id, lower(coalesce(to_jsonb(u)->>'email', '')) as email
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like ${like}
    order by lower(coalesce(to_jsonb(u)->>'email', ''))
  `;
  return rows.map(recognizedUser).filter((user) => user?.marker === marker);
}

async function allRecognizedUsers(sql) {
  const rows = await sql`
    select u.id::text as id, lower(coalesce(to_jsonb(u)->>'email', '')) as email
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like 'fase7c-%@example.invalid'
    order by lower(coalesce(to_jsonb(u)->>'email', ''))
  `;
  return rows.map(recognizedUser).filter(Boolean);
}

async function state(sql, marker) {
  const users = await usersForMarker(sql, marker);
  const recognized = await allRecognizedUsers(sql);
  const like = `fase7c-${marker}-%@example.invalid`;
  const rows = await sql`
    with qa_profiles as (
      select p.id
      from public.profiles p
      where p.owner_auth_user_id in (
        select u.id::text from neon_auth.user u
        where lower(coalesce(to_jsonb(u)->>'email', '')) like ${like}
      )
    )
    select
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from qa_profiles) as qa_profiles,
      (select count(*)::int from public.app_users where auth_user_id in (select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${like})) as qa_app_users,
      (select count(*)::int from neon_auth.session s where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') in (select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${like})) as qa_sessions,
      (select count(*)::int from neon_auth.account a where coalesce(to_jsonb(a)->>'userId', to_jsonb(a)->>'user_id', '') in (select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${like})) as qa_accounts,
      (select count(*)::int from public.profile_members pm join public.app_users au on au.id=pm.user_id where au.auth_user_id in (select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${like}) and upper(pm.role)='OWNER') as qa_owners,
      (select count(*)::int from public.brand_profiles where profile_id in (select id from qa_profiles)) as qa_brand_profiles,
      (select count(*)::int from public.content_items where profile_id in (select id from qa_profiles)) as qa_content_items,
      (select count(*)::int from public.content_variants where profile_id in (select id from qa_profiles)) as qa_content_variants,
      (select count(*)::int from public.assets where profile_id in (select id from qa_profiles)) as qa_assets,
      (select count(*)::int from public.publication_jobs where profile_id in (select id from qa_profiles)) as qa_publication_jobs,
      (select count(*)::int from public.capability_usage_events where profile_id in (select id from qa_profiles)) as qa_capability_events,
      (select count(*)::int from public.capability_usage_events where profile_id in (select id from qa_profiles) and state='COMMITTED' and capability_key='ai.content.generate_text') as qa_text_committed,
      (select count(*)::int from public.capability_usage_events where profile_id in (select id from qa_profiles) and state='COMMITTED' and capability_key='ai.image.generate') as qa_image_committed,
      (select coalesce(jsonb_agg(distinct metadata->>'release_reason') filter (where metadata->>'release_reason' is not null), '[]'::jsonb) from public.capability_usage_events where profile_id in (select id from qa_profiles) and state='RELEASED') as qa_release_reasons,
      (select count(*)::int from public.ai_usage_events where profile_id in (select id from qa_profiles)) as qa_ai_usage_events,
      (select count(*)::int from public.profile_entitlement_package_assignments where profile_id in (select id from qa_profiles) and revoked_at is null) as qa_package_assignments,
      (select count(*)::int from public.platform_admin_audit a where a.actor_auth_user_id in (select u.id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email', '')) like ${like}) or a.target_id in (select id::text from qa_profiles)) as qa_audit_rows,
      (select count(*)::int from (
        select p.id from public.profiles p left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER'
        group by p.id having count(pm.user_id) <> 1
      ) broken) as profiles_without_owner
  `;
  const row = rows[0] || {};
  return {
    qaUsers: users.length,
    qaProfiles: Number(row.qa_profiles || 0),
    qaAppUsers: Number(row.qa_app_users || 0),
    qaSessions: Number(row.qa_sessions || 0),
    qaAccounts: Number(row.qa_accounts || 0),
    qaOwners: Number(row.qa_owners || 0),
    qaBrandProfiles: Number(row.qa_brand_profiles || 0),
    qaContentItems: Number(row.qa_content_items || 0),
    qaContentVariants: Number(row.qa_content_variants || 0),
    qaAssets: Number(row.qa_assets || 0),
    qaPublicationJobs: Number(row.qa_publication_jobs || 0),
    qaCapabilityEvents: Number(row.qa_capability_events || 0),
    qaTextCommitted: Number(row.qa_text_committed || 0),
    qaImageCommitted: Number(row.qa_image_committed || 0),
    qaReleaseReasons: Array.isArray(row.qa_release_reasons) ? row.qa_release_reasons : [],
    qaAiUsageEvents: Number(row.qa_ai_usage_events || 0),
    qaPackageAssignments: Number(row.qa_package_assignments || 0),
    qaAuditRows: Number(row.qa_audit_rows || 0),
    recognizedQaUsers: recognized.length,
    profilesTotal: Number(row.profiles_total || 0),
    profilesWithoutOwner: Number(row.profiles_without_owner || 0),
  };
}

async function cleanupUsers(sql, users) {
  for (const user of users) {
    const profiles = await sql`select id::text as id from public.profiles where owner_auth_user_id=${user.id}`;
    await sql`delete from public.platform_admin_audit where actor_auth_user_id=${user.id}`;
    for (const profile of profiles) await sql`delete from public.platform_admin_audit where target_id=${profile.id}`;
    await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;
    await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=${user.id}`;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '')=${user.id}`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId', to_jsonb(a)->>'user_id', '')=${user.id}`;
    await sql`delete from public.app_users where auth_user_id=${user.id}`;
    await sql`delete from neon_auth.user where id::text=${user.id}`;
  }
}

async function cleanup(sql, marker, all = false) {
  const users = all ? await allRecognizedUsers(sql) : await usersForMarker(sql, marker);
  if (!all) {
    const allowed = new Set([`fase7c-${marker}-owner@example.invalid`, `fase7c-${marker}-other@example.invalid`]);
    if (users.length > 2 || users.some((user) => !allowed.has(user.email))) return { ok: false, error: "QA_SCOPE_MISMATCH" };
  }
  await cleanupUsers(sql, users);
  const after = await state(sql, marker);
  return { ok: true, cleanedUsers: users.length, ...after };
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (!sameSecret(request.headers.get("x-fase7c-runtime-token") || "", env.FASE7C_RUNTIME_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!markerPattern.test(body?.marker || "")) return json({ error: "INVALID_MARKER" }, 400);
    if (!["preflight", "state", "cleanup", "cleanup-residue"].includes(body?.action)) return json({ error: "INVALID_ACTION" }, 400);
    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "preflight" || body.action === "state") return json(await state(sql, body.marker));
      const result = await cleanup(sql, body.marker, body.action === "cleanup-residue");
      return json(result, result.ok ? 200 : 409);
    } catch (reason) {
      console.error("fase7c-runtime-controller", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "CONTROLLER_FAILED" }, 500);
    }
  },
};
