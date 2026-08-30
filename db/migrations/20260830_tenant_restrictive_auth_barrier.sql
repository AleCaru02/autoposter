-- Require a validated Neon Auth identity before any tenant-scoped row can be read or modified.
-- Existing per-tenant policies remain in place and still decide which authenticated rows are allowed.
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
