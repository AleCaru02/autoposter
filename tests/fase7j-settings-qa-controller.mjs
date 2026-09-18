import { neon } from "@neondatabase/serverless";

const emailPattern = /^settings7j-([a-z0-9]{10,32})-(owner|other)@example\.invalid$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function sameSecret(a, b) { if (!a || !b || a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function validMarker(value) { return typeof value === "string" && /^[a-z0-9]{10,32}$/.test(value); }

async function qaUsers(sql, marker = null) {
  const rows = await sql`select id::text id,lower(coalesce(to_jsonb(u)->>'email','')) email from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like 'settings7j-%@example.invalid' order by email`;
  return rows.map((row) => ({ ...row, match: emailPattern.exec(row.email) })).filter((row) => row.match && (!marker || row.match[1] === marker));
}

async function state(sql, marker) {
  const users = await qaUsers(sql, marker); const all = await qaUsers(sql); const pattern = `settings7j-${marker}-%@example.invalid`;
  const rows = await sql`select
    (select count(*)::int from public.profiles) profiles_total,
    (select count(*)::int from public.publication_jobs) jobs_total,
    (select count(*)::int from public.metric_snapshots) snapshots_total,
    (select count(*)::int from public.analytics_sync_targets) targets_total,
    (select count(*)::int from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_profiles,
    (select count(*)::int from public.profile_entitlements e join public.profiles p on p.id=e.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_entitlements,
    (select count(*)::int from public.capability_usage_buckets b join public.profiles p on p.id=b.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_usage`;
  const row = rows[0] || {};
  return { qaUsers: users.length, recognizedQaUsers: all.length, profilesTotal: Number(row.profiles_total || 0), jobsTotal: Number(row.jobs_total || 0), snapshotsTotal: Number(row.snapshots_total || 0), targetsTotal: Number(row.targets_total || 0), qaProfiles: Number(row.qa_profiles || 0), qaEntitlements: Number(row.qa_entitlements || 0), qaUsage: Number(row.qa_usage || 0) };
}

async function ownedProfile(sql, marker, profileId) {
  if (!UUID.test(profileId || "")) return false;
  const email = `settings7j-${marker}-owner@example.invalid`;
  const rows = await sql`select p.id from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id where p.id=${profileId}::uuid and lower(coalesce(to_jsonb(u)->>'email',''))=${email}`;
  return Boolean(rows[0]);
}

async function fixture(sql, marker, profileId) {
  if (!await ownedProfile(sql, marker, profileId)) throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  await sql`insert into public.profile_entitlements(profile_id,capability_key,enabled,limit_type,limit_value,period_type,source,metadata)
    values (${profileId}::uuid,'ai.content.generate_text',true,'COUNT_PER_MONTH',50,'MONTH','INTERNAL_BASELINE','{"qa":true}'::jsonb),
           (${profileId}::uuid,'autopilot.manage',true,'BOOLEAN',NULL,'NONE','INTERNAL_BASELINE','{"qa":true}'::jsonb)
    on conflict (profile_id,capability_key) do update set enabled=excluded.enabled,limit_type=excluded.limit_type,limit_value=excluded.limit_value,period_type=excluded.period_type,source=excluded.source,updated_at=now()`;
  await sql`insert into public.capability_usage_buckets(profile_id,capability_key,period_start,period_end,reserved_quantity,committed_quantity)
    values (${profileId}::uuid,'ai.content.generate_text',date_trunc('month',now()),date_trunc('month',now())+interval '1 month',0,18)
    on conflict (profile_id,capability_key,period_start,period_end) do update set reserved_quantity=0,committed_quantity=18,updated_at=now()`;
  return { ready: true };
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

export default { async fetch(request, env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!sameSecret(request.headers.get("x-settings7j-token") || "", env.SETTINGS7J_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
  let body; try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
  if (!validMarker(body?.marker) || !env.DATABASE_URL) return json({ error: "INVALID_REQUEST" }, 400);
  const sql = neon(env.DATABASE_URL);
  try {
    if (body.action === "preflight" || body.action === "state") return json(await state(sql, body.marker));
    if (body.action === "fixture") return json(await fixture(sql, body.marker, body.profileId));
    if (body.action === "cleanup" || body.action === "cleanup-residue") { const users = body.action === "cleanup" ? await qaUsers(sql, body.marker) : await qaUsers(sql); await cleanupUsers(sql, users); return json({ cleaned: true, ...await state(sql, body.marker) }); }
    return json({ error: "INVALID_ACTION" }, 400);
  } catch (reason) {
    console.error("fase7j-controller", reason instanceof Error ? reason.message : "unknown");
    return json({ error: "CONTROLLER_FAILED" }, 500);
  }
} };
