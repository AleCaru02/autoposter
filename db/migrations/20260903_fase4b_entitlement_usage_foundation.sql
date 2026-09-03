-- FASE 4B — entitlement + usage foundation.
-- Non-destructive and idempotent. Billing-provider independent.
-- Runtime gating is intentionally deferred to FASE 4C.

CREATE TABLE IF NOT EXISTS public.profile_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  limit_type text NOT NULL,
  limit_value numeric NULL,
  period_type text NOT NULL DEFAULT 'NONE',
  source text NOT NULL DEFAULT 'INTERNAL_BASELINE',
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_entitlements_limit_type_check CHECK (limit_type IN (
    'BOOLEAN','COUNT_PER_DAY','COUNT_PER_MONTH','CONCURRENT','MAX_CONNECTED_ACCOUNTS','STORAGE','SEATS','UNLIMITED','NOT_APPLICABLE'
  )),
  CONSTRAINT profile_entitlements_period_type_check CHECK (period_type IN ('NONE','DAY','MONTH','CUSTOM')),
  CONSTRAINT profile_entitlements_limit_value_check CHECK (limit_value IS NULL OR limit_value >= 0),
  CONSTRAINT profile_entitlements_window_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  UNIQUE (profile_id, capability_key)
);

CREATE INDEX IF NOT EXISTS profile_entitlements_profile_idx
  ON public.profile_entitlements (profile_id, capability_key);

CREATE TABLE IF NOT EXISTS public.capability_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  quantity numeric NOT NULL,
  state text NOT NULL DEFAULT 'RESERVED',
  idempotency_key text NOT NULL,
  source text NOT NULL DEFAULT 'APPLICATION',
  reference_id text NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz NULL,
  released_at timestamptz NULL,
  CONSTRAINT capability_usage_events_quantity_check CHECK (quantity > 0),
  CONSTRAINT capability_usage_events_state_check CHECK (state IN ('RESERVED','COMMITTED','RELEASED')),
  CONSTRAINT capability_usage_events_period_check CHECK (period_end > period_start),
  UNIQUE (profile_id, capability_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS capability_usage_events_profile_period_idx
  ON public.capability_usage_events (profile_id, capability_key, period_start, period_end, created_at DESC);

CREATE TABLE IF NOT EXISTS public.capability_usage_buckets (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  reserved_quantity numeric NOT NULL DEFAULT 0,
  committed_quantity numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_usage_buckets_nonnegative_check CHECK (reserved_quantity >= 0 AND committed_quantity >= 0),
  CONSTRAINT capability_usage_buckets_period_check CHECK (period_end > period_start),
  PRIMARY KEY (profile_id, capability_key, period_start, period_end)
);

ALTER TABLE public.profile_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_entitlements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_buckets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_entitlements_customer_read ON public.profile_entitlements;
CREATE POLICY profile_entitlements_customer_read ON public.profile_entitlements
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));

DROP POLICY IF EXISTS capability_usage_events_customer_read ON public.capability_usage_events;
CREATE POLICY capability_usage_events_customer_read ON public.capability_usage_events
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));

DROP POLICY IF EXISTS capability_usage_buckets_customer_read ON public.capability_usage_buckets;
CREATE POLICY capability_usage_buckets_customer_read ON public.capability_usage_buckets
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));

-- No INSERT/UPDATE/DELETE policies are granted to authenticated customers.
-- Entitlement writes and usage consumption are server-side/internal only.

