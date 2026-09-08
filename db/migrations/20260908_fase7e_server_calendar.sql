-- FASE 7E — server-owned calendar mutations.
-- Customer sessions keep profile-scoped reads, while schedule and publication
-- mutations are authorized and serialized by SECURITY DEFINER functions.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_customer_calendar_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'CALENDAR_WRITE_SERVER_ONLY' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS schedules_customer_write_guard ON public.schedules;
CREATE TRIGGER schedules_customer_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.schedules
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_calendar_write();

DROP TRIGGER IF EXISTS publication_jobs_customer_write_guard ON public.publication_jobs;
CREATE TRIGGER publication_jobs_customer_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.publication_jobs
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_calendar_write();

CREATE OR REPLACE FUNCTION public.save_profile_schedule(
  p_actor_auth_user_id text,
  p_profile_id uuid,
  p_provider text,
  p_timezone text,
  p_posts_per_week integer,
  p_preferred_slots jsonb,
  p_auto_choose boolean,
  p_enabled boolean
)
RETURNS TABLE(schedule_id uuid, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_schedule public.schedules%ROWTYPE;
BEGIN
  IF p_provider NOT IN ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'GBP')
     OR p_posts_per_week < 0 OR p_posts_per_week > 21
     OR jsonb_typeof(coalesce(p_preferred_slots, '[]'::jsonb)) <> 'array'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'CALENDAR_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN neon_auth.user auth_user
      ON auth_user.id::text = p_actor_auth_user_id
     AND coalesce(auth_user.banned, false) IS FALSE
    WHERE profile.id = p_profile_id
      AND profile.owner_auth_user_id = p_actor_auth_user_id
      AND profile.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CALENDAR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.schedules(profile_id, provider, timezone, posts_per_week, preferred_slots, auto_choose, enabled, updated_at)
  VALUES (p_profile_id, p_provider, p_timezone, p_posts_per_week, p_preferred_slots, p_auto_choose, p_enabled, clock_timestamp())
  ON CONFLICT (profile_id, provider) WHERE provider IS NOT NULL
  DO UPDATE SET timezone = EXCLUDED.timezone,
                posts_per_week = EXCLUDED.posts_per_week,
                preferred_slots = EXCLUDED.preferred_slots,
                auto_choose = EXCLUDED.auto_choose,
                enabled = EXCLUDED.enabled,
                updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_schedule;

  RETURN QUERY SELECT v_schedule.id, v_schedule.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_profile_calendar_job(
  p_actor_auth_user_id text,
  p_profile_id uuid,
  p_variant_id uuid,
  p_scheduled_at timestamptz,
  p_operation_id text,
  p_usage_event_id uuid
)
RETURNS TABLE(job_id uuid, job_state text, scheduled_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event public.capability_usage_events%ROWTYPE;
  v_variant public.content_variants%ROWTYPE;
  v_job public.publication_jobs%ROWTYPE;
  v_key text := 'calendar-create:v1:' || p_profile_id::text || ':' || p_operation_id;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_operation_id IS NULL OR p_operation_id !~ '^[A-Za-z0-9_-]{16,80}$'
     OR p_scheduled_at <= v_now + interval '1 minute' THEN
    RAISE EXCEPTION 'CALENDAR_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN neon_auth.user auth_user
      ON auth_user.id::text = p_actor_auth_user_id
     AND coalesce(auth_user.banned, false) IS FALSE
    WHERE profile.id = p_profile_id
      AND profile.owner_auth_user_id = p_actor_auth_user_id
      AND profile.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CALENDAR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_event
  FROM public.capability_usage_events usage_event
  WHERE usage_event.id = p_usage_event_id
    AND usage_event.profile_id = p_profile_id
    AND usage_event.capability_key = 'schedule.job.create'
    AND usage_event.idempotency_key = v_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CALENDAR_METERING_INVALID' USING ERRCODE = '42501';
  END IF;

  IF v_event.state = 'COMMITTED' THEN
    SELECT * INTO v_job FROM public.publication_jobs job WHERE job.profile_id = p_profile_id AND job.idempotency_key = v_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'CALENDAR_INTEGRITY_FAILED'; END IF;
    RETURN QUERY SELECT v_job.id, v_job.state, v_job.scheduled_at, v_job.updated_at;
    RETURN;
  END IF;
  IF v_event.state <> 'RESERVED' THEN
    RAISE EXCEPTION 'CALENDAR_METERING_INVALID' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_variant
  FROM public.content_variants variant
  WHERE variant.id = p_variant_id
    AND variant.profile_id = p_profile_id
  FOR SHARE;
  IF NOT FOUND OR v_variant.eligible IS NOT TRUE OR v_variant.approval_status <> 'APPROVED' OR v_variant.provider IS NULL THEN
    RAISE EXCEPTION 'CALENDAR_VARIANT_NOT_READY' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.social_connections connection
    WHERE connection.profile_id = p_profile_id
      AND connection.provider = v_variant.provider
      AND connection.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'CALENDAR_SOCIAL_NOT_CONNECTED' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.publication_jobs job
    WHERE job.profile_id = p_profile_id
      AND job.variant_id = p_variant_id
      AND job.state IN ('SCHEDULED', 'BLOCKED_APPROVAL', 'QUEUED')
  ) THEN
    RAISE EXCEPTION 'CALENDAR_DUPLICATE_VARIANT' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.publication_jobs(
    id, profile_id, variant_id, provider, state, scheduled_at, idempotency_key, attempt_count, updated_at
  ) VALUES (
    gen_random_uuid(), p_profile_id, p_variant_id, v_variant.provider, 'SCHEDULED', p_scheduled_at, v_key, 0, v_now
  ) RETURNING * INTO v_job;

  UPDATE public.capability_usage_events
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'execution_state', 'OUTPUT_PERSISTED',
        'cached_result', jsonb_build_object('jobId', v_job.id, 'state', v_job.state, 'scheduledAt', v_job.scheduled_at, 'updatedAt', v_job.updated_at)
      )
  WHERE id = v_event.id;
  PERFORM public.commit_capability_usage(v_event.id);

  RETURN QUERY SELECT v_job.id, v_job.state, v_job.scheduled_at, v_job.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_profile_calendar_job(
  p_actor_auth_user_id text,
  p_profile_id uuid,
  p_job_id uuid,
  p_expected_updated_at timestamptz,
  p_action text,
  p_scheduled_at timestamptz DEFAULT NULL
)
RETURNS TABLE(job_id uuid, job_state text, scheduled_at timestamptz, updated_at timestamptz, removed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.publication_jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_action NOT IN ('RESCHEDULE', 'REMOVE') THEN
    RAISE EXCEPTION 'CALENDAR_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN neon_auth.user auth_user
      ON auth_user.id::text = p_actor_auth_user_id
     AND coalesce(auth_user.banned, false) IS FALSE
    WHERE profile.id = p_profile_id
      AND profile.owner_auth_user_id = p_actor_auth_user_id
      AND profile.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CALENDAR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM public.publication_jobs job
  WHERE job.id = p_job_id AND job.profile_id = p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CALENDAR_JOB_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_job.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CALENDAR_JOB_STALE' USING ERRCODE = '40001';
  END IF;
  IF v_job.state NOT IN ('SCHEDULED', 'BLOCKED_APPROVAL') THEN
    RAISE EXCEPTION 'CALENDAR_JOB_IMMUTABLE' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'REMOVE' THEN
    DELETE FROM public.publication_jobs WHERE id = v_job.id;
    RETURN QUERY SELECT v_job.id, v_job.state, v_job.scheduled_at, v_job.updated_at, true;
    RETURN;
  END IF;

  IF v_job.state <> 'SCHEDULED' OR p_scheduled_at IS NULL OR p_scheduled_at <= v_now + interval '1 minute' THEN
    RAISE EXCEPTION 'CALENDAR_JOB_NOT_RESCHEDULABLE' USING ERRCODE = '22023';
  END IF;
  UPDATE public.publication_jobs
  SET scheduled_at = p_scheduled_at, updated_at = v_now
  WHERE id = v_job.id
  RETURNING * INTO v_job;
  RETURN QUERY SELECT v_job.id, v_job.state, v_job.scheduled_at, v_job.updated_at, false;
END;
$$;

REVOKE ALL ON FUNCTION public.save_profile_schedule(text,uuid,text,text,integer,jsonb,boolean,boolean) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.create_profile_calendar_job(text,uuid,uuid,timestamptz,text,uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.manage_profile_calendar_job(text,uuid,uuid,timestamptz,text,timestamptz) FROM PUBLIC, authenticated;

COMMIT;
