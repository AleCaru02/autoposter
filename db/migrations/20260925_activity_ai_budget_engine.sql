-- Per-activity AI budget engine.
-- Every profile owns an independent EUR budget policy. Provider billing is
-- normalized from USD with a profile-scoped conversion rate snapshot.

BEGIN;

CREATE TABLE IF NOT EXISTS public.activity_ai_budget_policies (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  hard_cap_eur numeric NOT NULL DEFAULT 30,
  ordinary_target_eur numeric NOT NULL DEFAULT 18,
  reserve_start_eur numeric NOT NULL DEFAULT 20,
  protected_reserve_start_eur numeric NOT NULL DEFAULT 25,
  emergency_only_start_eur numeric NOT NULL DEFAULT 28,
  usd_to_eur_rate numeric NOT NULL DEFAULT 1,
  fx_source text NOT NULL DEFAULT 'CONSERVATIVE_1_TO_1',
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_ai_budget_positive CHECK (
    hard_cap_eur > 0 AND ordinary_target_eur >= 0 AND reserve_start_eur >= ordinary_target_eur
    AND protected_reserve_start_eur >= reserve_start_eur
    AND emergency_only_start_eur >= protected_reserve_start_eur
    AND hard_cap_eur >= emergency_only_start_eur
    AND usd_to_eur_rate > 0
  )
);

