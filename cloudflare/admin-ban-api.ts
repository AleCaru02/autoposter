import { neon } from "@neondatabase/serverless";
import { requireSuperAdmin, type PlatformAuthEnv } from "./platform-rbac.js";

type BanAdminEnv = PlatformAuthEnv;

type CustomerBanRow = {
  auth_user_id: string;
  banned: boolean;
  ban_reason: string | null;
  ban_expires: string | null;
};

type SessionDeleteRow = { id: string };

type ParsedBanInput = {
  ok: true;
  reason: string | null;
  expiresAt: string | null;
} | {
  ok: false;
  error: string;
};

const MAX_REASON_LENGTH = 500;
const MAX_BAN_MS = 366 * 24 * 60 * 60 * 1000;

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

function cleanReason(value: unknown) {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: null };
  if (typeof value !== "string") return { ok: false as const };
  const normalized = value.trim();
  if (!normalized) return { ok: true as const, value: null };
  if (normalized.length > MAX_REASON_LENGTH) return { ok: false as const };
  if (/[<>]/.test(normalized)) return { ok: false as const };
  return { ok: true as const, value: normalized };
}

function cleanExpiry(value: unknown) {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: null };
  if (typeof value !== "string" || value.length > 64) return { ok: false as const };
  const parsed = Date.parse(value);
  const now = Date.now();
  if (!Number.isFinite(parsed) || parsed <= now || parsed - now > MAX_BAN_MS) return { ok: false as const };
  return { ok: true as const, value: new Date(parsed).toISOString() };
}

async function parseBanInput(request: Request): Promise<ParsedBanInput> {
  let body: unknown;
  try { body = await request.json(); } catch { return { ok: false, error: "INVALID_BAN_INPUT" }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "INVALID_BAN_INPUT" };
  const record = body as Record<string, unknown>;
  const allowed = new Set(["reason", "expiresAt"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return { ok: false, error: "INVALID_BAN_INPUT" };

  const reason = cleanReason(record.reason);
  const expiry = cleanExpiry(record.expiresAt);
  if (!reason.ok || !expiry.ok) return { ok: false, error: "INVALID_BAN_INPUT" };
  return { ok: true, reason: reason.value, expiresAt: expiry.value };
}

async function resolveCustomer(sql: ReturnType<typeof neon>, customerId: string) {
  const rows = await sql`
    select
      nu.id::text as auth_user_id,
      coalesce(nu.banned, false) as banned,
      nullif(to_jsonb(nu)->>'banReason', '') as ban_reason,
      nullif(to_jsonb(nu)->>'banExpires', '') as ban_expires
    from neon_auth.user nu
    where nu.id::text = ${customerId}
      and lower(coalesce(nu.role::text, '')) <> 'admin'
    limit 1
  ` as CustomerBanRow[];
  return rows[0] ?? null;
}

async function writeAudit(
  sql: ReturnType<typeof neon>,
  actorAuthUserId: string,
  action: "USER_BANNED" | "USER_UNBANNED",
  customerId: string,
  metadata: Record<string, unknown>,
) {
  await sql`
    insert into public.platform_admin_audit (actor_auth_user_id, action, target_type, target_id, metadata)
    values (${actorAuthUserId}, ${action}, 'AUTH_USER', ${customerId}, ${JSON.stringify(metadata)}::jsonb)
  `;
}

function browserSafeCustomer(row: CustomerBanRow) {
  return {
    id: row.auth_user_id,
    banned: row.banned === true,
    reason: row.ban_reason,
    expiresAt: row.ban_expires,
  };
}

export async function handleAdminBanApi(request: Request, env: BanAdminEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const match = path.match(/^\/api\/admin\/customers\/([^/]+)\/(ban|unban)$/);
  if (!match) return null;
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const auth = await requireSuperAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  const customerId = decodeSegment(match[1] ?? "");
  if (!customerId) return json({ error: "INVALID_CUSTOMER" }, 400);

  const operation = match[2];
  const sql = neon(env.DATABASE_URL);

  try {
    const customer = await resolveCustomer(sql, customerId);
    if (!customer) return json({ error: "CUSTOMER_NOT_FOUND" }, 404);

    if (operation === "unban") {
      if (request.headers.get("content-length") && request.headers.get("content-length") !== "0") {
        let body: unknown;
        try { body = await request.json(); } catch { return json({ error: "INVALID_UNBAN_INPUT" }, 400); }
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body as Record<string, unknown>).length !== 0) {
          return json({ error: "INVALID_UNBAN_INPUT" }, 400);
        }
      }

      const rows = await sql`
        update neon_auth.user
        set banned = false, "banReason" = null, "banExpires" = null
        where id::text = ${customerId}
          and lower(coalesce(role::text, '')) <> 'admin'
        returning id::text as auth_user_id,
          coalesce(banned, false) as banned,
          nullif(to_jsonb(neon_auth.user)->>'banReason', '') as ban_reason,
          nullif(to_jsonb(neon_auth.user)->>'banExpires', '') as ban_expires
      ` as CustomerBanRow[];
      if (!rows[0]) return json({ error: "CUSTOMER_NOT_FOUND" }, 404);

      let auditRecorded = true;
      try { await writeAudit(sql, auth.user.authUserId, "USER_UNBANNED", customerId, {}); }
      catch { auditRecorded = false; }

      return json({ customer: browserSafeCustomer(rows[0]), auditRecorded }, auditRecorded ? 200 : 207);
    }

    const input = await parseBanInput(request);
    if (!input.ok) return json({ error: input.error }, 400);

    const rows = await sql`
      update neon_auth.user
      set banned = true,
        "banReason" = ${input.reason},
        "banExpires" = ${input.expiresAt}::timestamptz
      where id::text = ${customerId}
        and lower(coalesce(role::text, '')) <> 'admin'
      returning id::text as auth_user_id,
        coalesce(banned, false) as banned,
        nullif(to_jsonb(neon_auth.user)->>'banReason', '') as ban_reason,
        nullif(to_jsonb(neon_auth.user)->>'banExpires', '') as ban_expires
    ` as CustomerBanRow[];
    if (!rows[0]) return json({ error: "CUSTOMER_NOT_FOUND" }, 404);

    let sessionsRevoked = true;
    let revokedCount = 0;
    try {
      const deleted = await sql`
        delete from neon_auth.session s
        where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') = ${customerId}
        returning coalesce(to_jsonb(s)->>'id', '') as id
      ` as SessionDeleteRow[];
      revokedCount = deleted.length;
    } catch {
      sessionsRevoked = false;
    }

    let auditRecorded = true;
    try {
      await writeAudit(sql, auth.user.authUserId, "USER_BANNED", customerId, {
        reason: input.reason,
        expiresAt: input.expiresAt,
        sessionsRevoked,
        revokedCount,
      });
    } catch {
      auditRecorded = false;
    }

    return json({
      customer: browserSafeCustomer(rows[0]),
      sessionRevocation: { ok: sessionsRevoked, revokedCount },
      auditRecorded,
    }, sessionsRevoked && auditRecorded ? 200 : 207);
  } catch (reason) {
    console.error("admin-ban-api", { path, detail: reason instanceof Error ? reason.message : "unknown" });
    return json({ error: "ADMIN_BAN_API_FAILED" }, 500);
  }
}
