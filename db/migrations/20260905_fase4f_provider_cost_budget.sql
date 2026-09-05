-- FASE 4F — server-owned provider attempt budget.
-- A commercial logical unit may be released after failure, but a provider
-- attempt remains conservatively accounted once it was allowed to start.

BEGIN;

CREATE TABLE IF NOT EXISTS public.provider_cost_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logical_usage_event_id uuid NOT NULL UNIQUE REFERENCES public.capability_usage_events(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  package_assignment_id uuid NOT NULL REFERENCES public.profile_entitlement_package_assignments(id),
  reserved_usd numeric NOT NULL,
  actual_usd numeric NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  provider_started_at timestamptz NOT NULL DEFAULT now(),
  actual_updated_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT provider_cost_attempts_reserved_check CHECK (reserved_usd > 0),
  CONSTRAINT provider_cost_attempts_actual_check CHECK (actual_usd IS NULL OR actual_usd >= 0),
  CONSTRAINT provider_cost_attempts_period_check CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS provider_cost_attempts_profile_period_idx
  ON public.provider_cost_attempts(profile_id, period_start, period_end, provider_started_at);

ALTER TABLE public.provider_cost_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_cost_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.provider_cost_attempts FROM PUBLIC, authenticated;

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
  v_cap numeric;
  v_reserve numeric;
  v_existing public.provider_cost_attempts%ROWTYPE;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_accounted numeric;
  v_attempt_id uuid;
BEGIN
  SELECT * INTO v_logical FROM public.capability_usage_events
    WHERE id=p_logical_usage_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USAGE_EVENT_NOT_FOUND'; END IF;
  IF v_logical.state <> 'RESERVED' THEN RAISE EXCEPTION 'USAGE_EVENT_NOT_RESERVED'; END IF;

  SELECT * INTO v_existing FROM public.provider_cost_attempts
    WHERE logical_usage_event_id=p_logical_usage_event_id;
  IF FOUND THEN
    SELECT p.hard_monthly_provider_cost_cap_usd INTO v_cap
    FROM public.entitlement_packages p
    WHERE p.package_key=(SELECT package_key FROM public.profile_entitlement_package_assignments WHERE id=v_existing.package_assignment_id)
      AND p.version=(SELECT package_version FROM public.profile_entitlement_package_assignments WHERE id=v_existing.package_assignment_id);
    SELECT COALESCE(sum(GREATEST(reserved_usd,COALESCE(actual_usd,0))),0) INTO v_accounted
    FROM public.provider_cost_attempts
    WHERE profile_id=v_existing.profile_id AND period_start=v_existing.period_start AND period_end=v_existing.period_end;
    RETURN QUERY SELECT true,true,true,v_existing.id,v_cap,v_accounted,
      GREATEST(v_cap-v_accounted,0),v_existing.reserved_usd;
    RETURN;
  END IF;

  SELECT * INTO v_assignment FROM public.profile_entitlement_package_assignments
    WHERE profile_id=v_logical.profile_id AND revoked_at IS NULL LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT true,false,false,NULL::uuid,NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric;
    RETURN;
  END IF;

  SELECT p.hard_monthly_provider_cost_cap_usd, c.provider_attempt_reserve_usd
    INTO v_cap, v_reserve
  FROM public.entitlement_packages p
  JOIN public.entitlement_package_capabilities c
    ON c.package_key=p.package_key AND c.package_version=p.version
  WHERE p.package_key=v_assignment.package_key AND p.version=v_assignment.package_version
    AND p.lifecycle='ACTIVE' AND c.capability_key=v_logical.capability_key AND c.enabled=true;
  IF NOT FOUND OR v_reserve IS NULL THEN RAISE EXCEPTION 'PACKAGE_CAPABILITY_NOT_ACTIVE'; END IF;

  v_period_start=date_trunc('month',now());
  v_period_end=v_period_start+interval '1 month';
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'provider-cost:' || v_logical.profile_id::text || ':' || v_period_start::text, 0
  ));
  SELECT COALESCE(sum(GREATEST(reserved_usd,COALESCE(actual_usd,0))),0) INTO v_accounted
  FROM public.provider_cost_attempts
  WHERE profile_id=v_logical.profile_id AND period_start=v_period_start AND period_end=v_period_end;

  IF v_accounted+v_reserve > v_cap THEN
    RETURN QUERY SELECT false,true,false,NULL::uuid,v_cap,v_accounted,GREATEST(v_cap-v_accounted,0),v_reserve;
    RETURN;
  END IF;

  INSERT INTO public.provider_cost_attempts(
    logical_usage_event_id,profile_id,capability_key,package_assignment_id,reserved_usd,period_start,period_end
  ) VALUES (
    p_logical_usage_event_id,v_logical.profile_id,v_logical.capability_key,v_assignment.id,v_reserve,v_period_start,v_period_end
  ) RETURNING id INTO v_attempt_id;
  v_accounted=v_accounted+v_reserve;
  RETURN QUERY SELECT true,true,false,v_attempt_id,v_cap,v_accounted,GREATEST(v_cap-v_accounted,0),v_reserve;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_provider_cost_attempt(p_logical_usage_event_id uuid)
RETURNS public.provider_cost_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_attempt public.provider_cost_attempts%ROWTYPE; v_actual numeric;
BEGIN
  SELECT * INTO v_attempt FROM public.provider_cost_attempts
    WHERE logical_usage_event_id=p_logical_usage_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(cost_usd),0) INTO v_actual FROM public.ai_usage_events
    WHERE metadata->>'logical_usage_event_id'=p_logical_usage_event_id::text;
  UPDATE public.provider_cost_attempts SET actual_usd=v_actual,actual_updated_at=now(),
    metadata=metadata || jsonb_build_object('reserve_exceeded',v_actual>reserved_usd)
  WHERE id=v_attempt.id RETURNING * INTO v_attempt;
  RETURN v_attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_provider_cost_attempt(uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_provider_cost_attempt(uuid) FROM PUBLIC, authenticated;

-- The package becomes assignable only after its budget ledger exists.
UPDATE public.entitlement_packages SET lifecycle='ACTIVE'
WHERE package_key='commercial_guarded' AND version=1 AND lifecycle='DRAFT';

COMMIT;
