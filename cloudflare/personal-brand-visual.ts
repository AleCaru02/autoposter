import { neon } from "@neondatabase/serverless";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";
import { higgsfieldConfigured } from "../api/_lib/higgsfield.js";

type Env = {
  DATABASE_URL?: string;
  HF_CREDENTIALS?: string;
};

type IdentityRow = {
  provider: string;
  status: string;
  soul_id: string | null;
  reference_quality: number | string | null;
  soul_created_at: string | null;
  last_checked_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handlePersonalBrandVisualIdentity(request: Request, env: Env) {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return json({ error: "UNAUTHENTICATED" }, 401);
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return json({ error: "UNAUTHENTICATED" }, 401);

  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) return json({ error: "PROFILE_REQUIRED" }, 400);

  try {
    const sql = neon(env.DATABASE_URL);
    const profiles = await sql`
      select id::text as id, profile_type
      from public.profiles
      where id=${profileId}::uuid
        and owner_auth_user_id=${authUserId}
        and archived_at is null
      limit 1
    ` as unknown as Array<{ id: string; profile_type: string }>;
    const profile = profiles[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    if (profile.profile_type !== "PERSONAL_BRAND") return json({ error: "PERSONAL_BRAND_REQUIRED" }, 409);

    const references = await sql`
      select
        count(*)::int as total,
        count(*) filter (where quality_status='PASS')::int as passed,
        count(*) filter (where quality_status='PENDING')::int as pending,
        count(*) filter (where quality_status='REJECTED')::int as rejected,
        max(created_at)::text as latest_created_at
      from public.personal_brand_reference_images
      where profile_id=${profileId}::uuid
    ` as unknown as Array<{ total: number; passed: number; pending: number; rejected: number; latest_created_at: string | null }>;

    const identities = await sql`
      select provider,status,soul_id,reference_quality,soul_created_at,last_checked_at,last_error_code,created_at::text,updated_at::text
      from public.personal_brand_visual_identities
      where profile_id=${profileId}::uuid
      limit 1
    ` as unknown as IdentityRow[];

    return json({
      profileId,
      provider: "HIGGSFIELD",
      configured: higgsfieldConfigured(env.HF_CREDENTIALS),
      capabilityStatus: "LIVE_NOT_RUNTIME_VERIFIED",
      references: references[0] ?? { total: 0, passed: 0, pending: 0, rejected: 0, latest_created_at: null },
      identity: identities[0] ?? {
        provider: "HIGGSFIELD",
        status: "NOT_CONFIGURED",
        soul_id: null,
        reference_quality: null,
        soul_created_at: null,
        last_checked_at: null,
        last_error_code: null,
      },
    });
  } catch (reason) {
    console.error("personal-brand-visual-identity", {
      profileId,
      error: reason instanceof Error ? reason.message.slice(0, 120) : "VISUAL_IDENTITY_STATUS_FAILED",
    });
    return json({ error: "VISUAL_IDENTITY_STATUS_FAILED" }, 500);
  }
}
