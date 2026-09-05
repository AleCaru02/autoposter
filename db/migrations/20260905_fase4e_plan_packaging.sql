-- FASE 4E — provider-independent entitlement package mapping.
-- Existing production profiles keep INTERNAL_BASELINE rows. New profiles fail
-- closed for gated capabilities until a privileged package assignment.

BEGIN;

CREATE TABLE IF NOT EXISTS public.entitlement_packages (
  package_key text NOT NULL,
  version integer NOT NULL,
  lifecycle text NOT NULL DEFAULT 'ACTIVE',
  hard_monthly_provider_cost_cap_usd numeric NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (package_key, version),
  CONSTRAINT entitlement_packages_key_check CHECK (package_key ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT entitlement_packages_version_check CHECK (version > 0),
  CONSTRAINT entitlement_packages_lifecycle_check CHECK (lifecycle IN ('DRAFT','ACTIVE','RETIRED')),
  CONSTRAINT entitlement_packages_provider_cap_check CHECK (hard_monthly_provider_cost_cap_usd > 0)
);

CREATE TABLE IF NOT EXISTS public.entitlement_package_capabilities (
  package_key text NOT NULL,
  package_version integer NOT NULL,
  capability_key text NOT NULL,
  enabled boolean NOT NULL,
  limit_type text NOT NULL,
  limit_value numeric NULL,
  period_type text NOT NULL,
  provider_attempt_reserve_usd numeric NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (package_key, package_version, capability_key),
  FOREIGN KEY (package_key, package_version)
    REFERENCES public.entitlement_packages(package_key, version) ON DELETE CASCADE,
  CONSTRAINT entitlement_package_capabilities_limit_type_check CHECK (limit_type IN (
    'BOOLEAN','COUNT_PER_DAY','COUNT_PER_MONTH','CONCURRENT','MAX_CONNECTED_ACCOUNTS','STORAGE','SEATS','UNLIMITED','NOT_APPLICABLE'
  )),
  CONSTRAINT entitlement_package_capabilities_period_type_check CHECK (period_type IN ('NONE','DAY','MONTH')),
  CONSTRAINT entitlement_package_capabilities_finite_check CHECK (
    (enabled = false AND limit_value IS NULL AND provider_attempt_reserve_usd IS NULL)
    OR (enabled = true AND limit_type <> 'UNLIMITED' AND period_type <> 'NONE'
      AND limit_value > 0 AND provider_attempt_reserve_usd > 0)
  )
);

CREATE TABLE IF NOT EXISTS public.profile_entitlement_package_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  package_key text NOT NULL,
  package_version integer NOT NULL,
  source text NOT NULL DEFAULT 'INTERNAL_PROVISIONING',
  actor_auth_user_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  FOREIGN KEY (package_key, package_version)
    REFERENCES public.entitlement_packages(package_key, version),
  CONSTRAINT profile_package_window_check CHECK (revoked_at IS NULL OR revoked_at >= assigned_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_entitlement_package_current_idx
  ON public.profile_entitlement_package_assignments(profile_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS profile_entitlement_package_history_idx
  ON public.profile_entitlement_package_assignments(profile_id, assigned_at DESC);

ALTER TABLE public.entitlement_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_package_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_package_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profile_entitlement_package_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_entitlement_package_assignments FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.entitlement_packages FROM PUBLIC, authenticated;
REVOKE ALL ON TABLE public.entitlement_package_capabilities FROM PUBLIC, authenticated;
REVOKE ALL ON TABLE public.profile_entitlement_package_assignments FROM PUBLIC, authenticated;

INSERT INTO public.entitlement_packages(package_key, version, lifecycle, hard_monthly_provider_cost_cap_usd, metadata)
VALUES ('commercial_guarded', 1, 'DRAFT', 5, '{"pricing":"UNSET","purpose":"FASE_4E_COMMERCIAL_CANDIDATE"}'::jsonb)
ON CONFLICT (package_key, version) DO UPDATE SET
  lifecycle=public.entitlement_packages.lifecycle,
  hard_monthly_provider_cost_cap_usd=EXCLUDED.hard_monthly_provider_cost_cap_usd,
  metadata=EXCLUDED.metadata;

WITH package_rows(capability_key, enabled, limit_type, limit_value, period_type, provider_attempt_reserve_usd) AS (
  VALUES
    ('workspace.profile.manage', false, 'CONCURRENT', NULL::numeric, 'NONE', NULL::numeric),
    ('website.scan', false, 'COUNT_PER_MONTH', NULL, 'NONE', NULL),
    ('website.pages.persist', false, 'STORAGE', NULL, 'NONE', NULL),
    ('brand.analyze', true, 'COUNT_PER_MONTH', 2, 'MONTH', 0.5),
    ('ai.content.generate_text', true, 'COUNT_PER_MONTH', 30, 'MONTH', 1),
    ('ai.research.web', false, 'COUNT_PER_MONTH', NULL, 'NONE', NULL),
    ('ai.research.factcheck', false, 'COUNT_PER_MONTH', NULL, 'NONE', NULL),
    ('ai.strategy.generate', true, 'COUNT_PER_MONTH', 3, 'MONTH', 0.75),
    ('ai.image.generate', true, 'COUNT_PER_MONTH', 20, 'MONTH', 0.5),
    ('media.image.persist', false, 'STORAGE', NULL, 'NONE', NULL),
    ('content.approval.auto', false, 'BOOLEAN', NULL, 'NONE', NULL),
    ('autopilot.manage', false, 'BOOLEAN', NULL, 'NONE', NULL),
    ('autopilot.hourly', false, 'COUNT_PER_DAY', NULL, 'NONE', NULL),
    ('schedule.job.create', false, 'COUNT_PER_MONTH', NULL, 'NONE', NULL),
    ('social.facebook.connect', false, 'MAX_CONNECTED_ACCOUNTS', NULL, 'NONE', NULL),
    ('social.instagram.connect', false, 'MAX_CONNECTED_ACCOUNTS', NULL, 'NONE', NULL),
    ('social.linkedin.connect', false, 'MAX_CONNECTED_ACCOUNTS', NULL, 'NONE', NULL),
    ('social.gbp.connect', false, 'MAX_CONNECTED_ACCOUNTS', NULL, 'NONE', NULL),
    ('social.facebook.publish', false, 'COUNT_PER_MONTH', NULL, 'NONE', NULL),
    ('social.instagram.publish', false, 'COUNT_PER_MONTH', NULL, 'NONE', NULL),
    ('social.linkedin.publish', false, 'COUNT_PER_MONTH', NULL, 'NONE', NULL),
    ('social.gbp.publish', false, 'COUNT_PER_MONTH', NULL, 'NONE', NULL),
    ('social.publish.scheduled', false, 'BOOLEAN', NULL, 'NONE', NULL)
)
INSERT INTO public.entitlement_package_capabilities(
  package_key, package_version, capability_key, enabled, limit_type, limit_value, period_type, provider_attempt_reserve_usd
)
SELECT 'commercial_guarded', 1, capability_key, enabled, limit_type, limit_value, period_type, provider_attempt_reserve_usd
FROM package_rows
ON CONFLICT (package_key, package_version, capability_key) DO UPDATE SET enabled=EXCLUDED.enabled,
  limit_type=EXCLUDED.limit_type, limit_value=EXCLUDED.limit_value, period_type=EXCLUDED.period_type,
  provider_attempt_reserve_usd=EXCLUDED.provider_attempt_reserve_usd;

CREATE OR REPLACE FUNCTION public.apply_entitlement_package(
  p_profile_id uuid,
  p_package_key text,
  p_package_version integer,
  p_actor_auth_user_id text,
  p_source text DEFAULT 'INTERNAL_PROVISIONING',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_assignment_id uuid;
BEGIN
  IF p_actor_auth_user_id IS NULL OR btrim(p_actor_auth_user_id) = '' THEN RAISE EXCEPTION 'PACKAGE_ACTOR_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_profile_id) THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entitlement_packages
    WHERE package_key=p_package_key AND version=p_package_version AND lifecycle='ACTIVE') THEN
    RAISE EXCEPTION 'PACKAGE_NOT_ACTIVE';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('entitlement-package:' || p_profile_id::text, 0));
  UPDATE public.profile_entitlement_package_assignments SET revoked_at=now()
    WHERE profile_id=p_profile_id AND revoked_at IS NULL;
  INSERT INTO public.profile_entitlement_package_assignments(
    profile_id, package_key, package_version, source, actor_auth_user_id, metadata
  ) VALUES (p_profile_id, p_package_key, p_package_version,
    COALESCE(NULLIF(p_source,''),'INTERNAL_PROVISIONING'), p_actor_auth_user_id, COALESCE(p_metadata,'{}'::jsonb))
  RETURNING id INTO v_assignment_id;

  DELETE FROM public.profile_entitlements WHERE profile_id=p_profile_id AND capability_key IN (
    SELECT capability_key FROM public.entitlement_package_capabilities
    WHERE package_key=p_package_key AND package_version=p_package_version
  );
  INSERT INTO public.profile_entitlements(
    profile_id, capability_key, enabled, limit_type, limit_value, period_type, source, metadata
  )
  SELECT p_profile_id, capability_key, enabled, limit_type, limit_value, period_type,
    'PACKAGE:' || p_package_key || ':v' || p_package_version::text,
    jsonb_build_object('package_key',p_package_key,'package_version',p_package_version,
      'package_assignment_id',v_assignment_id,'provider_attempt_reserve_usd',provider_attempt_reserve_usd)
  FROM public.entitlement_package_capabilities
  WHERE package_key=p_package_key AND package_version=p_package_version;

  INSERT INTO public.platform_admin_audit(actor_auth_user_id, action, target_type, target_id, metadata)
  VALUES (p_actor_auth_user_id, 'ENTITLEMENT_CHANGED', 'profile', p_profile_id::text,
    jsonb_build_object('package_key',p_package_key,'package_version',p_package_version,
      'assignment_id',v_assignment_id,'source',COALESCE(NULLIF(p_source,''),'INTERNAL_PROVISIONING'))
      || COALESCE(p_metadata,'{}'::jsonb));
  RETURN v_assignment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_entitlement_package(uuid,text,integer,text,text,jsonb) FROM PUBLIC, authenticated;

-- Existing rows stay untouched; only automatic unlimited provisioning ends.
DROP TRIGGER IF EXISTS profile_entitlements_bootstrap_trigger ON public.profiles;

COMMIT;
