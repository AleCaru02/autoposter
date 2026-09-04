import { QA_ACTION_PROVIDER, QA_ACTION_BARRIER, QA_ACTION_BACKGROUND, QA_EMAIL } from "./brand-analyze-qa-common.mjs";

async function qaUsers(sql, marker = null) {
  const rows = await sql`
    select u.id::text as id,
      lower(coalesce(to_jsonb(u)->>'email','')) as email,
      lower(coalesce(u.role::text,'')) as role
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email','')) like 'brand-qa-%@example.invalid'
    order by lower(coalesce(to_jsonb(u)->>'email',''))
  `;
  const recognized = rows.map((row) => {
    const match = QA_EMAIL.exec(row.email || "");
    return match ? { ...row, marker: match[1] } : null;
  }).filter(Boolean);
  return marker ? recognized.filter((user) => user.marker === marker) : recognized;
}

export async function assertQaProfile(sql, marker, profileId) {
  if (!profileId) return false;
  const users = await qaUsers(sql, marker);
  if (!users.length) return false;
  const ids = users.map((u) => u.id);
  const rows = await sql`
    select id::text as id from public.profiles
    where id=${profileId}::uuid and owner_auth_user_id = any(${ids}::text[])
    limit 1
  `;
  return rows.length === 1;
}

export async function state(sql, marker) {
  const users = await qaUsers(sql, marker);
  const all = await qaUsers(sql);
  const userIds = users.map((u) => u.id);
  const pattern = `brand-qa-${marker}-[ab]@example.invalid`;
  const rows = await sql`
    select
      (select count(*)::int from neon_auth.user where lower(coalesce(role::text,''))='admin') as super_admins,
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from public.profiles p where p.owner_auth_user_id = any(${userIds}::text[])) as qa_profiles,
      (select count(*)::int from public.profile_members pm join public.app_users au on au.id=pm.user_id where upper(pm.role)='OWNER' and au.auth_user_id = any(${userIds}::text[])) as qa_owners,
      (select count(*)::int from public.app_users au where au.auth_user_id = any(${userIds}::text[])) as qa_app_users,
      (select count(*)::int from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','') = any(${userIds}::text[])) as qa_sessions,
      (select count(*)::int from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','') = any(${userIds}::text[])) as qa_accounts,
      (select count(*)::int from public.profile_entitlements pe where pe.profile_id in (select id from public.profiles where owner_auth_user_id = any(${userIds}::text[])) and pe.source='QA_RUNTIME') as qa_entitlements,
      (select count(*)::int from public.capability_usage_events e where e.profile_id in (select id from public.profiles where owner_auth_user_id = any(${userIds}::text[]))) as qa_usage_events,
      (select count(*)::int from public.capability_usage_buckets b where b.profile_id in (select id from public.profiles where owner_auth_user_id = any(${userIds}::text[]))) as qa_usage_buckets,
      (select count(*)::int from public.ai_usage_events e where e.profile_id in (select id from public.profiles where owner_auth_user_id = any(${userIds}::text[]))) as qa_ai_events,
      (select count(*)::int from public.capability_usage_events e where e.profile_id in (select id from public.profiles where owner_auth_user_id = any(${userIds}::text[])) and ((e.metadata->>'technical_usage_state')='PENDING_RECONCILIATION' or jsonb_array_length(coalesce(e.metadata->'technical_usage_outbox','[]'::jsonb))>0)) as qa_technical_outbox,
      (select count(*)::int from public.content_items c where c.profile_id in (select id from public.profiles where owner_auth_user_id = any(${userIds}::text[]))) as qa_content,
      (select count(*)::int from public.content_variants c where c.profile_id in (select id from public.profiles where owner_auth_user_id = any(${userIds}::text[]))) as qa_variants,
      (select count(*)::int from public.publication_jobs j where j.profile_id in (select id from public.profiles where owner_auth_user_id = any(${userIds}::text[]))) as qa_jobs,
      (select count(*)::int from public.platform_admin_audit a where a.action=${QA_ACTION_PROVIDER} and a.metadata->>'marker'=${marker}) as qa_provider_calls,
      (select count(*)::int from (
        select p.id from public.profiles p left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER'
        group by p.id having count(pm.user_id) <> 1
      ) x) as profiles_without_owner,
      (select count(*)::int from (
        select p.id from public.profiles p left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER'
        group by p.id having count(pm.user_id) > 1
      ) x) as multiple_owners,
      (select count(*)::int from public.profiles p where exists(select 1 from public.profile_members pm where pm.profile_id=p.id and upper(pm.role)='OWNER') and not exists(select 1 from public.profile_members pm where pm.profile_id=p.id and upper(pm.role)='OWNER' and pm.user_id=p.owner_user_id)) as owner_mismatch,
      (select count(*)::int from pg_policies where schemaname='public' and (qual='true' or with_check='true')) as open_policies,
      (select count(distinct table_name)::int from information_schema.role_table_grants where table_schema='public' and grantee in ('PUBLIC','anonymous') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) as anonymous_privileged_tables
  `;
  const row = rows[0] || {};
  return {
    qaUsers: users.length,
    recognizedQaUsers: all.length,
    qaProfiles: Number(row.qa_profiles || 0),
    qaOwners: Number(row.qa_owners || 0),
    qaAppUsers: Number(row.qa_app_users || 0),
    qaSessions: Number(row.qa_sessions || 0),
    qaAccounts: Number(row.qa_accounts || 0),
    qaEntitlements: Number(row.qa_entitlements || 0),
    qaUsageEvents: Number(row.qa_usage_events || 0),
    qaUsageBuckets: Number(row.qa_usage_buckets || 0),
    qaAiEvents: Number(row.qa_ai_events || 0),
    qaTechnicalOutbox: Number(row.qa_technical_outbox || 0),
    qaContent: Number(row.qa_content || 0),
    qaVariants: Number(row.qa_variants || 0),
    qaJobs: Number(row.qa_jobs || 0),
    qaProviderCalls: Number(row.qa_provider_calls || 0),
    superAdmins: Number(row.super_admins || 0),
    profilesTotal: Number(row.profiles_total || 0),
    profilesWithoutOwner: Number(row.profiles_without_owner || 0),
    multipleOwners: Number(row.multiple_owners || 0),
    ownerMismatch: Number(row.owner_mismatch || 0),
    openPolicies: Number(row.open_policies || 0),
    anonymousPrivilegedTables: Number(row.anonymous_privileged_tables || 0),
    expectedEmail: pattern,
    realProviderAvailable: false,
  };
}

