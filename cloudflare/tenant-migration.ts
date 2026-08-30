import { neon } from "@neondatabase/serverless";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function migrationAuthorized(request: Request, secret?: string) {
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function handleTenantPrivilegeMigration(request: Request, env: { DATABASE_URL?: string; MIGRATION_TOKEN?: string }) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!migrationAuthorized(request, env.MIGRATION_TOKEN)) return json({ error: "API_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  try {
    const sql = neon(env.DATABASE_URL);
    await sql`
      DO $$
      DECLARE
        table_name text;
      BEGIN
        FOREACH table_name IN ARRAY ARRAY[
          'profiles', 'profile_members', 'brand_profiles', 'website_scans', 'website_pages',
          'content_strategies', 'assets', 'content_items', 'content_variants', 'social_connections',
          'schedules', 'publication_jobs', 'publication_attempts', 'metric_snapshots', 'learning_insights',
          'ai_usage_events', 'audit_log'
        ] LOOP
          IF to_regclass('public.' || quote_ident(table_name)) IS NULL THEN
            RAISE EXCEPTION 'required tenant table public.% does not exist', table_name;
          END IF;

          EXECUTE format('DROP POLICY IF EXISTS require_authenticated_identity ON public.%I', table_name);
          EXECUTE format(
            'CREATE POLICY require_authenticated_identity ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (((select auth.user_id()) IS NOT NULL)) WITH CHECK (((select auth.user_id()) IS NOT NULL))',
            table_name
          );
        END LOOP;
      END $$;
    `;
    return json({ applied: true, migration: "20260830_tenant_restrictive_auth_barrier" });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_TENANT_MIGRATION_ERROR";
    console.error("tenant-restrictive-auth-migration", detail);
    return json({ error: "TENANT_RESTRICTIVE_AUTH_MIGRATION_FAILED", detail }, 500);
  }
}
