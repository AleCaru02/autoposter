import { neon } from "@neondatabase/serverless";
import { requireSuperAdmin, type PlatformAuthEnv } from "./platform-rbac.js";

type SessionAdminEnv = PlatformAuthEnv;

type SessionRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

type CustomerIdentityRow = {
  auth_user_id: string;
};

type RevokedSessionRow = {
  id: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function decodeSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded && decoded.length <= 256 ? decoded : null;
  } catch {
    return null;
  }
}

function validSessionId(value: string) {
  return value.length >= 8 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function browserSafeSession(row: SessionRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

async function audit(
  env: SessionAdminEnv,
  actorAuthUserId: string,
  action: "USER_SESSION_REVOKED" | "USER_SESSIONS_REVOKED",
  targetAuthUserId: string,
  metadata: Record<string, unknown>,
) {
  if (!env.DATABASE_URL) return;
  const sql = neon(env.DATABASE_URL);
  await sql`
    insert into public.platform_admin_audit (actor_auth_user_id, action, target_type, target_id, metadata)
    values (${actorAuthUserId}, ${action}, 'AUTH_USER', ${targetAuthUserId}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

async function resolveCustomer(sql: ReturnType<typeof neon>, targetAuthUserId: string) {
  const rows = await sql`
    select nu.id::text as auth_user_id
    from neon_auth.user nu
    where nu.id::text = ${targetAuthUserId}
      and lower(coalesce(nu.role::text, '')) <> 'admin'
    limit 1
  ` as CustomerIdentityRow[];
  return rows[0]?.auth_user_id ?? null;
}

async function listSessions(sql: ReturnType<typeof neon>, targetAuthUserId: string) {
  return sql`
    select
      coalesce(to_jsonb(s)->>'id', '') as id,
      coalesce(to_jsonb(s)->>'createdAt', to_jsonb(s)->>'created_at') as created_at,
      coalesce(to_jsonb(s)->>'updatedAt', to_jsonb(s)->>'updated_at') as updated_at,
      coalesce(to_jsonb(s)->>'expiresAt', to_jsonb(s)->>'expires_at') as expires_at,
      coalesce(to_jsonb(s)->>'ipAddress', to_jsonb(s)->>'ip_address') as ip_address,
      coalesce(to_jsonb(s)->>'userAgent', to_jsonb(s)->>'user_agent') as user_agent
    from neon_auth.session s
    where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') = ${targetAuthUserId}
    order by coalesce(to_jsonb(s)->>'updatedAt', to_jsonb(s)->>'updated_at', '') desc,
      coalesce(to_jsonb(s)->>'createdAt', to_jsonb(s)->>'created_at', '') desc,
      coalesce(to_jsonb(s)->>'id', '') desc
  ` as Promise<SessionRow[]>;
}

export async function handleAdminSessionApi(request: Request, env: SessionAdminEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  const collectionMatch = path.match(/^\/api\/admin\/customers\/([^/]+)\/sessions$/);
  const singleMatch = path.match(/^\/api\/admin\/customers\/([^/]+)\/sessions\/([^/]+)$/);
  if (!collectionMatch && !singleMatch) return null;

  if (collectionMatch && request.method !== "GET" && request.method !== "DELETE") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (singleMatch && request.method !== "DELETE") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const auth = await requireSuperAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  const rawCustomerId = collectionMatch?.[1] ?? singleMatch?.[1] ?? "";
  const targetAuthUserId = decodeSegment(rawCustomerId);
  if (!targetAuthUserId) return json({ error: "INVALID_CUSTOMER" }, 400);

  const sql = neon(env.DATABASE_URL);
  try {
    const customerAuthUserId = await resolveCustomer(sql, targetAuthUserId);
    if (!customerAuthUserId) return json({ error: "CUSTOMER_NOT_FOUND" }, 404);

    if (collectionMatch && request.method === "GET") {
      const rows = await listSessions(sql, customerAuthUserId);
      return json({ sessions: rows.map(browserSafeSession) });
    }

    if (singleMatch) {
      const sessionId = decodeSegment(singleMatch[2] ?? "");
      if (!sessionId || !validSessionId(sessionId)) return json({ error: "INVALID_SESSION" }, 400);

      const deleted = await sql`
        delete from neon_auth.session s
        where coalesce(to_jsonb(s)->>'id', '') = ${sessionId}
          and coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') = ${customerAuthUserId}
        returning coalesce(to_jsonb(s)->>'id', '') as id
      ` as RevokedSessionRow[];
      if (deleted.length !== 1) return json({ error: "SESSION_NOT_FOUND" }, 404);

      await audit(env, auth.user.authUserId, "USER_SESSION_REVOKED", customerAuthUserId, { sessionRef: sessionId });
      return json({ revoked: true, sessionId });
    }

    const deleted = await sql`
      delete from neon_auth.session s
      where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') = ${customerAuthUserId}
      returning coalesce(to_jsonb(s)->>'id', '') as id
    ` as RevokedSessionRow[];

    await audit(env, auth.user.authUserId, "USER_SESSIONS_REVOKED", customerAuthUserId, { revokedCount: deleted.length });
    return json({ revoked: true, count: deleted.length });
  } catch (reason) {
    console.error("admin-session-api", { path, detail: reason instanceof Error ? reason.message : "unknown" });
    return json({ error: "ADMIN_SESSION_API_FAILED" }, 500);
  }
}
