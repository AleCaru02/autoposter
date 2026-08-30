-- Post Automatici tenant privilege hardening.
-- Preserve the authenticated role's current effective CRUD privileges, then remove
-- tenant-table privileges inherited by unauthenticated access through PUBLIC/anonymous.
DO $$
DECLARE
  table_name text;
  qualified_name text;
  can_select boolean;
  can_insert boolean;
  can_update boolean;
  can_delete boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'authenticated role is required';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'profiles', 'profile_members', 'brand_profiles', 'website_scans', 'website_pages',
    'content_strategies', 'assets', 'content_items', 'content_variants', 'social_connections',
    'schedules', 'publication_jobs', 'publication_attempts', 'metric_snapshots', 'learning_insights',
    'ai_usage_events', 'audit_log'
  ] LOOP
    qualified_name := 'public.' || quote_ident(table_name);
    IF to_regclass(qualified_name) IS NULL THEN
      RAISE EXCEPTION 'required tenant table % does not exist', qualified_name;
    END IF;

    can_select := has_table_privilege('authenticated', qualified_name, 'SELECT');
    can_insert := has_table_privilege('authenticated', qualified_name, 'INSERT');
    can_update := has_table_privilege('authenticated', qualified_name, 'UPDATE');
    can_delete := has_table_privilege('authenticated', qualified_name, 'DELETE');

    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anonymous') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anonymous', table_name);
    END IF;

    IF can_select THEN EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', table_name); END IF;
    IF can_insert THEN EXECUTE format('GRANT INSERT ON TABLE public.%I TO authenticated', table_name); END IF;
    IF can_update THEN EXECUTE format('GRANT UPDATE ON TABLE public.%I TO authenticated', table_name); END IF;
    IF can_delete THEN EXECUTE format('GRANT DELETE ON TABLE public.%I TO authenticated', table_name); END IF;
  END LOOP;
END $$;
