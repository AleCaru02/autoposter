-- FASE 3 — configurable account + activity AI hard caps.
-- Account cap is user-selected and enforced atomically together with activity cap.
-- Existing activity policies remain; this migration adds account scope and safe setters.

BEGIN;

CREATE TABLE IF NOT EXISTS public.account_ai_budget_policies (
  user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  hard_cap_eur numeric NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_ai_budget_positive CHECK (hard_cap_eur > 0)
);

INSERT INTO public.account_ai_budget_policies(user_id)
SELECT id FROM public.app_users
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ensure_account_ai_budget_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
BEGIN
  INSERT INTO public.account_ai_budget_policies(user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_users_account_ai_budget_policy ON public.app_users;
CREATE TRIGGER app_users_account_ai_budget_policy
AFTER INSERT ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.ensure_account_ai_budget_policy();

ALTER TABLE public.account_ai_budget_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_ai_budget_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_ai_budget_owner_read ON public.account_ai_budget_policies;
CREATE POLICY account_ai_budget_owner_read ON public.account_ai_budget_policies
  FOR SELECT TO authenticated USING (user_id=public.current_app_user_id());

REVOKE ALL ON public.account_ai_budget_policies FROM PUBLIC, authenticated;
GRANT SELECT ON public.account_ai_budget_policies TO authenticated;

CREATE OR REPLACE FUNCTION public.set_account_ai_budget(p_hard_cap_eur numeric)
RETURNS public.account_ai_budget_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_user_id uuid:=public.current_app_user_id();
  v_row public.account_ai_budget_policies%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_hard_cap_eur IS NULL OR p_hard_cap_eur<=0 OR p_hard_cap_eur>100000 THEN
    RAISE EXCEPTION 'INVALID_ACCOUNT_AI_BUDGET';
  END IF;
  INSERT INTO public.account_ai_budget_policies(user_id,hard_cap_eur,enabled,updated_at)
  VALUES (v_user_id,p_hard_cap_eur,true,now())
  ON CONFLICT (user_id) DO UPDATE SET
    hard_cap_eur=EXCLUDED.hard_cap_eur, enabled=true, updated_at=now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_activity_ai_budget(p_profile_id uuid,p_hard_cap_eur numeric)
RETURNS public.activity_ai_budget_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_row public.activity_ai_budget_policies%ROWTYPE;
BEGIN
  IF NOT public.owns_profile(p_profile_id) THEN
    RAISE EXCEPTION 'PROFILE_ACCESS_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_hard_cap_eur IS NULL OR p_hard_cap_eur<=0 OR p_hard_cap_eur>100000 THEN
    RAISE EXCEPTION 'INVALID_ACTIVITY_AI_BUDGET';
  END IF;
  INSERT INTO public.activity_ai_budget_policies(
    profile_id,hard_cap_eur,ordinary_target_eur,reserve_start_eur,
    protected_reserve_start_eur,emergency_only_start_eur,enabled,updated_at
  ) VALUES (
    p_profile_id,p_hard_cap_eur,
    round(p_hard_cap_eur*0.60,2),
    round(p_hard_cap_eur*0.67,2),
    round(p_hard_cap_eur*0.83,2),
    round(p_hard_cap_eur*0.93,2),
    true,now()
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    hard_cap_eur=EXCLUDED.hard_cap_eur,
    ordinary_target_eur=EXCLUDED.ordinary_target_eur,
    reserve_start_eur=EXCLUDED.reserve_start_eur,
    protected_reserve_start_eur=EXCLUDED.protected_reserve_start_eur,
    emergency_only_start_eur=EXCLUDED.emergency_only_start_eur,
    enabled=true,
    updated_at=now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.set_account_ai_budget(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_activity_ai_budget(uuid,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_account_ai_budget(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_activity_ai_budget(uuid,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.account_ai_budget_snapshot(p_profile_id uuid)
RETURNS TABLE (
  hard_cap_eur numeric,
  accounted_eur numeric,
  remaining_eur numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_cap numeric;
  v_start timestamptz:=date_trunc('month',now());
  v_end timestamptz:=date_trunc('month',now())+interval '1 month';
  v_accounted numeric:=0;
BEGIN
  SELECT owner_user_id INTO v_user_id FROM public.profiles WHERE id=p_profile_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'PROFILE_NOT_FOUND'; END IF;
  SELECT p.hard_cap_eur INTO v_cap FROM public.account_ai_budget_policies p
  WHERE p.user_id=v_user_id AND p.enabled=true;
  IF v_cap IS NULL THEN
    INSERT INTO public.account_ai_budget_policies(user_id) VALUES (v_user_id)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT p.hard_cap_eur INTO v_cap FROM public.account_ai_budget_policies p WHERE p.user_id=v_user_id;
  END IF;
  SELECT COALESCE(sum(greatest(a.reserved_usd,coalesce(a.actual_usd,0))*a.fx_usd_to_eur_rate),0)
  INTO v_accounted
  FROM public.provider_cost_attempts a
  JOIN public.profiles p ON p.id=a.profile_id
  WHERE p.owner_user_id=v_user_id AND a.period_start=v_start AND a.period_end=v_end;
  RETURN QUERY SELECT v_cap,v_accounted,greatest(v_cap-v_accounted,0);
END;
$$;

REVOKE ALL ON FUNCTION public.account_ai_budget_snapshot(uuid) FROM PUBLIC,authenticated;

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
  v_period_start timestamptz:=date_trunc('month',now());
  v_period_end timestamptz:=date_trunc('month',now())+interval '1 month';
  v_activity_usd numeric:=0;
  v_activity_eur numeric:=0;
  v_account_eur numeric:=0;
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

  SELECT * INTO v_existing FROM public.provider_cost_attempts
  WHERE logical_usage_event_id=p_logical_usage_event_id;
  IF FOUND THEN
    SELECT coalesce(sum(greatest(reserved_usd,coalesce(actual_usd,0))),0)
    INTO v_activity_usd FROM public.provider_cost_attempts
    WHERE profile_id=v_existing.profile_id AND period_start=v_existing.period_start AND period_end=v_existing.period_end;
    RETURN QUERY SELECT true,true,true,v_existing.id,NULL::numeric,v_activity_usd,NULL::numeric,v_existing.reserved_usd;
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

  -- Stable lock order: account first, activity second.
  PERFORM pg_advisory_xact_lock(hashtextextended('account-ai-budget:'||v_owner_user_id::text||':'||v_period_start::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('activity-ai-budget:'||v_logical.profile_id::text||':'||v_period_start::text,0));

  SELECT coalesce(sum(greatest(a.reserved_usd,coalesce(a.actual_usd,0))),0),
         coalesce(sum(greatest(a.reserved_usd,coalesce(a.actual_usd,0))*a.fx_usd_to_eur_rate),0)
  INTO v_activity_usd,v_activity_eur
  FROM public.provider_cost_attempts a
  WHERE a.profile_id=v_logical.profile_id AND a.period_start=v_period_start AND a.period_end=v_period_end;

  SELECT coalesce(sum(greatest(a.reserved_usd,coalesce(a.actual_usd,0))*a.fx_usd_to_eur_rate),0)
  INTO v_account_eur
  FROM public.provider_cost_attempts a
  JOIN public.profiles p ON p.id=a.profile_id
  WHERE p.owner_user_id=v_owner_user_id AND a.period_start=v_period_start AND a.period_end=v_period_end;

  v_effective_cap_usd:=least(
    v_package_cap,
    v_activity.hard_cap_eur/v_activity.usd_to_eur_rate,
    v_account.hard_cap_eur/v_activity.usd_to_eur_rate
  );
  v_remaining_usd:=greatest(least(
    v_package_cap-v_activity_usd,
    (v_activity.hard_cap_eur-v_activity_eur)/v_activity.usd_to_eur_rate,
    (v_account.hard_cap_eur-v_account_eur)/v_activity.usd_to_eur_rate
  ),0);

  IF v_activity_usd+v_reserve>v_package_cap
     OR v_activity_eur+(v_reserve*v_activity.usd_to_eur_rate)>v_activity.hard_cap_eur
     OR v_account_eur+(v_reserve*v_activity.usd_to_eur_rate)>v_account.hard_cap_eur THEN
    RETURN QUERY SELECT false,true,false,NULL::uuid,v_effective_cap_usd,v_activity_usd,v_remaining_usd,v_reserve;
    RETURN;
  END IF;

  INSERT INTO public.provider_cost_attempts(
    logical_usage_event_id,profile_id,capability_key,package_assignment_id,reserved_usd,
    period_start,period_end,fx_usd_to_eur_rate
  ) VALUES (
    p_logical_usage_event_id,v_logical.profile_id,v_logical.capability_key,v_assignment.id,v_reserve,
    v_period_start,v_period_end,v_activity.usd_to_eur_rate
  ) RETURNING id INTO v_attempt_id;

  RETURN QUERY SELECT true,true,false,v_attempt_id,v_effective_cap_usd,
    v_activity_usd+v_reserve,greatest(v_remaining_usd-v_reserve,0),v_reserve;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_provider_cost_attempt(uuid) FROM PUBLIC,authenticated;

COMMIT;
