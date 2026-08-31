-- Post Automatici — Better Auth temporary-ban semantics at the tenant RLS boundary
-- Source of truth remains neon_auth.user.banned + native banExpires.
-- A current provider row is required; missing/null/invalid state fails closed.

BEGIN;

CREATE OR REPLACE FUNCTION public.current_auth_user_is_active()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  current_banned boolean;
  current_ban_expires text;
BEGIN
  SELECT nu.banned, nullif(to_jsonb(nu)->>'banExpires', '')
  INTO current_banned, current_ban_expires
  FROM neon_auth.user nu
  WHERE nu.id::text = (SELECT auth.user_id())::text
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF current_banned IS FALSE THEN
    RETURN TRUE;
  END IF;

  IF current_banned IS DISTINCT FROM TRUE THEN
    RETURN FALSE;
  END IF;

  IF current_ban_expires IS NULL THEN
    RETURN FALSE;
  END IF;

  BEGIN
    RETURN current_ban_expires::timestamptz <= now();
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;
END
$function$;

REVOKE ALL ON FUNCTION public.current_auth_user_is_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_auth_user_is_active() TO authenticated;

COMMIT;
