import { neon } from "@neondatabase/serverless";

export type PlatformRole = "CUSTOMER" | "SUPER_ADMIN";
export type PlatformAuthEnv = { DATABASE_URL?: string };

export type AuthenticatedPlatformUser = {
  authUserId: string;
  platformRole: PlatformRole;
};

type AuthRow = { auth_user_id: string | null };
type RoleRow = { role: string | null; banned: boolean | null };

type AuthResult =
  | { ok: true; user: AuthenticatedPlatformUser }
  | { ok: false; response: Response };

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export function normalizePlatformRole(nativeRole: string | null | undefined): PlatformRole {
  return nativeRole?.trim().toLowerCase() === "admin" ? "SUPER_ADMIN" : "CUSTOMER";
}

export async function requireAuthenticatedUser(request: Request, env: PlatformAuthEnv): Promise<AuthResult> {
  const token = bearerToken(request);
  if (!token || !env.DATABASE_URL) return { ok: false, response: json({ error: "UNAUTHENTICATED" }, 401) };

  try {
    // Neon verifies the JWT before exposing its claims to Postgres. The browser
    // never supplies an auth user id or platform role that we trust directly.
    const authenticatedSql = neon(env.DATABASE_URL, { authToken: token });
    const identityRows = await authenticatedSql`
      select public.current_auth_user_id() as auth_user_id
    ` as AuthRow[];
    const authUserId = identityRows[0]?.auth_user_id?.trim() || "";
    if (!authUserId) return { ok: false, response: json({ error: "UNAUTHENTICATED" }, 401) };

    const privilegedSql = neon(env.DATABASE_URL);
    const roleRows = await privilegedSql`
      select role::text as role, coalesce(banned, false) as banned
      from neon_auth.user
      where id::text = ${authUserId}
      limit 1
    ` as RoleRow[];
    const authRow = roleRows[0];
    if (!authRow || authRow.banned === true) return { ok: false, response: json({ error: "UNAUTHENTICATED" }, 401) };

    return { ok: true, user: { authUserId, platformRole: normalizePlatformRole(authRow.role) } };
  } catch {
    return { ok: false, response: json({ error: "UNAUTHENTICATED" }, 401) };
  }
}

export async function requireSuperAdmin(request: Request, env: PlatformAuthEnv): Promise<AuthResult> {
  const auth = await requireAuthenticatedUser(request, env);
  if (!auth.ok) return auth;
  if (auth.user.platformRole !== "SUPER_ADMIN") {
    return { ok: false, response: json({ error: "FORBIDDEN" }, 403) };
  }
  return auth;
}
