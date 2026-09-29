-- Post Automatici — make the tenant RLS boundary effective for table owners too.
-- Existing restrictive authenticated-identity and tenant ownership policies remain
-- authoritative; this migration only removes the owner bypass from the 17 core
-- tenant tables. It deliberately excludes the already-green auxiliary contract.

BEGIN;

DO $force_tenant_rls$
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

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$force_tenant_rls$;

COMMIT;
