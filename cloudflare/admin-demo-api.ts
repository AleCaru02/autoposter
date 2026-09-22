import { neon } from "@neondatabase/serverless";
import { requireSuperAdmin, type PlatformAuthEnv } from "./platform-rbac.js";

type DemoAdminEnv = PlatformAuthEnv;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function uuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export async function handleAdminDemoApi(request: Request, env: DemoAdminEnv): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== "/api/admin/demo/provision" && path !== "/api/admin/demo/reset") return null;
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const auth = await requireSuperAdmin(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: "INVALID_JSON" }, 400); }
  const sql = neon(env.DATABASE_URL);
  try {
    if (path.endsWith("/provision")) {
      const ownerAuthUserId = typeof body.ownerAuthUserId === "string" && body.ownerAuthUserId.trim().length <= 256 ? body.ownerAuthUserId.trim() : "";
      if (!ownerAuthUserId) return json({ error: "OWNER_AUTH_USER_REQUIRED" }, 400);
      const rows = await sql`
        select public.provision_demo_tenant(${ownerAuthUserId},${auth.user.authUserId})::text profile_id
      ` as unknown as Array<{ profile_id: string }>;
      return json({ demo: true, tenantType: "DEMO_PERSISTENT", profileId: rows[0]?.profile_id ?? null }, 201);
    }
    const profileId = uuid(body.profileId);
    if (!profileId) return json({ error: "PROFILE_REQUIRED" }, 400);
    const rows = await sql`
      select public.reset_demo_tenant(${profileId}::uuid,${auth.user.authUserId}) result
    ` as unknown as Array<{ result: unknown }>;
    return json({ demo: true, tenantType: "DEMO_PERSISTENT", result: rows[0]?.result ?? null });
  } catch (reason) {
    console.error("admin-demo-api", { path, error: reason instanceof Error ? reason.message : "unknown" });
    return json({ error: path.endsWith("/provision") ? "DEMO_PROVISION_FAILED" : "DEMO_RESET_FAILED" }, 500);
  }
}
