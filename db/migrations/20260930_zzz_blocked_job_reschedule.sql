BEGIN;

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
SET search_path=public,pg_temp
AS $calendar_manage$
DECLARE
  v_job public.publication_jobs%ROWTYPE;
  v_now timestamptz:=clock_timestamp();
  v_ready boolean;
BEGIN
  IF p_action NOT IN ('RESCHEDULE','REMOVE') THEN
    RAISE EXCEPTION 'CALENDAR_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN neon_auth.user auth_user
      ON auth_user.id::text=p_actor_auth_user_id
     AND coalesce(auth_user.banned,false) IS FALSE
    WHERE profile.id=p_profile_id
      AND profile.owner_auth_user_id=p_actor_auth_user_id
      AND profile.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CALENDAR_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_job
  FROM public.publication_jobs job
  WHERE job.id=p_job_id
    AND job.profile_id=p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CALENDAR_JOB_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
  IF v_job.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CALENDAR_JOB_STALE' USING ERRCODE='40001';
  END IF;
  IF v_job.state NOT IN ('SCHEDULED','BLOCKED_APPROVAL') THEN
    RAISE EXCEPTION 'CALENDAR_JOB_IMMUTABLE' USING ERRCODE='22023';
  END IF;

  IF p_action='REMOVE' THEN
    DELETE FROM public.publication_jobs WHERE id=v_job.id;
    RETURN QUERY SELECT v_job.id,v_job.state,v_job.scheduled_at,v_job.updated_at,true;
    RETURN;
  END IF;

  IF p_scheduled_at IS NULL OR p_scheduled_at<=v_now+interval '1 minute' THEN
    RAISE EXCEPTION 'CALENDAR_JOB_NOT_RESCHEDULABLE' USING ERRCODE='22023';
  END IF;

  v_ready:=public.is_variant_publish_ready(v_job.variant_id,v_job.profile_id,v_job.provider);

  UPDATE public.publication_jobs
  SET scheduled_at=p_scheduled_at,
      state=CASE WHEN v_ready THEN 'SCHEDULED' ELSE 'BLOCKED_APPROVAL' END,
      next_attempt_at=NULL,
      failure_code=CASE WHEN v_ready THEN NULL ELSE failure_code END,
      outcome_unknown=false,
      last_error=CASE WHEN v_ready THEN NULL ELSE last_error END,
      updated_at=v_now
  WHERE id=v_job.id
  RETURNING * INTO v_job;

  RETURN QUERY SELECT v_job.id,v_job.state,v_job.scheduled_at,v_job.updated_at,false;
END;
$calendar_manage$;

REVOKE ALL ON FUNCTION public.manage_profile_calendar_job(text,uuid,uuid,timestamptz,text,timestamptz)
FROM PUBLIC,authenticated;

COMMIT;
