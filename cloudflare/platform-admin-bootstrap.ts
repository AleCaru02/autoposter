import { neon } from "@neondatabase/serverless";

type BootstrapEnv = {
  DATABASE_URL?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
};

type CandidateRow = {
  owner_identity_count: number;
  candidate_auth_user_id: string | null;
  profile_count: number;
};

type RoleRow = { role: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function sameSecret(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

async function ensurePlatformAdminAudit(sql: ReturnType<typeof neon>) {
  await sql`
    create table if not exists public.platform_admin_audit (
      id uuid primary key default gen_random_uuid(),
      actor_auth_user_id text not null,
      action text not null,
      target_type text,
      target_id text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `;
  await sql`create index if not exists platform_admin_audit_created_at_idx on public.platform_admin_audit (created_at desc)`;
  await sql`create index if not exists platform_admin_audit_actor_idx on public.platform_admin_audit (actor_auth_user_id, created_at desc)`;
  await sql`alter table public.platform_admin_audit enable row level security`;
  await sql`revoke all on table public.platform_admin_audit from public`;
  await sql`
    do $revoke_roles$
    begin
      if exists (select 1 from pg_roles where rolname = 'anonymous') then
        execute 'revoke all on table public.platform_admin_audit from anonymous';
      end if;
      if exists (select 1 from pg_roles where rolname = 'authenticated') then
        execute 'revoke all on table public.platform_admin_audit from authenticated';
      end if;
    end
    $revoke_roles$
  `;
}

export async function handleInitialSuperAdminBootstrap(request: Request, env: BootstrapEnv) {
  // The route deliberately disappears when the ephemeral deployment secret is absent.
  if (!env.ADMIN_BOOTSTRAP_TOKEN) return json({ error: "API_NOT_FOUND" }, 404);
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const supplied = request.headers.get("x-bootstrap-token") || "";
  if (!sameSecret(supplied, env.ADMIN_BOOTSTRAP_TOKEN)) return json({ error: "FORBIDDEN" }, 403);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  try {
    const sql = neon(env.DATABASE_URL);
    await ensurePlatformAdminAudit(sql);

    // No email or frontend constant is used. The bootstrap is allowed only when
    // production data proves one and only one Neon Auth identity owns all
    // existing profiles. Otherwise it refuses to choose an account.
    const candidates = await sql`
      select
        count(distinct p.owner_auth_user_id)::int as owner_identity_count,
        case when count(distinct p.owner_auth_user_id) = 1 then min(p.owner_auth_user_id) else null end as candidate_auth_user_id,
        count(*)::int as profile_count
      from public.profiles p
      join neon_auth.user nu on nu.id::text = p.owner_auth_user_id
    ` as CandidateRow[];
    const candidate = candidates[0];
    if (!candidate || candidate.profile_count < 1 || candidate.owner_identity_count !== 1 || !candidate.candidate_auth_user_id) {
      return json({
        configured: false,
        reason: "BOOTSTRAP_OWNER_NOT_UNIQUE",
        ownerIdentityCount: candidate?.owner_identity_count ?? null,
        profileCount: candidate?.profile_count ?? null,
      }, 409);
    }

    const authUserId = candidate.candidate_auth_user_id;
    const roles = await sql`
      select role::text as role
      from neon_auth.user
      where id::text = ${authUserId}
      limit 1
    ` as RoleRow[];
    if (!roles[0]) return json({ configured: false, reason: "BOOTSTRAP_AUTH_USER_MISSING" }, 409);

    const alreadyConfigured = roles[0].role?.trim().toLowerCase() === "admin";
    if (!alreadyConfigured) {
      await sql`update neon_auth.user set role = 'admin' where id::text = ${authUserId}`;
      await sql`
        insert into public.platform_admin_audit (
          actor_auth_user_id, action, target_type, target_id, metadata
        ) values (
          ${authUserId},
          'INITIAL_SUPER_ADMIN_BOOTSTRAP',
          'AUTH_USER',
          ${authUserId},
          ${JSON.stringify({ source: "unique_existing_profile_owner", profileCount: candidate.profile_count })}::jsonb
        )
      `;
    }

    return json({
      configured: true,
      alreadyConfigured,
      source: "unique_existing_profile_owner",
      ownerIdentityCount: candidate.owner_identity_count,
      profileCount: candidate.profile_count,
    });
  } catch (reason) {
    console.error("initial-super-admin-bootstrap", reason instanceof Error ? reason.message : "unknown");
    return json({ configured: false, reason: "BOOTSTRAP_FAILED" }, 500);
  }
}
