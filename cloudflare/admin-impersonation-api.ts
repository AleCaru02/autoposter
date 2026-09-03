import { neon } from "@neondatabase/serverless";
import { SAME_ORIGIN_AUTH_PROXY_CONTRACT } from "./auth-proxy.js";
import { requireSuperAdmin, type PlatformAuthEnv } from "./platform-rbac.js";

type ImpersonationEnv = PlatformAuthEnv & { APP_BASE_URL?: string };

type NativeUserRow = {
  auth_user_id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  banned: boolean;
};

type NativeSessionInfo = {
  active: boolean;
  userId: string | null;
  role: string | null;
  impersonatedBy: string | null;
};

type NativeCallResult = {
  status: number;
  ok: boolean;
  body: unknown;
  setCookies: string[];
};

const DEFAULT_APP_ORIGIN = "https://autoposter.02alessandrocaruso.workers.dev";
const AUTH_UPSTREAM = SAME_ORIGIN_AUTH_PROXY_CONTRACT.upstream;
const MAX_PROVIDER_BODY_BYTES = 128 * 1024;

function json(body: unknown, status = 200, setCookies: string[] = []) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    pragma: "no-cache",
  });
  for (const cookie of setCookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function configuredAppOrigin(env: ImpersonationEnv) {
  try { return new URL(env.APP_BASE_URL || DEFAULT_APP_ORIGIN).origin; }
  catch { return null; }
}

function sameOriginMutation(request: Request, env: ImpersonationEnv) {
  const expected = configuredAppOrigin(env);
  return Boolean(expected && request.headers.get("origin") === expected);
}

function decodeSegment(value: string) {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded && decoded.length <= 256 ? decoded : null;
  } catch {
    return null;
  }
}

async function validEmptyBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) return true;
  try {
    const body = JSON.parse(text) as unknown;
    return Boolean(body && typeof body === "object" && !Array.isArray(body) && Object.keys(body as Record<string, unknown>).length === 0);
  } catch {
    return false;
  }
}

function providerSetCookies(headers: Headers) {
  const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  if (headers.has("set-cookie") && cookies.length === 0) return null;
  return cookies;
}

async function readProviderJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_BODY_BYTES) return null;
  try { return JSON.parse(text) as unknown; }
  catch { return null; }
}

