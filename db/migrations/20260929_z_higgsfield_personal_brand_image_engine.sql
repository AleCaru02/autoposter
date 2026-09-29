-- Post Automatici — Higgsfield Personal Brand image engine foundation.
-- Adds profile-scoped visual identity/reference storage, provider budget buckets,
-- and personal-operator entitlements without enabling any real generation.
-- SAFE_MODE and publishing are intentionally untouched.

BEGIN;

ALTER TABLE public.activity_ai_budget_policies
  ADD COLUMN IF NOT EXISTS higgsfield_cap_eur numeric,
  ADD COLUMN IF NOT EXISTS other_ai_cap_eur numeric;

UPDATE public.activity_ai_budget_policies
SET higgsfield_cap_eur = COALESCE(higgsfield_cap_eur, LEAST(10, hard_cap_eur)),
    other_ai_cap_eur = COALESCE(other_ai_cap_eur, GREATEST(hard_cap_eur - LEAST(10, hard_cap_eur), 0));

ALTER TABLE public.activity_ai_budget_policies
  ALTER COLUMN higgsfield_cap_eur SET DEFAULT 10,
  ALTER COLUMN higgsfield_cap_eur SET NOT NULL,
  ALTER COLUMN other_ai_cap_eur SET DEFAULT 20,
  ALTER COLUMN other_ai_cap_eur SET NOT NULL;

ALTER TABLE public.activity_ai_budget_policies
  DROP CONSTRAINT IF EXISTS activity_ai_budget_positive;
ALTER TABLE public.activity_ai_budget_policies
  ADD CONSTRAINT activity_ai_budget_positive CHECK (
    hard_cap_eur > 0
    AND ordinary_target_eur >= 0
    AND reserve_start_eur >= ordinary_target_eur
    AND protected_reserve_start_eur >= reserve_start_eur
    AND emergency_only_start_eur >= protected_reserve_start_eur
    AND hard_cap_eur >= emergency_only_start_eur
    AND usd_to_eur_rate > 0
    AND higgsfield_cap_eur >= 0
    AND other_ai_cap_eur >= 0
    AND higgsfield_cap_eur + other_ai_cap_eur <= hard_cap_eur
  );

ALTER TABLE public.provider_cost_attempts
  ADD COLUMN IF NOT EXISTS cost_bucket text NOT NULL DEFAULT 'OTHER_AI';

UPDATE public.provider_cost_attempts
SET cost_bucket = CASE
  WHEN capability_key LIKE 'visual.higgsfield.%' THEN 'HIGGSFIELD'
  WHEN capability_key LIKE 'social.%'
    OR capability_key LIKE 'schedule.%'
    OR capability_key LIKE 'workspace.%'
    OR capability_key = 'media.image.persist'
    THEN 'NON_AI'
  ELSE 'OTHER_AI'
END;

ALTER TABLE public.provider_cost_attempts
  DROP CONSTRAINT IF EXISTS provider_cost_attempts_bucket_check;
ALTER TABLE public.provider_cost_attempts
  ADD CONSTRAINT provider_cost_attempts_bucket_check
  CHECK (cost_bucket IN ('HIGGSFIELD','OTHER_AI','NON_AI'));

CREATE INDEX IF NOT EXISTS provider_cost_attempts_profile_bucket_period_idx
  ON public.provider_cost_attempts(profile_id, cost_bucket, period_start, period_end, provider_started_at);

CREATE TABLE IF NOT EXISTS public.personal_brand_reference_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  image_bytes bytea NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  width integer NULL,
  height integer NULL,
  quality_score numeric NULL,
  quality_status text NOT NULL DEFAULT 'PENDING',
  quality_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_brand_reference_file_check CHECK (
    length(filename) BETWEEN 1 AND 240
    AND mime_type IN ('image/jpeg','image/png','image/webp')
    AND byte_size > 0 AND byte_size <= 5242880
    AND sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT personal_brand_reference_dimensions_check CHECK (
    (width IS NULL AND height IS NULL)
    OR (width BETWEEN 1 AND 12000 AND height BETWEEN 1 AND 12000)
  ),
  CONSTRAINT personal_brand_reference_quality_check CHECK (
    quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1)
  ),
  CONSTRAINT personal_brand_reference_status_check CHECK (
    quality_status IN ('PENDING','PASS','REJECTED')
  ),
  UNIQUE(profile_id, sha256)
);