async function cleanupUser(sql, user) {
  const profiles = await sql`select id::text as id from public.profiles where owner_auth_user_id=${user.id}`;
  for (const profile of profiles) {
    const id = profile.id;
    await sql`delete from public.publication_attempts where job_id in (select id from public.publication_jobs where profile_id=${id}::uuid)`;
    await sql`delete from public.publication_jobs where profile_id=${id}::uuid`;
    await sql`delete from public.content_variants where profile_id=${id}::uuid`;
    await sql`delete from public.content_items where profile_id=${id}::uuid`;
    await sql`delete from public.ai_usage_events where profile_id=${id}::uuid`;
    await sql`delete from public.capability_usage_events where profile_id=${id}::uuid`;
    await sql`delete from public.capability_usage_buckets where profile_id=${id}::uuid`;
    await sql`delete from public.profile_entitlements where profile_id=${id}::uuid`;
    await sql`delete from public.website_pages where profile_id=${id}::uuid`;
    await sql`delete from public.website_scans where profile_id=${id}::uuid`;
    await sql`delete from public.schedules where profile_id=${id}::uuid`;
    await sql`delete from public.content_strategies where profile_id=${id}::uuid`;
    await sql`delete from public.brand_profiles where profile_id=${id}::uuid`;
    await sql`delete from public.assets where profile_id=${id}::uuid`;
    await sql`delete from public.metric_snapshots where profile_id=${id}::uuid`;
    await sql`delete from public.learning_insights where profile_id=${id}::uuid`;
    await sql`delete from public.profiles where id=${id}::uuid`;
  }
  await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=${user.id}`;
  await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id}`;
  await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;
  await sql`delete from public.app_users where auth_user_id=${user.id}`;
  await sql`delete from neon_auth.user where id::text=${user.id}`;
}

export async function cleanup(sql, marker, allRecognized = false) {
  const users = allRecognized ? await qaUsers(sql) : await qaUsers(sql, marker);
  for (const user of users) await cleanupUser(sql, user);
  if (allRecognized) {
    await sql`delete from public.platform_admin_audit where action in (${QA_ACTION_PROVIDER},${QA_ACTION_BARRIER},${QA_ACTION_BACKGROUND}) and actor_auth_user_id like 'BRAND_ANALYZE_QA_%'`;
  } else {
    await sql`delete from public.platform_admin_audit where action in (${QA_ACTION_PROVIDER},${QA_ACTION_BARRIER},${QA_ACTION_BACKGROUND}) and metadata->>'marker'=${marker}`;
  }
  return { cleaned: true, cleanedUsers: users.length, ...(await state(sql, marker)) };
}