async function nativeAuthCall(
  cookie: string,
  env: ImpersonationEnv,
  path: "/get-session" | "/admin/impersonate-user" | "/admin/stop-impersonating",
  body?: Record<string, unknown>,
): Promise<NativeCallResult | null> {
  const appOrigin = configuredAppOrigin(env);
  if (!appOrigin || !cookie) return null;

  const method = body === undefined ? "GET" : "POST";
  const headers = new Headers({
    accept: "application/json",
    cookie,
    origin: appOrigin,
    referer: `${appOrigin}/`,
  });
  if (body !== undefined) headers.set("content-type", "application/json");

  try {
    const response = await fetch(`${AUTH_UPSTREAM}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    const setCookies = providerSetCookies(response.headers);
    if (setCookies === null) return null;
    return {
      status: response.status,
      ok: response.ok,
      body: await readProviderJson(response),
      setCookies,
    };
  } catch {
    return null;
  }
}

function sessionInfo(body: unknown): NativeSessionInfo {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const root = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  const session = root.session && typeof root.session === "object" ? root.session as Record<string, unknown> : null;
  const user = root.user && typeof root.user === "object" ? root.user as Record<string, unknown> : null;
  const userId = typeof user?.id === "string" ? user.id : null;
  const role = typeof user?.role === "string" ? user.role.trim().toLowerCase() : null;
  const impersonatedBy = typeof session?.impersonatedBy === "string"
    ? session.impersonatedBy
    : typeof session?.impersonated_by === "string"
      ? session.impersonated_by
      : null;
  return { active: Boolean(session && userId), userId, role, impersonatedBy };
}

function cookieMap(raw: string) {
  const values = new Map<string, string>();
  for (const item of raw.split(";")) {
    const trimmed = item.trim();
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    values.set(trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim());
  }
  return values;
}

function cookieHeaderAfter(raw: string, setCookies: string[]) {
  const values = cookieMap(raw);
  for (const setCookie of setCookies) {
    const parts = setCookie.split(";").map((part) => part.trim());
    const pair = parts[0] || "";
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    const expired = parts.some((part) => /^max-age=0$/i.test(part));
    if (expired || !value) values.delete(name); else values.set(name, value);
  }
  return [...values.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function resolveNativeUser(sql: ReturnType<typeof neon>, authUserId: string) {
  const rows = await sql`
    select
      nu.id::text as auth_user_id,
      nullif(to_jsonb(nu)->>'name', '') as name,
      nullif(to_jsonb(nu)->>'email', '') as email,
      nu.role::text as role,
      (coalesce(nu.banned, false) and (nu."banExpires" is null or nu."banExpires" > now())) as banned
    from neon_auth.user nu
    where nu.id::text = ${authUserId}
    limit 1
  ` as NativeUserRow[];
  return rows[0] ?? null;
}

function isNativeAdmin(row: NativeUserRow | null) {
  return Boolean(row && row.role?.trim().toLowerCase() === "admin");
}

async function writeAudit(
  sql: ReturnType<typeof neon>,
  actorAuthUserId: string,
  action: "IMPERSONATION_STARTED" | "IMPERSONATION_ENDED",
  targetAuthUserId: string,
  metadata: Record<string, unknown>,
) {
  await sql`
    insert into public.platform_admin_audit (actor_auth_user_id, action, target_type, target_id, metadata)
    values (${actorAuthUserId}, ${action}, 'AUTH_USER', ${targetAuthUserId}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

function safeIdentity(row: NativeUserRow) {
  return { id: row.auth_user_id, email: row.email, name: row.name };
}

async function rollbackStart(cookie: string, env: ImpersonationEnv) {
  try { await nativeAuthCall(cookie, env, "/admin/stop-impersonating", {}); }
  catch { /* best effort; browser never receives the impersonated cookie on failure */ }
}

export async function handleAdminImpersonationApi(request: Request, env: ImpersonationEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const startMatch = path.match(/^\/api\/admin\/customers\/([^/]+)\/impersonate$/);
  const stopMatch = path === "/api/admin/impersonation/stop";
  if (!startMatch && !stopMatch) return null;

  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!sameOriginMutation(request, env)) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  if (!await validEmptyBody(request)) return json({ error: "INVALID_IMPERSONATION_INPUT" }, 400);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  const cookie = request.headers.get("cookie") || "";
  if (!cookie) return json({ error: "AUTH_SESSION_REQUIRED" }, 401);
  const sql = neon(env.DATABASE_URL);

  try {
    if (startMatch) {
      const auth = await requireSuperAdmin(request, env);
      if (!auth.ok) return auth.response;

      const targetAuthUserId = decodeSegment(startMatch[1] ?? "");
      if (!targetAuthUserId) return json({ error: "INVALID_CUSTOMER" }, 400);
      if (targetAuthUserId === auth.user.authUserId) return json({ error: "SELF_IMPERSONATION_DENIED" }, 400);

      const sessionBeforeCall = await nativeAuthCall(cookie, env, "/get-session");
      if (!sessionBeforeCall?.ok) return json({ error: "AUTH_SESSION_UNAVAILABLE" }, 401);
      const before = sessionInfo(sessionBeforeCall.body);
      if (!before.active || before.userId !== auth.user.authUserId || before.role !== "admin") {
        return json({ error: "AUTH_SESSION_ACTOR_MISMATCH" }, 403);
      }
      if (before.impersonatedBy) return json({ error: "NESTED_IMPERSONATION_DENIED" }, 409);

      const target = await resolveNativeUser(sql, targetAuthUserId);
      if (!target) return json({ error: "CUSTOMER_NOT_FOUND" }, 404);
      if (isNativeAdmin(target)) return json({ error: "ADMIN_TARGET_DENIED" }, 400);
      if (target.banned) return json({ error: "BANNED_TARGET_DENIED" }, 409);

      const started = await nativeAuthCall(cookie, env, "/admin/impersonate-user", { userId: targetAuthUserId });
      if (!started?.ok) return json({ error: "MANAGED_AUTH_IMPERSONATION_START_FAILED" }, 502);

      const impersonatedCookie = cookieHeaderAfter(cookie, started.setCookies);
      const sessionAfterCall = await nativeAuthCall(impersonatedCookie, env, "/get-session");
      const after = sessionAfterCall?.ok ? sessionInfo(sessionAfterCall.body) : null;
      if (!after?.active || after.userId !== targetAuthUserId || after.impersonatedBy !== auth.user.authUserId) {
        await rollbackStart(impersonatedCookie, env);
        return json({ error: "IMPERSONATION_POSTCONDITION_FAILED" }, 502);
      }

      let auditRecorded = true;
      try {
        await writeAudit(sql, auth.user.authUserId, "IMPERSONATION_STARTED", targetAuthUserId, {
          source: "ADMIN_CUSTOMER_DETAIL",
          provider: "NEON_MANAGED_AUTH",
          sessionBound: true,
        });
      } catch {
        auditRecorded = false;
      }

      return json({
        impersonation: {
          active: true,
          actor: { id: auth.user.authUserId },
          target: safeIdentity(target),
        },
        auditRecorded,
      }, auditRecorded ? 200 : 207, started.setCookies);
    }

    const currentSessionCall = await nativeAuthCall(cookie, env, "/get-session");
    if (!currentSessionCall?.ok) return json({ error: "AUTH_SESSION_UNAVAILABLE" }, 401);
    const current = sessionInfo(currentSessionCall.body);
    if (!current.active || !current.userId || !current.impersonatedBy) {
      return json({ error: "NOT_IMPERSONATING" }, 403);
    }

    const actor = await resolveNativeUser(sql, current.impersonatedBy);
    if (!isNativeAdmin(actor) || actor?.banned) return json({ error: "IMPERSONATION_ACTOR_INVALID" }, 403);

    const stopped = await nativeAuthCall(cookie, env, "/admin/stop-impersonating", {});
    if (!stopped?.ok) return json({ error: "MANAGED_AUTH_IMPERSONATION_STOP_FAILED" }, 502);

    const restoredCookie = cookieHeaderAfter(cookie, stopped.setCookies);
    const restoredSessionCall = await nativeAuthCall(restoredCookie, env, "/get-session");
    const restored = restoredSessionCall?.ok ? sessionInfo(restoredSessionCall.body) : null;
    if (!restored?.active || restored.userId !== actor!.auth_user_id || restored.impersonatedBy) {
      return json({ error: "IMPERSONATION_STOP_POSTCONDITION_FAILED" }, 502);
    }

    let auditRecorded = true;
    try {
      await writeAudit(sql, actor!.auth_user_id, "IMPERSONATION_ENDED", current.userId, {
        source: "IMPERSONATION_BANNER",
        provider: "NEON_MANAGED_AUTH",
        sessionBound: true,
      });
    } catch {
      auditRecorded = false;
    }

    return json({
      impersonation: {
        active: false,
        actor: { id: actor!.auth_user_id },
        target: { id: current.userId },
      },
      auditRecorded,
    }, auditRecorded ? 200 : 207, stopped.setCookies);
  } catch {
    console.error("admin-impersonation-api", { path, failure: "UNEXPECTED" });
    return json({ error: "ADMIN_IMPERSONATION_API_FAILED" }, 500);
  }
}
