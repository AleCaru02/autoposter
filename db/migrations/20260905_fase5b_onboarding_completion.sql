-- FASE 5B — onboarding completion is a privileged, idempotent transition.
-- Customers may edit profile fields through RLS, but cannot self-assert the
-- completion flag that enables downstream autonomous processing.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_customer_onboarding_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NEW.onboarding_completed IS DISTINCT FROM OLD.onboarding_completed THEN
    RAISE EXCEPTION 'ONBOARDING_COMPLETION_SERVER_ONLY' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_onboarding_completion_guard ON public.profiles;
CREATE TRIGGER profiles_onboarding_completion_guard
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_customer_onboarding_completion();

CREATE OR REPLACE FUNCTION public.complete_onboarding_profile(
  p_actor_auth_user_id text,
  p_profile_id uuid,
  p_mode text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF p_actor_auth_user_id IS NULL OR btrim(p_actor_auth_user_id) = '' THEN
    RAISE EXCEPTION 'ONBOARDING_ACTOR_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('NO_WEBSITE', 'BRAND_ANALYZED') THEN
    RAISE EXCEPTION 'ONBOARDING_COMPLETION_MODE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT profile.* INTO v_profile
  FROM public.profiles profile
  JOIN neon_auth.user auth_user
    ON auth_user.id::text = p_actor_auth_user_id
   AND coalesce(auth_user.banned, false) IS FALSE
  WHERE profile.id = p_profile_id
    AND profile.owner_auth_user_id = p_actor_auth_user_id
    AND profile.archived_at IS NULL
  FOR UPDATE OF profile;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ONBOARDING_PROFILE_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  IF p_mode = 'NO_WEBSITE'
     AND coalesce(btrim(v_profile.website_url), '') <> '' THEN
    RAISE EXCEPTION 'ONBOARDING_WEBSITE_REQUIRES_ANALYSIS' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'BRAND_ANALYZED'
     AND NOT EXISTS (
       SELECT 1 FROM public.brand_profiles brand
       WHERE brand.profile_id = p_profile_id
     ) THEN
    RAISE EXCEPTION 'ONBOARDING_BRAND_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF v_profile.onboarding_completed IS TRUE THEN
    RETURN TRUE;
  END IF;

  UPDATE public.profiles
  SET onboarding_completed = TRUE, updated_at = now()
  WHERE id = p_profile_id;

  INSERT INTO public.platform_admin_audit(
    actor_auth_user_id, action, target_type, target_id, metadata
  ) VALUES (
    p_actor_auth_user_id, 'ONBOARDING_COMPLETED', 'profile',
    p_profile_id::text,
    jsonb_build_object('phase', 'FASE_5B', 'mode', p_mode)
  );
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding_profile(text,uuid,text)
  FROM PUBLIC, authenticated;

COMMIT;
