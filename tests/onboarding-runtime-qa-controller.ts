import { neon } from "@neondatabase/serverless";
import { timingSafeEqual } from "node:crypto";

type Env = { DATABASE_URL?: string; ONBOARDING_QA_TOKEN?: string };
const emailPattern = /^onboarding-smoke-([0-9]{10,32})-(primary|other)@example\.invalid$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function validMarker(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{10,32}$/.test(value);
}

function sameSecret(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function users(sql: ReturnType<typeof neon>, marker?: string) {
  const rows = await sql`
    select u.id::text as id, lower(coalesce(to_jsonb(u)->>'email','')) as email
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email','')) like 'onboarding-smoke-%@example.invalid'
  ` as unknown as Array<{ id: string; email: string }>;
  return rows.map((row) => ({ ...row, match: emailPattern.exec(row.email) }))
    .filter((row) => row.match && (!marker || row.match[1] === marker));
}

async function state(sql: ReturnType<typeof neon>, marker: string) {
  const marked = await users(sql, marker); const recognized = await users(sql);
  const ids = marked.map((row) => row.id);
  const row = (await sql`
    select
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from public.profiles where owner_auth_user_id=any(${ids}::text[])) as qa_profiles,
      (select count(*)::int from public.profile_members pm join public.app_users au on au.id=pm.user_id where au.auth_user_id=any(${ids}::text[]) and upper(pm.role)='OWNER') as qa_owners,
      (select count(*)::int from public.profile_entitlement_package_assignments a join public.profiles p on p.id=a.profile_id where p.owner_auth_user_id=any(${ids}::text[]) and a.revoked_at is null) as qa_assignments,
      (select count(*)::int from public.profile_entitlements e join public.profiles p on p.id=e.profile_id where p.owner_auth_user_id=any(${ids}::text[])) as qa_entitlements,
      (select count(*)::int from public.onboarding_profile_provisioning o where o.owner_auth_user_id=any(${ids}::text[])) as qa_operations,
      (select count(*)::int from public.platform_admin_audit a where a.actor_auth_user_id=any(${ids}::text[]) and a.metadata->>'phase'='FASE_5A') as qa_audit,
      (select count(*)::int from public.platform_admin_audit a where a.metadata->>'phase'='FASE_5A' and a.actor_auth_user_id in (select id::text from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like 'onboarding-smoke-%@example.invalid')) as recognized_qa_audit,
      (select count(*)::int from public.profiles p left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER' group by p.id having count(pm.user_id)<>1 limit 1) as broken_owner_probe
  ` as unknown as Array<Record<string, unknown>>)[0];
  return {
    qaUsers: marked.length, recognizedQaUsers: recognized.length,
    qaProfiles: Number(row.qa_profiles || 0), qaOwners: Number(row.qa_owners || 0),
    qaAssignments: Number(row.qa_assignments || 0), qaEntitlements: Number(row.qa_entitlements || 0),
    qaOperations: Number(row.qa_operations || 0), qaAudit: Number(row.qa_audit || 0),
    recognizedQaAudit: Number(row.recognized_qa_audit || 0), profilesTotal: Number(row.profiles_total || 0),
    profilesWithoutOwner: row.broken_owner_probe == null ? 0 : 1,
  };
}

async function cleanup(sql: ReturnType<typeof neon>, marker?: string) {
  const recognized = await users(sql, marker); const ids = recognized.map((row) => row.id);
  if (marker && recognized.length > 2) throw new Error("QA_CLEANUP_SCOPE");
  if (ids.length) {
    await sql`delete from public.profiles where owner_auth_user_id=any(${ids}::text[])`;
    await sql`delete from public.platform_admin_audit where actor_auth_user_id=any(${ids}::text[]) and metadata->>'phase'='FASE_5A'`;
    await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=any(${ids}::text[])`;
    await sql`delete from public.app_users where auth_user_id=any(${ids}::text[])`;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=any(${ids}::text[])`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=any(${ids}::text[])`;
    await sql`delete from neon_auth.user u where u.id::text=any(${ids}::text[])`;
  }
  return { cleaned: true, ...(await state(sql, marker || "0".repeat(10))) };
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (!env.DATABASE_URL || !sameSecret(request.headers.get("x-onboarding-qa-token") || "", env.ONBOARDING_QA_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    let body: { action?: string; marker?: string };
    try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!validMarker(body.marker)) return json({ error: "INVALID_MARKER" }, 400);
    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "preflight" || body.action === "state") return json(await state(sql, body.marker));
      if (body.action === "cleanup") return json(await cleanup(sql, body.marker));
      if (body.action === "cleanup-residue") return json(await cleanup(sql));
      return json({ error: "INVALID_ACTION" }, 400);
    } catch (reason) {
      console.error("onboarding-runtime-controller", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "VERIFIER_FAILED" }, 500);
    }
  },
};
