import { neon } from "@neondatabase/serverless";

type Env = { DATABASE_URL?: string; TENANT_CROSS_TEST_TOKEN?: string };

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

type TriggerRow = { table_name: string; trigger_name: string; definition: string };
type PolicyRow = { table_name: string; policy_name: string; command: string; permissive: string; using_expression: string | null; check_expression: string | null };
type ConstraintRow = { table_name: string; constraint_name: string; constraint_type: string; definition: string };
type FunctionRow = { function_name: string; definition: string };
type CountRow = {
  profiles_total: number | string;
  profiles_with_owner: number | string;
  profiles_without_owner: number | string;
  profiles_with_multiple_owners: number | string;
  memberships_total: number | string;
  app_users_total: number | string;
  profiles_auth_identity_confirmed: number | string;
  profiles_auth_identity_unresolved: number | string;
  profiles_app_user_mapped: number | string;
  profiles_app_user_unmapped: number | string;
  profiles_owner_user_id_set: number | string;
  profiles_owner_user_id_mismatch: number | string;
  conflicting_owner_memberships: number | string;
};

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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleTenantMembershipDiagnostic(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "API_NOT_FOUND" }, 404);
  if (!authorized(request, env.TENANT_CROSS_TEST_TOKEN)) return json({ error: "API_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return json({ ready: false, error: "DATABASE_NOT_CONFIGURED" }, 503);

  try {
    const sql = neon(env.DATABASE_URL);
    const columns = await sql`
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name in ('profiles', 'profile_members', 'app_users')
      order by table_name, ordinal_position
    ` as ColumnRow[];

    const triggers = await sql`
      select c.relname as table_name,
             t.tgname as trigger_name,
             pg_get_triggerdef(t.oid, true) as definition
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('profiles', 'profile_members')
        and not t.tgisinternal
      order by c.relname, t.tgname
    ` as TriggerRow[];

    const policies = await sql`
      select tablename as table_name,
             policyname as policy_name,
             cmd as command,
             permissive,
             qual as using_expression,
             with_check as check_expression
      from pg_policies
      where schemaname = 'public' and tablename in ('profiles', 'profile_members')
      order by tablename, policyname
    ` as PolicyRow[];

    const constraints = await sql`
      select c.relname as table_name,
             con.conname as constraint_name,
             con.contype::text as constraint_type,
             pg_get_constraintdef(con.oid, true) as definition
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname in ('profiles', 'profile_members', 'app_users')
      order by c.relname, con.conname
    ` as ConstraintRow[];

    const functions = await sql`
      select p.proname as function_name,
             pg_get_functiondef(p.oid) as definition
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('current_auth_user_id', 'current_app_user_id', 'owns_profile', 'sync_profile_owner_membership')
      order by p.proname
    ` as FunctionRow[];

    const counts = await sql`
      with owner_counts as (
        select p.id,
               count(pm.user_id) filter (where upper(pm.role) = 'OWNER')::int as owner_count
        from public.profiles p
        left join public.profile_members pm on pm.profile_id = p.id
        group by p.id
      ), profile_map as (
        select p.id,
               p.owner_auth_user_id,
               p.owner_user_id,
               exists(select 1 from neon_auth.user nu where nu.id::text = p.owner_auth_user_id) as auth_identity_confirmed,
               au_by_auth.id as mapped_app_user_id,
               au_by_owner.auth_user_id as owner_user_auth_user_id
        from public.profiles p
        left join public.app_users au_by_auth on au_by_auth.auth_user_id = p.owner_auth_user_id
        left join public.app_users au_by_owner on au_by_owner.id = p.owner_user_id
      )
      select
        (select count(*)::int from public.profiles) as profiles_total,
        (select count(*)::int from owner_counts where owner_count >= 1) as profiles_with_owner,
        (select count(*)::int from owner_counts where owner_count = 0) as profiles_without_owner,
        (select count(*)::int from owner_counts where owner_count > 1) as profiles_with_multiple_owners,
        (select count(*)::int from public.profile_members) as memberships_total,
        (select count(*)::int from public.app_users) as app_users_total,
        (select count(*)::int from profile_map where auth_identity_confirmed) as profiles_auth_identity_confirmed,
        (select count(*)::int from profile_map where not auth_identity_confirmed) as profiles_auth_identity_unresolved,
        (select count(*)::int from profile_map where mapped_app_user_id is not null) as profiles_app_user_mapped,
        (select count(*)::int from profile_map where mapped_app_user_id is null) as profiles_app_user_unmapped,
        (select count(*)::int from profile_map where owner_user_id is not null) as profiles_owner_user_id_set,
        (select count(*)::int from profile_map where owner_user_id is not null and owner_user_auth_user_id is distinct from owner_auth_user_id) as profiles_owner_user_id_mismatch,
        (select count(distinct p.id)::int
           from public.profiles p
           join public.profile_members pm on pm.profile_id = p.id and upper(pm.role) = 'OWNER'
           join public.app_users au on au.id = pm.user_id
          where au.auth_user_id is distinct from p.owner_auth_user_id) as conflicting_owner_memberships
    ` as CountRow[];

    return json({
      service: "post-automatici",
      ready: true,
      membershipContract: {
        columns,
        triggers,
        policies,
        constraints,
        functions,
        counts: counts[0] ?? null,
      },
    });
  } catch (reason) {
    return json({ ready: false, error: reason instanceof Error ? reason.message : "MEMBERSHIP_DIAGNOSTIC_FAILED" }, 503);
  }
}
