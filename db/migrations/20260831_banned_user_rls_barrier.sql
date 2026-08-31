-- Post Automatici — banned-user tenant RLS barrier
-- A cryptographically valid JWT is not sufficient authorization after Better Auth bans the user.
-- Source of truth: neon_auth.user.banned. Better Auth runtime has already proved that temporary-ban
-- expiry resets banned=false, so the database follows the current provider state directly.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_auth_user_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM neon_auth.user nu
    WHERE nu.id::text = (SELECT auth.user_id())::text
      AND nu.banned IS FALSE
  )
$function$;

REVOKE ALL ON FUNCTION public.current_auth_user_is_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_auth_user_is_active() TO authenticated;

DO $barrier$
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
      'CREATE POLICY require_authenticated_identity ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (((select auth.user_id()) IS NOT NULL) AND public.current_auth_user_is_active()) WITH CHECK (((select auth.user_id()) IS NOT NULL) AND public.current_auth_user_is_active())',
      table_name
    );
  END LOOP;
END
$barrier$;

COMMIT;
