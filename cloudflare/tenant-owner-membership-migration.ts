import { neon } from "@neondatabase/serverless";

type Env = { DATABASE_URL?: string; TENANT_CROSS_TEST_TOKEN?: string };

type SafetyCounts = {
  profiles_total: number | string;
  unresolved_auth_identities: number | string;
  owner_user_mismatches: number | string;
  conflicting_owner_memberships: number | string;
};

type PostCounts = {
  profiles_total: number | string;
  profiles_with_owner: number | string;
  profiles_without_owner: number | string;
  profiles_with_multiple_owners: number | string;
  memberships_total: number | string;
  profiles_without_owner_user_id: number | string;
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

export async function handleTenantOwnerMembershipMigration(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "API_NOT_FOUND" }, 404);
  if (!authorized(request, env.TENANT_CROSS_TEST_TOKEN)) return json({ error: "API_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return json({ ready: false, applied: false, error: "DATABASE_NOT_CONFIGURED" }, 503);

  const sql = neon(env.DATABASE_URL);
  try {
    const safety = await sql`
      select
        (select count(*)::int from public.profiles) as profiles_total,
        (select count(*)::int
           from public.profiles p
           left join neon_auth.user nu on nu.id::text = p.owner_auth_user_id
          where nu.id is null) as unresolved_auth_identities,
        (select count(*)::int
           from public.profiles p
           join public.app_users au on au.id = p.owner_user_id
          where au.auth_user_id is distinct from p.owner_auth_user_id) as owner_user_mismatches,
        (select count(distinct p.id)::int
           from public.profiles p
           join public.profile_members pm on pm.profile_id = p.id and upper(pm.role) = 'OWNER'
           join public.app_users au on au.id = pm.user_id
          where au.auth_user_id is distinct from p.owner_auth_user_id) as conflicting_owner_memberships
    ` as SafetyCounts[];

    const before = safety[0];
    const safe = Number(before?.unresolved_auth_identities ?? 1) === 0
      && Number(before?.owner_user_mismatches ?? 1) === 0
      && Number(before?.conflicting_owner_memberships ?? 1) === 0;
    if (!safe) {
      return json({
        service: "post-automatici",
        ready: false,
        applied: false,
        error: "OWNER_MAPPING_NOT_PROVABLY_SAFE",
        counts: before ?? null,
      }, 409);
    }

    await sql.transaction((txn) => [
      txn`
        DO $migration_guard$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM public.profiles p
            LEFT JOIN neon_auth.user nu ON nu.id::text = p.owner_auth_user_id
            WHERE nu.id IS NULL
          ) THEN
            RAISE EXCEPTION 'OWNER_AUTH_MAPPING_UNSAFE';
          END IF;
          IF EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.app_users au ON au.id = p.owner_user_id
            WHERE au.auth_user_id IS DISTINCT FROM p.owner_auth_user_id
          ) THEN
            RAISE EXCEPTION 'OWNER_USER_MAPPING_CONFLICT';
          END IF;
          IF EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.profile_members pm ON pm.profile_id = p.id AND upper(pm.role) = 'OWNER'
            JOIN public.app_users au ON au.id = pm.user_id
            WHERE au.auth_user_id IS DISTINCT FROM p.owner_auth_user_id
          ) THEN
            RAISE EXCEPTION 'OWNER_MEMBERSHIP_CONFLICT';
          END IF;
        END
        $migration_guard$
      `,
      txn`
        INSERT INTO public.app_users (auth_user_id)
        SELECT DISTINCT p.owner_auth_user_id
        FROM public.profiles p
        JOIN neon_auth.user nu ON nu.id::text = p.owner_auth_user_id
        ON CONFLICT (auth_user_id) DO NOTHING
      `,
      txn`
        UPDATE public.profiles p
        SET owner_user_id = au.id
        FROM public.app_users au
        WHERE au.auth_user_id = p.owner_auth_user_id
          AND p.owner_user_id IS DISTINCT FROM au.id
      `,
      txn`
        DO $membership_guard$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM public.profiles p
            JOIN public.app_users au ON au.auth_user_id = p.owner_auth_user_id
            JOIN public.profile_members pm ON pm.profile_id = p.id AND pm.user_id = au.id
            WHERE upper(pm.role) <> 'OWNER'
          ) THEN
            RAISE EXCEPTION 'OWNER_ROLE_CONFLICT';
          END IF;
        END
        $membership_guard$
      `,
      txn`
        INSERT INTO public.profile_members (profile_id, user_id, role)
        SELECT p.id, p.owner_user_id, 'OWNER'
        FROM public.profiles p
        WHERE p.owner_user_id IS NOT NULL
        ON CONFLICT (profile_id, user_id) DO NOTHING
      `,
      txn`
        DO $post_backfill_guard$
        BEGIN
          IF EXISTS (
            SELECT p.id
            FROM public.profiles p
            LEFT JOIN public.profile_members pm ON pm.profile_id = p.id AND upper(pm.role) = 'OWNER'
            GROUP BY p.id
            HAVING count(pm.user_id) <> 1
          ) THEN
            RAISE EXCEPTION 'OWNER_BACKFILL_INCOMPLETE';
          END IF;
        END
        $post_backfill_guard$
      `,
      txn`ALTER TABLE public.profiles ALTER COLUMN owner_user_id SET NOT NULL`,
      txn`
        CREATE OR REPLACE FUNCTION public.current_app_user_id()
        RETURNS uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path TO 'public', 'pg_temp'
        AS $function$
          SELECT au.id
          FROM public.app_users au
          WHERE au.auth_user_id = public.current_auth_user_id()
          LIMIT 1
        $function$
      `,
      txn`
        CREATE OR REPLACE FUNCTION public.sync_profile_owner_membership()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path TO 'public', 'pg_temp'
        AS $function$
        DECLARE
          request_auth_user_id text;
          resolved_app_user_id uuid;
        BEGIN
          IF NEW.owner_auth_user_id IS NULL THEN
            RAISE EXCEPTION 'PROFILE_OWNER_REQUIRED' USING ERRCODE = '42501';
          END IF;
          request_auth_user_id := public.current_auth_user_id();
          IF request_auth_user_id IS NOT NULL
             AND NEW.owner_auth_user_id IS DISTINCT FROM request_auth_user_id THEN
            RAISE EXCEPTION 'PROFILE_OWNER_IDENTITY_MISMATCH' USING ERRCODE = '42501';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM neon_auth.user nu WHERE nu.id::text = NEW.owner_auth_user_id
          ) THEN
            RAISE EXCEPTION 'PROFILE_OWNER_AUTH_IDENTITY_UNKNOWN' USING ERRCODE = '42501';
          END IF;
          INSERT INTO public.app_users (auth_user_id)
          VALUES (NEW.owner_auth_user_id)
          ON CONFLICT (auth_user_id) DO NOTHING;
          SELECT au.id INTO resolved_app_user_id
          FROM public.app_users au
          WHERE au.auth_user_id = NEW.owner_auth_user_id;
          IF resolved_app_user_id IS NULL THEN
            RAISE EXCEPTION 'PROFILE_OWNER_APP_USER_MISSING';
          END IF;
          IF TG_WHEN = 'BEFORE' THEN
            NEW.owner_user_id := resolved_app_user_id;
            RETURN NEW;
          END IF;
          INSERT INTO public.profile_members (profile_id, user_id, role)
          VALUES (NEW.id, resolved_app_user_id, 'OWNER')
          ON CONFLICT (profile_id, user_id) DO NOTHING;
          RETURN NEW;
        END
        $function$
      `,
      txn`DROP TRIGGER IF EXISTS profiles_owner_prepare ON public.profiles`,
      txn`
        CREATE TRIGGER profiles_owner_prepare
        BEFORE INSERT ON public.profiles
        FOR EACH ROW
        EXECUTE FUNCTION public.sync_profile_owner_membership()
      `,
      txn`DROP TRIGGER IF EXISTS profiles_owner_membership ON public.profiles`,
      txn`
        CREATE TRIGGER profiles_owner_membership
        AFTER INSERT ON public.profiles
        FOR EACH ROW
        EXECUTE FUNCTION public.sync_profile_owner_membership()
      `,
      txn`DROP POLICY IF EXISTS profiles_owner_isolation ON public.profiles`,
      txn`
        CREATE POLICY profiles_owner_isolation
        ON public.profiles
        FOR ALL
        USING (owner_auth_user_id = public.current_auth_user_id())
        WITH CHECK (
          owner_auth_user_id = public.current_auth_user_id()
          AND owner_user_id = public.current_app_user_id()
        )
      `,
      txn`DROP POLICY IF EXISTS profile_members_isolation ON public.profile_members`,
      txn`DROP POLICY IF EXISTS profile_members_owner_read ON public.profile_members`,
      txn`
        CREATE POLICY profile_members_owner_read
        ON public.profile_members
        FOR SELECT
        USING (public.owns_profile(profile_id))
      `,
    ]);

    const post = await sql`
      with owner_counts as (
        select p.id,
               count(pm.user_id) filter (where upper(pm.role) = 'OWNER')::int as owner_count
        from public.profiles p
        left join public.profile_members pm on pm.profile_id = p.id
        group by p.id
      )
      select
        (select count(*)::int from public.profiles) as profiles_total,
        (select count(*)::int from owner_counts where owner_count = 1) as profiles_with_owner,
        (select count(*)::int from owner_counts where owner_count = 0) as profiles_without_owner,
        (select count(*)::int from owner_counts where owner_count > 1) as profiles_with_multiple_owners,
        (select count(*)::int from public.profile_members) as memberships_total,
        (select count(*)::int from public.profiles where owner_user_id is null) as profiles_without_owner_user_id
    ` as PostCounts[];

    const counts = post[0];
    const ready = Number(counts?.profiles_total ?? -1) === Number(counts?.profiles_with_owner ?? -2)
      && Number(counts?.profiles_without_owner ?? 1) === 0
      && Number(counts?.profiles_with_multiple_owners ?? 1) === 0
      && Number(counts?.profiles_without_owner_user_id ?? 1) === 0;

    return json({
      service: "post-automatici",
      ready,
      applied: ready,
      migration: "20260830_profile_owner_membership_contract",
      counts: counts ?? null,
    }, ready ? 200 : 503);
  } catch (reason) {
    return json({
      service: "post-automatici",
      ready: false,
      applied: false,
      error: reason instanceof Error ? reason.message : "OWNER_MEMBERSHIP_MIGRATION_FAILED",
    }, 503);
  }
}
