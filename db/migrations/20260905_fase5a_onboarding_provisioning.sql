-- FASE 5A — atomic, idempotent onboarding profile provisioning.
-- The authenticated HTTP boundary verifies the actor, then this privileged
-- function creates the tenant and assigns the canonical entitlement package in
-- one database transaction. CUSTOMER roles cannot call it directly.

BEGIN;

CREATE TABLE IF NOT EXISTS public.onboarding_profile_provisioning (
  owner_auth_user_id text NOT NULL,
  operation_id uuid NOT NULL,
  request_fingerprint text NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_auth_user_id, operation_id),
  UNIQUE (profile_id),
  CONSTRAINT onboarding_provisioning_fingerprint_check
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.onboarding_profile_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_profile_provisioning FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.onboarding_profile_provisioning FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.provision_onboarding_profile(
  p_owner_auth_user_id text,
  p_operation_id uuid,
  p_request_fingerprint text,
  p_name text,
  p_slug text,
  p_website_url text DEFAULT NULL,
  p_industry text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  website_url text,
  industry text,
  timezone text,
  locale text,
  onboarding_completed boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.onboarding_profile_provisioning%ROWTYPE;
  v_profile_id uuid;
BEGIN
  IF p_owner_auth_user_id IS NULL OR btrim(p_owner_auth_user_id) = '' THEN
    RAISE EXCEPTION 'ONBOARDING_ACTOR_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM neon_auth.user u WHERE u.id::text = p_owner_auth_user_id) THEN
    RAISE EXCEPTION 'ONBOARDING_ACTOR_UNKNOWN' USING ERRCODE = '42501';
  END IF;
  IF p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ONBOARDING_FINGERPRINT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' OR length(btrim(p_name)) > 160 THEN
    RAISE EXCEPTION 'ONBOARDING_NAME_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR length(p_slug) > 80 THEN
    RAISE EXCEPTION 'ONBOARDING_SLUG_INVALID' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'onboarding-profile:' || p_owner_auth_user_id || ':' || p_operation_id::text,
    0
  ));

  SELECT provisioning.* INTO v_existing
  FROM public.onboarding_profile_provisioning provisioning
  WHERE provisioning.owner_auth_user_id = p_owner_auth_user_id
    AND provisioning.operation_id = p_operation_id;

  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'ONBOARDING_IDEMPOTENCY_CONFLICT' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY
      SELECT profile.id, profile.name, profile.slug, profile.website_url,
        profile.industry, profile.timezone, profile.locale,
        profile.onboarding_completed, profile.created_at
      FROM public.profiles profile
      WHERE profile.id = v_existing.profile_id;
    RETURN;
  END IF;

  INSERT INTO public.profiles(
    owner_auth_user_id, name, slug, website_url, industry
  ) VALUES (
    p_owner_auth_user_id,
    btrim(p_name),
    p_slug,
    NULLIF(btrim(coalesce(p_website_url, '')), ''),
    NULLIF(btrim(coalesce(p_industry, '')), '')
  ) RETURNING public.profiles.id INTO v_profile_id;

  PERFORM public.apply_entitlement_package(
    v_profile_id,
    'commercial_guarded',
    1,
    p_owner_auth_user_id,
    'ONBOARDING_SERVER',
    jsonb_build_object('operation_id', p_operation_id, 'phase', 'FASE_5A')
  );

  INSERT INTO public.onboarding_profile_provisioning(
    owner_auth_user_id, operation_id, request_fingerprint, profile_id
  ) VALUES (
    p_owner_auth_user_id, p_operation_id, p_request_fingerprint, v_profile_id
  );

  RETURN QUERY
    SELECT profile.id, profile.name, profile.slug, profile.website_url,
      profile.industry, profile.timezone, profile.locale,
      profile.onboarding_completed, profile.created_at
    FROM public.profiles profile
    WHERE profile.id = v_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_onboarding_profile(text,uuid,text,text,text,text,text)
  FROM PUBLIC, authenticated;

COMMIT;