INSERT INTO public.activity_ai_budget_policies(profile_id)
SELECT id FROM public.profiles
ON CONFLICT (profile_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_activity_ai_budget_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  INSERT INTO public.activity_ai_budget_policies(profile_id) VALUES (NEW.id)
  ON CONFLICT (profile_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_activity_ai_budget_policy ON public.profiles;
CREATE TRIGGER profiles_activity_ai_budget_policy
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.ensure_activity_ai_budget_policy();

ALTER TABLE public.activity_ai_budget_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_ai_budget_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activity_ai_budget_customer_read ON public.activity_ai_budget_policies;
CREATE POLICY activity_ai_budget_customer_read ON public.activity_ai_budget_policies
  FOR SELECT TO authenticated USING (public.owns_profile(profile_id));
REVOKE INSERT,UPDATE,DELETE ON public.activity_ai_budget_policies FROM authenticated;
GRANT SELECT ON public.activity_ai_budget_policies TO authenticated;

ALTER TABLE public.provider_cost_attempts
  ADD COLUMN IF NOT EXISTS fx_usd_to_eur_rate numeric NOT NULL DEFAULT 1;

ALTER TABLE public.provider_cost_attempts
  DROP CONSTRAINT IF EXISTS provider_cost_attempts_fx_check;
ALTER TABLE public.provider_cost_attempts
  ADD CONSTRAINT provider_cost_attempts_fx_check CHECK (fx_usd_to_eur_rate > 0);

-- The old package cap remains a secondary finite guard, but is intentionally
-- above the per-profile EUR budget so the activity budget is the primary rule.
UPDATE public.entitlement_packages
SET hard_monthly_provider_cost_cap_usd=100
WHERE package_key='personal_operator' AND version=1;

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
    AND attempt.period_start=v_start AND attempt.period_end=v_end;

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_logical public.capability_usage_events%ROWTYPE;
  v_assignment public.profile_entitlement_package_assignments%ROWTYPE;
  v_package_cap numeric;
  v_cap numeric;
  v_reserve numeric;
  v_existing public.provider_cost_attempts%ROWTYPE;
  v_policy public.activity_ai_budget_policies%ROWTYPE;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_accounted_usd numeric;
  v_accounted_eur numeric;
  v_attempt_id uuid;
  v_profile_cap_usd numeric;
BEGIN
  SELECT * INTO v_logical FROM public.capability_usage_events
    WHERE id=p_logical_usage_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USAGE_EVENT_NOT_FOUND'; END IF;
  IF v_logical.state <> 'RESERVED' THEN RAISE EXCEPTION 'USAGE_EVENT_NOT_RESERVED'; END IF;

  SELECT * INTO v_assignment FROM public.profile_entitlement_package_assignments
    WHERE profile_id=v_logical.profile_id AND revoked_at IS NULL LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT true,false,false,NULL::uuid,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric;
    RETURN;
  END IF;

  SELECT * INTO v_policy FROM public.activity_ai_budget_policies
    WHERE profile_id=v_logical.profile_id AND enabled=true;
  IF NOT FOUND THEN
    INSERT INTO public.activity_ai_budget_policies(profile_id) VALUES (v_logical.profile_id)
    ON CONFLICT (profile_id) DO NOTHING;
    SELECT * INTO v_policy FROM public.activity_ai_budget_policies WHERE profile_id=v_logical.profile_id;
  END IF;

  SELECT p.hard_monthly_provider_cost_cap_usd, c.provider_attempt_reserve_usd
    INTO v_package_cap, v_reserve
  FROM public.entitlement_packages p
  JOIN public.entitlement_package_capabilities c
    ON c.package_key=p.package_key AND c.package_version=p.version
  WHERE p.package_key=v_assignment.package_key AND p.version=v_assignment.package_version
    AND p.lifecycle='ACTIVE' AND c.capability_key=v_logical.capability_key AND c.enabled=true;
  IF NOT FOUND OR v_reserve IS NULL THEN RAISE EXCEPTION 'PACKAGE_CAPABILITY_NOT_ACTIVE'; END IF;

  v_profile_cap_usd:=v_policy.hard_cap_eur/v_policy.usd_to_eur_rate;
  v_cap:=LEAST(v_package_cap,v_profile_cap_usd);
  v_period_start=date_trunc('month',now());
  v_period_end=v_period_start+interval '1 month';

  SELECT * INTO v_existing FROM public.provider_cost_attempts
    WHERE logical_usage_event_id=p_logical_usage_event_id;
  IF FOUND THEN
    SELECT COALESCE(sum(GREATEST(reserved_usd,COALESCE(actual_usd,0))),0),
           COALESCE(sum(GREATEST(reserved_usd,COALESCE(actual_usd,0))*fx_usd_to_eur_rate),0)
      INTO v_accounted_usd,v_accounted_eur
    FROM public.provider_cost_attempts
    WHERE profile_id=v_existing.profile_id AND period_start=v_existing.period_start AND period_end=v_existing.period_end;
    RETURN QUERY SELECT true,true,true,v_existing.id,v_cap,v_accounted_usd,
      GREATEST(LEAST(v_package_cap-v_accounted_usd,(v_policy.hard_cap_eur-v_accounted_eur)/v_policy.usd_to_eur_rate),0),
      v_existing.reserved_usd;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'activity-ai-budget:' || v_logical.profile_id::text || ':' || v_period_start::text, 0
  ));

  SELECT COALESCE(sum(GREATEST(reserved_usd,COALESCE(actual_usd,0))),0),
         COALESCE(sum(GREATEST(reserved_usd,COALESCE(actual_usd,0))*fx_usd_to_eur_rate),0)
    INTO v_accounted_usd,v_accounted_eur
  FROM public.provider_cost_attempts
  WHERE profile_id=v_logical.profile_id AND period_start=v_period_start AND period_end=v_period_end;

  IF v_accounted_usd+v_reserve>v_package_cap
     OR v_accounted_eur+(v_reserve*v_policy.usd_to_eur_rate)>v_policy.hard_cap_eur THEN
    RETURN QUERY SELECT false,true,false,NULL::uuid,v_cap,v_accounted_usd,
      GREATEST(LEAST(v_package_cap-v_accounted_usd,(v_policy.hard_cap_eur-v_accounted_eur)/v_policy.usd_to_eur_rate),0),
      v_reserve;
    RETURN;
  END IF;

  INSERT INTO public.provider_cost_attempts(
    logical_usage_event_id,profile_id,capability_key,package_assignment_id,reserved_usd,
    period_start,period_end,fx_usd_to_eur_rate
  ) VALUES (
    p_logical_usage_event_id,v_logical.profile_id,v_logical.capability_key,v_assignment.id,v_reserve,
    v_period_start,v_period_end,v_policy.usd_to_eur_rate
  ) RETURNING id INTO v_attempt_id;

  v_accounted_usd:=v_accounted_usd+v_reserve;
  v_accounted_eur:=v_accounted_eur+(v_reserve*v_policy.usd_to_eur_rate);
  RETURN QUERY SELECT true,true,false,v_attempt_id,v_cap,v_accounted_usd,
    GREATEST(LEAST(v_package_cap-v_accounted_usd,(v_policy.hard_cap_eur-v_accounted_eur)/v_policy.usd_to_eur_rate),0),
    v_reserve;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_provider_cost_attempt(uuid) FROM PUBLIC, authenticated;

COMMIT;