CREATE INDEX IF NOT EXISTS personal_brand_reference_profile_idx
  ON public.personal_brand_reference_images(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.personal_brand_visual_identities (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'HIGGSFIELD',
  soul_id text NULL,
  status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  reference_quality numeric NULL,
  reference_fingerprint text NULL,
  soul_created_at timestamptz NULL,
  last_checked_at timestamptz NULL,
  last_error_code text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_brand_visual_provider_check CHECK (provider='HIGGSFIELD'),
  CONSTRAINT personal_brand_visual_status_check CHECK (
    status IN ('NOT_CONFIGURED','REFERENCES_PENDING','READY_TO_CREATE','CREATING','COMPLETED','FAILED')
  ),
  CONSTRAINT personal_brand_visual_quality_check CHECK (
    reference_quality IS NULL OR (reference_quality >= 0 AND reference_quality <= 1)
  )
);

ALTER TABLE public.personal_brand_reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_brand_reference_images FORCE ROW LEVEL SECURITY;
ALTER TABLE public.personal_brand_visual_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_brand_visual_identities FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.personal_brand_reference_images FROM PUBLIC, authenticated;
REVOKE ALL ON TABLE public.personal_brand_visual_identities FROM PUBLIC, authenticated;

-- Higgsfield is personal-first: only the personal_operator package gets real
-- billable entitlements at this stage. Internal routing/identity capabilities
-- remain registry-only and are not billable entitlements.
WITH rows(capability_key, limit_value, reserve_usd) AS (
  VALUES
    ('visual.higgsfield.api', 200::numeric, 0.25::numeric),
    ('visual.higgsfield.soul_id', 4::numeric, 2.50::numeric),
    ('visual.identity.qa', 100::numeric, 0.05::numeric)
)
INSERT INTO public.entitlement_package_capabilities(
  package_key, package_version, capability_key, enabled, limit_type,
  limit_value, period_type, provider_attempt_reserve_usd, metadata
)
SELECT 'personal_operator', 1, capability_key, true, 'COUNT_PER_MONTH',
       limit_value, 'MONTH', reserve_usd,
       '{"personalFirst":true,"provider":"HIGGSFIELD","runtimeVerified":false}'::jsonb
FROM rows
ON CONFLICT (package_key, package_version, capability_key) DO UPDATE SET
  enabled=EXCLUDED.enabled,
  limit_type=EXCLUDED.limit_type,
  limit_value=EXCLUDED.limit_value,
  period_type=EXCLUDED.period_type,
  provider_attempt_reserve_usd=EXCLUDED.provider_attempt_reserve_usd,
  metadata=EXCLUDED.metadata;

-- Propagate newly introduced capabilities to already assigned personal profiles.
INSERT INTO public.profile_entitlements(
  profile_id, capability_key, enabled, limit_type, limit_value, period_type,
  source, metadata
)
SELECT
  assignment.profile_id,
  capability.capability_key,
  capability.enabled,
  capability.limit_type,
  capability.limit_value,
  capability.period_type,
  'PACKAGE:personal_operator:v1',
  jsonb_build_object(
    'package_key','personal_operator',
    'package_version',1,
    'package_assignment_id',assignment.id,
    'provider_attempt_reserve_usd',capability.provider_attempt_reserve_usd
  ) || capability.metadata
FROM public.profile_entitlement_package_assignments assignment
JOIN public.entitlement_package_capabilities capability
  ON capability.package_key=assignment.package_key
 AND capability.package_version=assignment.package_version
WHERE assignment.package_key='personal_operator'
  AND assignment.package_version=1
  AND assignment.revoked_at IS NULL
  AND capability.capability_key IN (
    'visual.higgsfield.api','visual.higgsfield.soul_id','visual.identity.qa'
  )
ON CONFLICT (profile_id, capability_key) DO UPDATE SET
  enabled=EXCLUDED.enabled,
  limit_type=EXCLUDED.limit_type,
  limit_value=EXCLUDED.limit_value,
  period_type=EXCLUDED.period_type,
  source=EXCLUDED.source,
  metadata=EXCLUDED.metadata,
  updated_at=now();

-- A profile owns €30 independently. Keep the account cap as an aggregate
-- safety ceiling, but never lower than the sum of currently enabled activity caps.
UPDATE public.account_ai_budget_policies account_policy
SET hard_cap_eur = GREATEST(
  account_policy.hard_cap_eur,
  COALESCE((
    SELECT sum(activity.hard_cap_eur)
    FROM public.profiles profile
    JOIN public.activity_ai_budget_policies activity
      ON activity.profile_id=profile.id AND activity.enabled=true
    WHERE profile.owner_user_id=account_policy.user_id
      AND profile.archived_at IS NULL
  ), account_policy.hard_cap_eur)
),
updated_at=now();

CREATE OR REPLACE FUNCTION public.set_account_ai_budget(p_hard_cap_eur numeric)
RETURNS public.account_ai_budget_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_user_id uuid:=public.current_app_user_id();
  v_row public.account_ai_budget_policies%ROWTYPE;
  v_required numeric;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_hard_cap_eur IS NULL OR p_hard_cap_eur<=0 OR p_hard_cap_eur>100000 THEN
    RAISE EXCEPTION 'INVALID_ACCOUNT_AI_BUDGET';
  END IF;
  SELECT COALESCE(sum(ap.hard_cap_eur),0) INTO v_required
  FROM public.profiles p
  JOIN public.activity_ai_budget_policies ap ON ap.profile_id=p.id AND ap.enabled=true
  WHERE p.owner_user_id=v_user_id AND p.archived_at IS NULL;
  IF p_hard_cap_eur<v_required THEN
    RAISE EXCEPTION 'ACCOUNT_AI_BUDGET_BELOW_ACTIVITY_CAP_SUM';
  END IF;
  INSERT INTO public.account_ai_budget_policies(user_id,hard_cap_eur,enabled,updated_at)
  VALUES (v_user_id,p_hard_cap_eur,true,now())
  ON CONFLICT (user_id) DO UPDATE SET
    hard_cap_eur=EXCLUDED.hard_cap_eur, enabled=true, updated_at=now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_activity_ai_budget_split(
  p_profile_id uuid,
  p_higgsfield_cap_eur numeric,
  p_other_ai_cap_eur numeric
)
RETURNS public.activity_ai_budget_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_row public.activity_ai_budget_policies%ROWTYPE;
BEGIN
  IF NOT public.owns_profile(p_profile_id) THEN
    RAISE EXCEPTION 'PROFILE_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_row FROM public.activity_ai_budget_policies
  WHERE profile_id=p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVITY_AI_BUDGET_NOT_FOUND'; END IF;
  IF p_higgsfield_cap_eur IS NULL OR p_other_ai_cap_eur IS NULL
     OR p_higgsfield_cap_eur<0 OR p_other_ai_cap_eur<0
     OR p_higgsfield_cap_eur+p_other_ai_cap_eur>v_row.hard_cap_eur THEN
    RAISE EXCEPTION 'INVALID_ACTIVITY_AI_BUDGET_SPLIT';
  END IF;
  UPDATE public.activity_ai_budget_policies
  SET higgsfield_cap_eur=p_higgsfield_cap_eur,
      other_ai_cap_eur=p_other_ai_cap_eur,
      updated_at=now()
  WHERE profile_id=p_profile_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_activity_ai_budget_split(uuid,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_activity_ai_budget_split(uuid,numeric,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.activity_ai_budget_snapshot(p_profile_id uuid)
RETURNS TABLE (
  hard_cap_eur numeric,
  ordinary_target_eur numeric,
  reserve_start_eur numeric,
  protected_reserve_start_eur numeric,
  emergency_only_start_eur numeric,
  usd_to_eur_rate numeric,
  accounted_eur numeric,
  remaining_eur numeric,
  band text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_policy public.activity_ai_budget_policies%ROWTYPE;
  v_start timestamptz:=date_trunc('month',now());
  v_end timestamptz:=date_trunc('month',now())+interval '1 month';
  v_accounted numeric:=0;
BEGIN
  SELECT * INTO v_policy FROM public.activity_ai_budget_policies
  WHERE profile_id=p_profile_id AND enabled=true;
  IF NOT FOUND THEN
    INSERT INTO public.activity_ai_budget_policies(profile_id) VALUES (p_profile_id)
    ON CONFLICT (profile_id) DO NOTHING;
    SELECT * INTO v_policy FROM public.activity_ai_budget_policies WHERE profile_id=p_profile_id;
  END IF;

  SELECT COALESCE(sum(
    GREATEST(attempt.reserved_usd,COALESCE(attempt.actual_usd,0))
    * COALESCE(attempt.fx_usd_to_eur_rate,v_policy.usd_to_eur_rate)
  ),0)
  INTO v_accounted
  FROM public.provider_cost_attempts attempt
  WHERE attempt.profile_id=p_profile_id
    AND attempt.period_start=v_start AND attempt.period_end=v_end
    AND attempt.cost_bucket IN ('HIGGSFIELD','OTHER_AI');

  RETURN QUERY SELECT
    v_policy.hard_cap_eur,
    v_policy.ordinary_target_eur,
    v_policy.reserve_start_eur,
    v_policy.protected_reserve_start_eur,
    v_policy.emergency_only_start_eur,
    v_policy.usd_to_eur_rate,
    v_accounted,
    GREATEST(v_policy.hard_cap_eur-v_accounted,0),
    CASE
      WHEN v_accounted>=v_policy.hard_cap_eur THEN 'HARD_STOP'
      WHEN v_accounted>=v_policy.emergency_only_start_eur THEN 'EMERGENCY_ONLY'
      WHEN v_accounted>=v_policy.protected_reserve_start_eur THEN 'PROTECTED_RESERVE'
      WHEN v_accounted>=v_policy.reserve_start_eur THEN 'RESERVE'
      WHEN v_accounted>=v_policy.ordinary_target_eur THEN 'TARGET_REACHED'
      ELSE 'NORMAL'
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.activity_ai_budget_snapshot(uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.begin_provider_cost_attempt(p_logical_usage_event_id uuid)
RETURNS TABLE (
  allowed boolean,
  managed boolean,
  duplicate boolean,
  attempt_id uuid,
  cap_usd numeric,
  accounted_usd numeric,
  remaining_usd numeric,
  reserve_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_logical public.capability_usage_events%ROWTYPE;
  v_assignment public.profile_entitlement_package_assignments%ROWTYPE;
  v_existing public.provider_cost_attempts%ROWTYPE;
  v_activity public.activity_ai_budget_policies%ROWTYPE;
  v_account public.account_ai_budget_policies%ROWTYPE;
  v_owner_user_id uuid;
  v_package_cap numeric;
  v_package_reserve numeric;
  v_reserve numeric;
  v_bucket text;
  v_bucket_cap_eur numeric;
  v_period_start timestamptz:=date_trunc('month',now());
  v_period_end timestamptz:=date_trunc('month',now())+interval '1 month';
  v_package_usd numeric:=0;
  v_activity_ai_eur numeric:=0;
  v_account_ai_eur numeric:=0;
  v_bucket_eur numeric:=0;
  v_effective_cap_usd numeric;
  v_remaining_usd numeric;
  v_attempt_id uuid;
  v_override numeric;
BEGIN
  SELECT * INTO v_logical FROM public.capability_usage_events
  WHERE id=p_logical_usage_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USAGE_EVENT_NOT_FOUND'; END IF;
  IF v_logical.state<>'RESERVED' THEN RAISE EXCEPTION 'USAGE_EVENT_NOT_RESERVED'; END IF;

  SELECT p.owner_user_id INTO v_owner_user_id FROM public.profiles p WHERE p.id=v_logical.profile_id;
  IF v_owner_user_id IS NULL THEN RAISE EXCEPTION 'PROFILE_OWNER_REQUIRED'; END IF;

  v_bucket:=upper(coalesce(nullif(v_logical.metadata->>'cost_bucket',''),
    CASE
      WHEN v_logical.capability_key LIKE 'visual.higgsfield.%' THEN 'HIGGSFIELD'
      WHEN v_logical.capability_key LIKE 'social.%'
        OR v_logical.capability_key LIKE 'schedule.%'
        OR v_logical.capability_key LIKE 'workspace.%'
        OR v_logical.capability_key='media.image.persist'
        THEN 'NON_AI'
      ELSE 'OTHER_AI'
    END
  ));
  IF v_bucket NOT IN ('HIGGSFIELD','OTHER_AI','NON_AI') THEN
    RAISE EXCEPTION 'INVALID_PROVIDER_COST_BUCKET';
  END IF;

  SELECT * INTO v_existing FROM public.provider_cost_attempts
  WHERE logical_usage_event_id=p_logical_usage_event_id;
  IF FOUND THEN
    SELECT coalesce(sum(greatest(reserved_usd,coalesce(actual_usd,0))),0)
    INTO v_package_usd FROM public.provider_cost_attempts
    WHERE profile_id=v_existing.profile_id
      AND period_start=v_existing.period_start AND period_end=v_existing.period_end;
    RETURN QUERY SELECT true,true,true,v_existing.id,NULL::numeric,v_package_usd,NULL::numeric,v_existing.reserved_usd;
    RETURN;
  END IF;

  SELECT * INTO v_assignment FROM public.profile_entitlement_package_assignments
  WHERE profile_id=v_logical.profile_id AND revoked_at IS NULL LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT true,false,false,NULL::uuid,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_activity FROM public.activity_ai_budget_policies
  WHERE profile_id=v_logical.profile_id AND enabled=true;
  IF NOT FOUND THEN
    INSERT INTO public.activity_ai_budget_policies(profile_id) VALUES(v_logical.profile_id)
    ON CONFLICT(profile_id) DO NOTHING;
    SELECT * INTO v_activity FROM public.activity_ai_budget_policies WHERE profile_id=v_logical.profile_id;
  END IF;

  SELECT * INTO v_account FROM public.account_ai_budget_policies
  WHERE user_id=v_owner_user_id AND enabled=true;
  IF NOT FOUND THEN
    INSERT INTO public.account_ai_budget_policies(user_id) VALUES(v_owner_user_id)
    ON CONFLICT(user_id) DO NOTHING;
    SELECT * INTO v_account FROM public.account_ai_budget_policies WHERE user_id=v_owner_user_id;
  END IF;

  SELECT p.hard_monthly_provider_cost_cap_usd,c.provider_attempt_reserve_usd
  INTO v_package_cap,v_package_reserve
  FROM public.entitlement_packages p
  JOIN public.entitlement_package_capabilities c
    ON c.package_key=p.package_key AND c.package_version=p.version
  WHERE p.package_key=v_assignment.package_key AND p.version=v_assignment.package_version
    AND p.lifecycle='ACTIVE' AND c.capability_key=v_logical.capability_key AND c.enabled=true;
  IF NOT FOUND OR v_package_reserve IS NULL THEN RAISE EXCEPTION 'PACKAGE_CAPABILITY_NOT_ACTIVE'; END IF;

  v_override:=NULLIF(v_logical.metadata->>'provider_cost_reserve_usd','')::numeric;
  v_reserve:=greatest(v_package_reserve,coalesce(v_override,0));
  IF v_reserve<=0 THEN RAISE EXCEPTION 'INVALID_PROVIDER_RESERVE'; END IF;

  -- Stable lock order prevents concurrent requests from escaping any cap.
  PERFORM pg_advisory_xact_lock(hashtextextended('account-ai-budget:'||v_owner_user_id::text||':'||v_period_start::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('activity-ai-budget:'||v_logical.profile_id::text||':'||v_period_start::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('activity-ai-budget-bucket:'||v_logical.profile_id::text||':'||v_bucket||':'||v_period_start::text,0));

  SELECT coalesce(sum(greatest(a.reserved_usd,coalesce(a.actual_usd,0))),0)
  INTO v_package_usd
  FROM public.provider_cost_attempts a
  WHERE a.profile_id=v_logical.profile_id
    AND a.period_start=v_period_start AND a.period_end=v_period_end;

  SELECT coalesce(sum(greatest(a.reserved_usd,coalesce(a.actual_usd,0))*a.fx_usd_to_eur_rate),0)
  INTO v_activity_ai_eur
  FROM public.provider_cost_attempts a
  WHERE a.profile_id=v_logical.profile_id
    AND a.period_start=v_period_start AND a.period_end=v_period_end
    AND a.cost_bucket IN ('HIGGSFIELD','OTHER_AI');

  SELECT coalesce(sum(greatest(a.reserved_usd,coalesce(a.actual_usd,0))*a.fx_usd_to_eur_rate),0)
  INTO v_account_ai_eur
  FROM public.provider_cost_attempts a
  JOIN public.profiles p ON p.id=a.profile_id
  WHERE p.owner_user_id=v_owner_user_id
    AND a.period_start=v_period_start AND a.period_end=v_period_end
    AND a.cost_bucket IN ('HIGGSFIELD','OTHER_AI');

  IF v_bucket<>'NON_AI' THEN
    SELECT coalesce(sum(greatest(a.reserved_usd,coalesce(a.actual_usd,0))*a.fx_usd_to_eur_rate),0)
    INTO v_bucket_eur
    FROM public.provider_cost_attempts a
    WHERE a.profile_id=v_logical.profile_id
      AND a.period_start=v_period_start AND a.period_end=v_period_end
      AND a.cost_bucket=v_bucket;
  END IF;

  v_bucket_cap_eur:=CASE
    WHEN v_bucket='HIGGSFIELD' THEN v_activity.higgsfield_cap_eur
    WHEN v_bucket='OTHER_AI' THEN v_activity.other_ai_cap_eur
    ELSE NULL
  END;

  IF v_bucket='NON_AI' THEN
    v_effective_cap_usd:=v_package_cap;
    v_remaining_usd:=greatest(v_package_cap-v_package_usd,0);
  ELSE
    v_effective_cap_usd:=least(
      v_package_cap,
      v_activity.hard_cap_eur/v_activity.usd_to_eur_rate,
      v_account.hard_cap_eur/v_activity.usd_to_eur_rate,
      v_bucket_cap_eur/v_activity.usd_to_eur_rate
    );
    v_remaining_usd:=greatest(least(
      v_package_cap-v_package_usd,
      (v_activity.hard_cap_eur-v_activity_ai_eur)/v_activity.usd_to_eur_rate,
      (v_account.hard_cap_eur-v_account_ai_eur)/v_activity.usd_to_eur_rate,
      (v_bucket_cap_eur-v_bucket_eur)/v_activity.usd_to_eur_rate
    ),0);
  END IF;

  IF v_package_usd+v_reserve>v_package_cap
     OR (v_bucket<>'NON_AI' AND (
       v_activity_ai_eur+(v_reserve*v_activity.usd_to_eur_rate)>v_activity.hard_cap_eur
       OR v_account_ai_eur+(v_reserve*v_activity.usd_to_eur_rate)>v_account.hard_cap_eur
       OR v_bucket_eur+(v_reserve*v_activity.usd_to_eur_rate)>v_bucket_cap_eur
     )) THEN
    RETURN QUERY SELECT false,true,false,NULL::uuid,v_effective_cap_usd,v_package_usd,v_remaining_usd,v_reserve;
    RETURN;
  END IF;

  INSERT INTO public.provider_cost_attempts(
    logical_usage_event_id,profile_id,capability_key,package_assignment_id,reserved_usd,
    period_start,period_end,fx_usd_to_eur_rate,cost_bucket
  ) VALUES (
    p_logical_usage_event_id,v_logical.profile_id,v_logical.capability_key,v_assignment.id,v_reserve,
    v_period_start,v_period_end,v_activity.usd_to_eur_rate,v_bucket
  ) RETURNING id INTO v_attempt_id;

  RETURN QUERY SELECT true,true,false,v_attempt_id,v_effective_cap_usd,
    v_package_usd+v_reserve,greatest(v_remaining_usd-v_reserve,0),v_reserve;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_provider_cost_attempt(uuid) FROM PUBLIC,authenticated;

-- Restore personal-first package resolution for the first-class profile-type overload.
CREATE OR REPLACE FUNCTION public.provision_onboarding_profile(
  p_owner_auth_user_id text,
  p_operation_id uuid,
  p_request_fingerprint text,
  p_name text,
  p_slug text,
  p_website_url text,
  p_industry text,
  p_profile_type text
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
  created_at timestamptz,
  profile_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.onboarding_profile_provisioning%ROWTYPE;
  v_profile_id uuid;
  v_profile_type text;
  v_package_key text:='commercial_guarded';
  v_package_version integer:=1;
  v_package_source text:='ONBOARDING_SERVER';
BEGIN
  IF p_owner_auth_user_id IS NULL OR btrim(p_owner_auth_user_id)='' THEN
    RAISE EXCEPTION 'ONBOARDING_ACTOR_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM neon_auth.user u WHERE u.id::text=p_owner_auth_user_id) THEN
    RAISE EXCEPTION 'ONBOARDING_ACTOR_UNKNOWN' USING ERRCODE='42501';
  END IF;
  IF p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'ONBOARDING_FINGERPRINT_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_name IS NULL OR btrim(p_name)='' OR length(btrim(p_name))>160 THEN
    RAISE EXCEPTION 'ONBOARDING_NAME_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR length(p_slug)>80 THEN
    RAISE EXCEPTION 'ONBOARDING_SLUG_INVALID' USING ERRCODE='22023';
  END IF;
  v_profile_type:=upper(coalesce(nullif(btrim(p_profile_type),''),'BUSINESS'));
  IF v_profile_type NOT IN ('BUSINESS','PERSONAL_BRAND') THEN
    RAISE EXCEPTION 'ONBOARDING_PROFILE_TYPE_INVALID' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'onboarding-profile:'||p_owner_auth_user_id||':'||p_operation_id::text,0
  ));

  SELECT provisioning.* INTO v_existing
  FROM public.onboarding_profile_provisioning provisioning
  WHERE provisioning.owner_auth_user_id=p_owner_auth_user_id
    AND provisioning.operation_id=p_operation_id;
  IF FOUND THEN
    IF v_existing.request_fingerprint IS DISTINCT FROM p_request_fingerprint THEN
      RAISE EXCEPTION 'ONBOARDING_IDEMPOTENCY_CONFLICT' USING ERRCODE='22023';
    END IF;
    RETURN QUERY
      SELECT profile.id,profile.name,profile.slug,profile.website_url,
        profile.industry,profile.timezone,profile.locale,
        profile.onboarding_completed,profile.created_at,profile.profile_type
      FROM public.profiles profile WHERE profile.id=v_existing.profile_id;
    RETURN;
  END IF;

  SELECT defaults.package_key,defaults.package_version
  INTO v_package_key,v_package_version
  FROM public.user_provisioning_package_defaults defaults
  WHERE defaults.auth_user_id=p_owner_auth_user_id;
  IF FOUND THEN v_package_source:='ONBOARDING_USER_DEFAULT'; END IF;

  INSERT INTO public.profiles(
    owner_auth_user_id,name,slug,website_url,industry,profile_type
  ) VALUES (
    p_owner_auth_user_id,btrim(p_name),p_slug,
    NULLIF(btrim(coalesce(p_website_url,'')),''),
    NULLIF(btrim(coalesce(p_industry,'')),''),
    v_profile_type
  ) RETURNING public.profiles.id INTO v_profile_id;

  INSERT INTO public.profile_tenant_modes(
    profile_id,tenant_type,external_publishing_enabled,metadata
  ) VALUES (
    v_profile_id,'CUSTOMER_REAL',true,jsonb_build_object('source','ONBOARDING_SERVER')
  ) ON CONFLICT(profile_id) DO NOTHING;

  PERFORM public.apply_entitlement_package(
    v_profile_id,v_package_key,v_package_version,p_owner_auth_user_id,v_package_source,
    jsonb_build_object(
      'operation_id',p_operation_id,
      'phase','HIGGSFIELD_PERSONAL_BRAND',
      'profile_type',v_profile_type,
      'resolved_package_key',v_package_key,
      'resolved_package_version',v_package_version
    )
  );

  INSERT INTO public.onboarding_profile_provisioning(
    owner_auth_user_id,operation_id,request_fingerprint,profile_id
  ) VALUES (
    p_owner_auth_user_id,p_operation_id,p_request_fingerprint,v_profile_id
  );

  RETURN QUERY
    SELECT profile.id,profile.name,profile.slug,profile.website_url,
      profile.industry,profile.timezone,profile.locale,
      profile.onboarding_completed,profile.created_at,profile.profile_type
    FROM public.profiles profile WHERE profile.id=v_profile_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_onboarding_profile(text,uuid,text,text,text,text,text,text)
FROM PUBLIC,authenticated;

COMMIT;
