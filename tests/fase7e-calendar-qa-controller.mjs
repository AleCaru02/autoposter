import { neon } from "@neondatabase/serverless";

const emailPattern = /^calendar7e-([a-z0-9]{10,32})-(owner|other)@example\.invalid$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function sameSecret(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function validMarker(value) { return typeof value === "string" && /^[a-z0-9]{10,32}$/.test(value); }

async function qaUsers(sql, marker = null) {
  const rows = await sql`
    select id::text as id, lower(coalesce(to_jsonb(u)->>'email', '')) as email
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like 'calendar7e-%@example.invalid'
    order by email
  `;
  return rows.map((row) => ({ ...row, match: emailPattern.exec(row.email) })).filter((row) => row.match && (!marker || row.match[1] === marker));
}

async function state(sql, marker) {
  const users = await qaUsers(sql, marker);
  const all = await qaUsers(sql);
  const scopedEmail = `calendar7e-${marker}-%@example.invalid`;
  const metrics = await sql`
    select
      (select count(*)::int from public.profiles) profiles_total,
      (select count(*)::int from (select p.id from public.profiles p left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER' group by p.id having count(pm.user_id)<>1) broken) profiles_without_owner,
      (select count(*)::int from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${scopedEmail}) qa_profiles,
      (select count(*)::int from public.schedules s join public.profiles p on p.id=s.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${scopedEmail}) qa_schedules,
      (select count(*)::int from public.publication_jobs j join public.profiles p on p.id=j.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${scopedEmail}) qa_jobs,
      (select count(*)::int from public.capability_usage_events e join public.profiles p on p.id=e.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${scopedEmail} and e.state='COMMITTED') qa_committed,
      (select count(*)::int from public.capability_usage_events e join public.profiles p on p.id=e.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${scopedEmail} and e.state='RELEASED') qa_released,
      (select count(*)::int from public.capability_usage_events e join public.profiles p on p.id=e.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${scopedEmail} and e.state='RESERVED') qa_reserved
  `;
  const row = metrics[0] || {};
  return {
    qaUsers: users.length, recognizedQaUsers: all.length,
    profilesTotal: Number(row.profiles_total || 0), profilesWithoutOwner: Number(row.profiles_without_owner || 0),
    qaProfiles: Number(row.qa_profiles || 0), qaSchedules: Number(row.qa_schedules || 0), qaJobs: Number(row.qa_jobs || 0),
    qaCommitted: Number(row.qa_committed || 0), qaReleased: Number(row.qa_released || 0), qaReserved: Number(row.qa_reserved || 0),
  };
}

async function ownedProfile(sql, marker, profileId) {
  if (!UUID.test(profileId || "")) return null;
  const email = `calendar7e-${marker}-owner@example.invalid`;
  const rows = await sql`
    select p.id::text id from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id
    where p.id=${profileId}::uuid and lower(coalesce(to_jsonb(u)->>'email',''))=${email}
  `;
  return rows[0]?.id || null;
}

async function fixture(sql, marker, profileId) {
  if (!await ownedProfile(sql, marker, profileId)) return { status: 409, body: { error: "QA_PROFILE_SCOPE_MISMATCH" } };
  await sql`insert into public.profile_entitlements(profile_id,capability_key,enabled,limit_type,limit_value,period_type,source,metadata)
    values (${profileId}::uuid,'schedule.job.create',true,'COUNT_PER_MONTH',10,'MONTH','FASE7E_QA','{"qa":true}'::jsonb)
    on conflict (profile_id,capability_key) do update set enabled=true,limit_type='COUNT_PER_MONTH',limit_value=10,period_type='MONTH',source='FASE7E_QA',updated_at=now()`;
  await sql`insert into public.social_connections(profile_id,provider,status,provider_account_id,account_name,metadata)
    values (${profileId}::uuid,'INSTAGRAM','ACTIVE',${`calendar7e-${marker}`},'Calendar 7E QA','{"qa":true}'::jsonb)
    on conflict (profile_id,provider) do update set status='ACTIVE',provider_account_id=excluded.provider_account_id,account_name=excluded.account_name,metadata=excluded.metadata,updated_at=now()`;
  const content = await sql`insert into public.content_items(profile_id,topic,title,status)
    values (${profileId}::uuid,'Calendar 7E QA',${`Calendar 7E ${marker}`},'DRAFT') returning id::text`;
  const approved = await sql`insert into public.content_variants(content_id,profile_id,provider,format,eligible,hook,caption,approval_status)
    values (${content[0].id}::uuid,${profileId}::uuid,'INSTAGRAM','POST',true,'Calendar 7E QA','Calendar 7E runtime','APPROVED') returning id::text`;
  const pending = await sql`insert into public.content_variants(content_id,profile_id,provider,format,eligible,hook,caption,approval_status)
    values (${content[0].id}::uuid,${profileId}::uuid,'INSTAGRAM','POST',true,'Calendar 7E pending','Calendar 7E pending runtime','PENDING') returning id::text`;
  return { status: 200, body: { fixture: true, approvedVariantId: approved[0].id, pendingVariantId: pending[0].id } };
}

async function setEntitlement(sql, marker, profileId, enabled) {
  if (!await ownedProfile(sql, marker, profileId) || typeof enabled !== "boolean") return { status: 409, body: { error: "QA_PROFILE_SCOPE_MISMATCH" } };
  await sql`update public.profile_entitlements set enabled=${enabled},updated_at=now() where profile_id=${profileId}::uuid and capability_key='schedule.job.create'`;
  return { status: 200, body: { enabled } };
}

async function cleanupUsers(sql, users) {
  for (const user of users) {
    await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;
    await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=${user.id}`;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id}`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;
    await sql`delete from public.app_users where auth_user_id=${user.id}`;
    await sql`delete from neon_auth.user where id::text=${user.id}`;
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (!sameSecret(request.headers.get("x-calendar7e-token") || "", env.CALENDAR7E_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!validMarker(body?.marker) || !env.DATABASE_URL) return json({ error: "INVALID_REQUEST" }, 400);
    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "preflight" || body.action === "state") return json(await state(sql, body.marker));
      if (body.action === "fixture") { const result = await fixture(sql, body.marker, body.profileId); return json(result.body, result.status); }
      if (body.action === "entitlement") { const result = await setEntitlement(sql, body.marker, body.profileId, body.enabled); return json(result.body, result.status); }
      if (body.action === "cleanup" || body.action === "cleanup-residue") {
        const users = body.action === "cleanup" ? await qaUsers(sql, body.marker) : await qaUsers(sql);
        await cleanupUsers(sql, users);
        return json({ cleaned: true, ...(await state(sql, body.marker)) });
      }
      return json({ error: "INVALID_ACTION" }, 400);
    } catch (reason) {
      console.error("fase7e-controller", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "CONTROLLER_FAILED" }, 500);
    }
  },
};
