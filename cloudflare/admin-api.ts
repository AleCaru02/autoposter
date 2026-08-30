import { neon } from "@neondatabase/serverless";
import { requireSuperAdmin, type PlatformAuthEnv } from "./platform-rbac.js";

type AdminEnv = PlatformAuthEnv;

type OverviewRow = {
  users_total: number;
  profiles_total: number;
  onboarding_completed: number;
  onboarding_incomplete: number;
  social_connections_total: number;
};

type CustomerRow = {
  auth_user_id: string;
  name: string | null;
  email: string | null;
  created_at: string | null;
  role: string | null;
  banned: boolean | null;
  profile_count: number;
  onboarding_completed: number;
  onboarding_incomplete: number;
};

type ProfileRow = {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  onboarding_completed: boolean;
  created_at: string;
};

type MembershipRow = { profile_id: string; profile_name: string; role: string };
type SocialCountRow = { profile_id: string; connections: number };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function audit(env: AdminEnv, actorAuthUserId: string, action: string, targetType?: string, targetId?: string, metadata: Record<string, unknown> = {}) {
  if (!env.DATABASE_URL) return;
  const sql = neon(env.DATABASE_URL);
  await sql`
    insert into public.platform_admin_audit (actor_auth_user_id, action, target_type, target_id, metadata)
    values (${actorAuthUserId}, ${action}, ${targetType ?? null}, ${targetId ?? null}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

async function authorize(request: Request, env: AdminEnv) {
  const auth = await requireSuperAdmin(request, env);
  if (!auth.ok) return auth;
  return auth;
}

export async function handleAdminApi(request: Request, env: AdminEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/admin/")) return null;
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const auth = await authorize(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const sql = neon(env.DATABASE_URL);

  try {
    if (path === "/api/admin/me") {
      await audit(env, auth.user.authUserId, "ADMIN_ACCESS", "PLATFORM", "BACKOFFICE");
      return json({ platformRole: auth.user.platformRole });
    }

    if (path === "/api/admin/overview") {
      const rows = await sql`
        select
          (select count(*)::int from neon_auth.user) as users_total,
          (select count(*)::int from public.profiles) as profiles_total,
          (select count(*)::int from public.profiles where onboarding_completed is true) as onboarding_completed,
          (select count(*)::int from public.profiles where coalesce(onboarding_completed, false) is false) as onboarding_incomplete,
          (select count(*)::int from public.social_connections) as social_connections_total
      ` as OverviewRow[];
      await audit(env, auth.user.authUserId, "ADMIN_OVERVIEW_VIEW", "PLATFORM", "OVERVIEW");
      return json({ overview: rows[0] ?? null });
    }

    if (path === "/api/admin/customers") {
      const rows = await sql`
        select
          nu.id::text as auth_user_id,
          nullif(to_jsonb(nu)->>'name', '') as name,
          nullif(to_jsonb(nu)->>'email', '') as email,
          coalesce(to_jsonb(nu)->>'createdAt', to_jsonb(nu)->>'created_at') as created_at,
          nu.role::text as role,
          coalesce(nu.banned, false) as banned,
          (select count(*)::int from public.profiles p where p.owner_auth_user_id = nu.id::text) as profile_count,
          (select count(*)::int from public.profiles p where p.owner_auth_user_id = nu.id::text and p.onboarding_completed is true) as onboarding_completed,
          (select count(*)::int from public.profiles p where p.owner_auth_user_id = nu.id::text and coalesce(p.onboarding_completed, false) is false) as onboarding_incomplete
        from neon_auth.user nu
        order by coalesce(to_jsonb(nu)->>'createdAt', to_jsonb(nu)->>'created_at') desc nulls last, nu.id::text
        limit 500
      ` as CustomerRow[];
      await audit(env, auth.user.authUserId, "ADMIN_CUSTOMERS_LIST", "PLATFORM", "CUSTOMERS", { resultCount: rows.length });
      return json({ customers: rows.map((row) => ({ ...row, platform_role: row.role?.toLowerCase() === "admin" ? "SUPER_ADMIN" : "CUSTOMER" })) });
    }

    if (path === "/api/admin/activities") {
      const rows = await sql`
        select p.id, p.name, p.website_url, p.industry, p.onboarding_completed, p.created_at,
          nullif(to_jsonb(nu)->>'name', '') as owner_name,
          nullif(to_jsonb(nu)->>'email', '') as owner_email,
          (select count(*)::int from public.social_connections sc where sc.profile_id = p.id) as social_connections
        from public.profiles p
        left join neon_auth.user nu on nu.id::text = p.owner_auth_user_id
        order by p.created_at desc
        limit 1000
      `;
      await audit(env, auth.user.authUserId, "ADMIN_ACTIVITIES_LIST", "PLATFORM", "ACTIVITIES", { resultCount: rows.length });
      return json({ activities: rows });
    }

    const customerMatch = path.match(/^\/api\/admin\/customers\/([^/]+)$/);
    if (customerMatch) {
      const targetAuthUserId = decodeURIComponent(customerMatch[1]);
      if (!targetAuthUserId || targetAuthUserId.length > 256) return json({ error: "INVALID_CUSTOMER" }, 400);
      const users = await sql`
        select
          nu.id::text as auth_user_id,
          nullif(to_jsonb(nu)->>'name', '') as name,
          nullif(to_jsonb(nu)->>'email', '') as email,
          coalesce(to_jsonb(nu)->>'createdAt', to_jsonb(nu)->>'created_at') as created_at,
          nu.role::text as role,
          coalesce(nu.banned, false) as banned
        from neon_auth.user nu
        where nu.id::text = ${targetAuthUserId}
        limit 1
      ` as CustomerRow[];
      if (!users[0]) return json({ error: "CUSTOMER_NOT_FOUND" }, 404);

      const profiles = await sql`
        select id, name, website_url, industry, onboarding_completed, created_at
        from public.profiles
        where owner_auth_user_id = ${targetAuthUserId}
        order by created_at asc
      ` as ProfileRow[];
      const memberships = await sql`
        select pm.profile_id, p.name as profile_name, pm.role
        from public.app_users au
        join public.profile_members pm on pm.user_id = au.id
        join public.profiles p on p.id = pm.profile_id
        where au.auth_user_id = ${targetAuthUserId}
        order by p.created_at asc, pm.role
      ` as MembershipRow[];
      const socialCounts = await sql`
        select sc.profile_id, count(*)::int as connections
        from public.social_connections sc
        join public.profiles p on p.id = sc.profile_id
        where p.owner_auth_user_id = ${targetAuthUserId}
        group by sc.profile_id
      ` as SocialCountRow[];
      await audit(env, auth.user.authUserId, "ADMIN_CUSTOMER_DETAIL_VIEW", "AUTH_USER", targetAuthUserId, { profileCount: profiles.length });
      return json({
        customer: {
          ...users[0],
          platform_role: users[0].role?.toLowerCase() === "admin" ? "SUPER_ADMIN" : "CUSTOMER",
        },
        profiles,
        memberships,
        socialConnectionsByProfile: socialCounts,
      });
    }

    return json({ error: "API_NOT_FOUND" }, 404);
  } catch (reason) {
    console.error("admin-api", { path, detail: reason instanceof Error ? reason.message : "unknown" });
    return json({ error: "ADMIN_API_FAILED" }, 500);
  }
}
