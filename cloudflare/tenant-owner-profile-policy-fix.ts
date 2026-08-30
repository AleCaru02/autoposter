import { neon } from "@neondatabase/serverless";

type Env = { DATABASE_URL?: string; TENANT_CROSS_TEST_TOKEN?: string };
type SafetyCounts = {
  profiles_total: number | string;
  profiles_without_owner: number | string;
  profiles_with_multiple_owners: number | string;
  profiles_auth_identity_unresolved: number | string;
  profiles_owner_user_id_mismatch: number | string;
};
type PolicyRow = { policy_name: string; command: string };

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

export async function handleTenantOwnerMembershipMigration(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "API_NOT_FOUND" }, 404);
  if (!authorized(request, env.TENANT_CROSS_TEST_TOKEN)) return json({ error: "API_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return json({ ready: false, applied: false, error: "DATABASE_NOT_CONFIGURED" }, 503);

  const sql = neon(env.DATABASE_URL);
  try {
    const safety = await sql`
      with owner_counts as (
        select p.id,
               count(pm.user_id) filter (where upper(pm.role) = 'OWNER')::int as owner_count
        from public.profiles p
        left join public.profile_members pm on pm.profile_id = p.id
        group by p.id
      )
      select
        (select count(*)::int from public.profiles) as profiles_total,
        (select count(*)::int from owner_counts where owner_count = 0) as profiles_without_owner,
        (select count(*)::int from owner_counts where owner_count > 1) as profiles_with_multiple_owners,
        (select count(*)::int
           from public.profiles p
           left join neon_auth.user nu on nu.id::text = p.owner_auth_user_id
          where nu.id is null) as profiles_auth_identity_unresolved,
        (select count(*)::int
           from public.profiles p
           join public.app_users au on au.id = p.owner_user_id
          where au.auth_user_id is distinct from p.owner_auth_user_id) as profiles_owner_user_id_mismatch
    ` as SafetyCounts[];

    const before = safety[0];
    const safe = Number(before?.profiles_without_owner ?? 1) === 0
      && Number(before?.profiles_with_multiple_owners ?? 1) === 0
      && Number(before?.profiles_auth_identity_unresolved ?? 1) === 0
      && Number(before?.profiles_owner_user_id_mismatch ?? 1) === 0;
    if (!safe) {
      return json({
        service: "post-automatici",
        ready: false,
        applied: false,
        error: "OWNER_POLICY_FIX_PRECONDITION_FAILED",
        counts: before ?? null,
      }, 409);
    }

    await sql.transaction((txn) => [
      txn`DROP POLICY IF EXISTS profiles_owner_isolation ON public.profiles`,
      txn`DROP POLICY IF EXISTS profiles_owner_select ON public.profiles`,
      txn`DROP POLICY IF EXISTS profiles_owner_insert ON public.profiles`,
      txn`DROP POLICY IF EXISTS profiles_owner_update ON public.profiles`,
      txn`DROP POLICY IF EXISTS profiles_owner_delete ON public.profiles`,
      txn`
        CREATE POLICY profiles_owner_select
        ON public.profiles
        FOR SELECT
        USING (owner_auth_user_id = public.current_auth_user_id())
      `,
      txn`
        CREATE POLICY profiles_owner_insert
        ON public.profiles
        FOR INSERT
        WITH CHECK (owner_auth_user_id = public.current_auth_user_id())
      `,
      txn`
        CREATE POLICY profiles_owner_update
        ON public.profiles
        FOR UPDATE
        USING (owner_auth_user_id = public.current_auth_user_id())
        WITH CHECK (
          owner_auth_user_id = public.current_auth_user_id()
          AND owner_user_id = public.current_app_user_id()
        )
      `,
      txn`
        CREATE POLICY profiles_owner_delete
        ON public.profiles
        FOR DELETE
        USING (owner_auth_user_id = public.current_auth_user_id())
      `,
    ]);

    const policies = await sql`
      select policyname as policy_name, cmd as command
      from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
        and policyname like 'profiles_owner_%'
      order by policyname
    ` as PolicyRow[];
    const actual = new Map(policies.map((row) => [row.policy_name, row.command]));
    const ready = actual.get("profiles_owner_select") === "SELECT"
      && actual.get("profiles_owner_insert") === "INSERT"
      && actual.get("profiles_owner_update") === "UPDATE"
      && actual.get("profiles_owner_delete") === "DELETE"
      && !actual.has("profiles_owner_isolation");

    return json({
      service: "post-automatici",
      ready,
      applied: ready,
      migration: "20260830_profile_owner_insert_policy_fix",
      counts: before ?? null,
      policyContract: ready ? "OPERATION_SCOPED" : "INVALID",
    }, ready ? 200 : 503);
  } catch (reason) {
    return json({
      service: "post-automatici",
      ready: false,
      applied: false,
      error: reason instanceof Error ? reason.message : "OWNER_POLICY_FIX_FAILED",
    }, 503);
  }
}
