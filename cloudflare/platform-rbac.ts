import { neon } from "@neondatabase/serverless";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

export type PlatformRole = "CUSTOMER" | "SUPER_ADMIN";
export type PlatformAuthEnv = { DATABASE_URL?: string };

export type AuthenticatedPlatformUser = {
  authUserId: string;
  platformRole: PlatformRole;
};

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

function identityFromRpcPayload(payload: unknown): string | null {
  if (typeof payload === "string") return payload.trim() || null;
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (typeof first === "string") return first.trim() || null;
    if (first && typeof first === "object") {
      const record = first as Record<string, unknown>;
      for (const key of ["current_auth_user_id", "auth_user_id", "current_platform_identity"]) {
        if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
      }
    }
    return null;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["current_auth_user_id", "auth_user_id", "current_platform_identity"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
  }
  return null;
}

async function verifiedAuthUserId(token: string): Promise<string | null> {
  try {
    // The production Neon Data API is the JWT-verifying boundary used by the
    // customer application and RLS. Ask it for the authenticated identity
    // instead of trusting JWT claims decoded in the Worker or client input.
    const response = await fetch(`${DATA_API}/rpc/current_auth_user_id`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) return null;
    return identityFromRpcPayload(await response.json());
  } catch {
    return null;
  }
}

export async function requireAuthenticatedUser(request: Request, env: PlatformAuthEnv): Promise<AuthResult> {
  const token = bearerToken(request);
  if (!token || !env.DATABASE_URL) return { ok: false, response: json({ error: "UNAUTHENTICATED" }, 401) };

  try {
    const authUserId = await verifiedAuthUserId(token);
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