CREATE OR REPLACE FUNCTION public.reserve_capability_usage(
  p_profile_id uuid,
  p_capability_key text,
  p_quantity numeric,
  p_limit_value numeric,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_idempotency_key text,
  p_source text DEFAULT 'APPLICATION',
  p_reference_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  allowed boolean,
  duplicate boolean,
  event_id uuid,
  committed numeric,
  reserved numeric,
  remaining numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.capability_usage_events%ROWTYPE;
  v_bucket public.capability_usage_buckets%ROWTYPE;
  v_event_id uuid;
  v_remaining numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'USAGE_QUANTITY_INVALID';
  END IF;
  IF p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'USAGE_PERIOD_INVALID';
  END IF;
  IF p_limit_value IS NOT NULL AND p_limit_value < 0 THEN
    RAISE EXCEPTION 'USAGE_LIMIT_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  -- Serialize a profile/capability/period bucket to prevent check-then-consume races.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_profile_id::text || ':' || p_capability_key || ':' || p_period_start::text || ':' || p_period_end::text,
    0
  ));

  SELECT * INTO v_existing
  FROM public.capability_usage_events
  WHERE profile_id = p_profile_id
    AND capability_key = p_capability_key
    AND idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    SELECT * INTO v_bucket
    FROM public.capability_usage_buckets
    WHERE profile_id = p_profile_id
      AND capability_key = p_capability_key
      AND period_start = p_period_start
      AND period_end = p_period_end;

    v_remaining := CASE WHEN p_limit_value IS NULL THEN NULL
      ELSE GREATEST(p_limit_value - COALESCE(v_bucket.committed_quantity, 0) - COALESCE(v_bucket.reserved_quantity, 0), 0)
    END;
    RETURN QUERY SELECT true, true, v_existing.id,
      COALESCE(v_bucket.committed_quantity, 0), COALESCE(v_bucket.reserved_quantity, 0), v_remaining;
    RETURN;
  END IF;

  INSERT INTO public.capability_usage_buckets(profile_id, capability_key, period_start, period_end)
  VALUES (p_profile_id, p_capability_key, p_period_start, p_period_end)
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_bucket
  FROM public.capability_usage_buckets
  WHERE profile_id = p_profile_id
    AND capability_key = p_capability_key
    AND period_start = p_period_start
    AND period_end = p_period_end
  FOR UPDATE;

  IF p_limit_value IS NOT NULL
     AND v_bucket.committed_quantity + v_bucket.reserved_quantity + p_quantity > p_limit_value THEN
    v_remaining := GREATEST(p_limit_value - v_bucket.committed_quantity - v_bucket.reserved_quantity, 0);
    RETURN QUERY SELECT false, false, NULL::uuid,
      v_bucket.committed_quantity, v_bucket.reserved_quantity, v_remaining;
    RETURN;
  END IF;

  INSERT INTO public.capability_usage_events(
    profile_id, capability_key, quantity, state, idempotency_key, source, reference_id,
    period_start, period_end, metadata
  ) VALUES (
    p_profile_id, p_capability_key, p_quantity, 'RESERVED', p_idempotency_key,
    COALESCE(NULLIF(p_source, ''), 'APPLICATION'), p_reference_id,
    p_period_start, p_period_end, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_event_id;

  UPDATE public.capability_usage_buckets
  SET reserved_quantity = reserved_quantity + p_quantity,
      updated_at = now()
  WHERE profile_id = p_profile_id
    AND capability_key = p_capability_key
    AND period_start = p_period_start
    AND period_end = p_period_end
  RETURNING * INTO v_bucket;

  v_remaining := CASE WHEN p_limit_value IS NULL THEN NULL
    ELSE GREATEST(p_limit_value - v_bucket.committed_quantity - v_bucket.reserved_quantity, 0)
  END;
  RETURN QUERY SELECT true, false, v_event_id,
    v_bucket.committed_quantity, v_bucket.reserved_quantity, v_remaining;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_capability_usage(p_event_id uuid)
RETURNS public.capability_usage_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.capability_usage_events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.capability_usage_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USAGE_EVENT_NOT_FOUND'; END IF;
  IF v_event.state = 'COMMITTED' THEN RETURN v_event; END IF;
  IF v_event.state = 'RELEASED' THEN RAISE EXCEPTION 'USAGE_EVENT_ALREADY_RELEASED'; END IF;

  UPDATE public.capability_usage_buckets
  SET reserved_quantity = GREATEST(reserved_quantity - v_event.quantity, 0),
      committed_quantity = committed_quantity + v_event.quantity,
      updated_at = now()
  WHERE profile_id = v_event.profile_id
    AND capability_key = v_event.capability_key
    AND period_start = v_event.period_start
    AND period_end = v_event.period_end;

  UPDATE public.capability_usage_events
  SET state='COMMITTED', committed_at=now()
  WHERE id = p_event_id
  RETURNING * INTO v_event;
  RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_capability_usage(p_event_id uuid)
RETURNS public.capability_usage_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.capability_usage_events%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.capability_usage_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'USAGE_EVENT_NOT_FOUND'; END IF;
  IF v_event.state = 'RELEASED' THEN RETURN v_event; END IF;
  IF v_event.state = 'COMMITTED' THEN RAISE EXCEPTION 'USAGE_EVENT_ALREADY_COMMITTED'; END IF;

  UPDATE public.capability_usage_buckets
  SET reserved_quantity = GREATEST(reserved_quantity - v_event.quantity, 0),
      updated_at = now()
  WHERE profile_id = v_event.profile_id
    AND capability_key = v_event.capability_key
    AND period_start = v_event.period_start
    AND period_end = v_event.period_end;

  UPDATE public.capability_usage_events
  SET state='RELEASED', released_at=now()
  WHERE id = p_event_id
  RETURNING * INTO v_event;
  RETURN v_event;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_capability_usage(uuid,text,numeric,numeric,timestamptz,timestamptz,text,text,text,jsonb) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.commit_capability_usage(uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.release_capability_usage(uuid) FROM PUBLIC, authenticated;

-- Internal baseline keeps existing production behavior intact during FASE 4B.
-- Existing product-specific limits (AI text budget/image cap) remain authoritative until FASE 4C migration.
CREATE OR REPLACE FUNCTION public.bootstrap_profile_entitlements(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
BEGIN
  FOREACH v_key IN ARRAY ARRAY[
    'workspace.profile.manage',
    'website.scan','website.pages.persist','brand.analyze',
    'ai.content.generate_text','ai.research.web','ai.research.factcheck','ai.strategy.generate','ai.image.generate','media.image.persist',
    'content.approval.auto','autopilot.manage','autopilot.hourly','schedule.job.create',
    'social.facebook.connect','social.instagram.connect','social.linkedin.connect','social.gbp.connect',
    'social.facebook.publish','social.instagram.publish','social.linkedin.publish','social.gbp.publish','social.publish.scheduled'
  ] LOOP
    INSERT INTO public.profile_entitlements(profile_id, capability_key, enabled, limit_type, limit_value, period_type, source)
    VALUES (p_profile_id, v_key, true, 'UNLIMITED', NULL, 'NONE', 'INTERNAL_BASELINE')
    ON CONFLICT (profile_id, capability_key) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.bootstrap_profile_entitlements(uuid) FROM PUBLIC, authenticated;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles LOOP
    PERFORM public.bootstrap_profile_entitlements(r.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.bootstrap_profile_entitlements_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.bootstrap_profile_entitlements(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profile_entitlements_bootstrap_trigger ON public.profiles;
CREATE TRIGGER profile_entitlements_bootstrap_trigger
AFTER INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.bootstrap_profile_entitlements_after_insert();
