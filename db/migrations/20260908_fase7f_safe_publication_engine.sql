-- FASE 7F — durable claim/finalize protocol for remote social publication.
-- A remote request is marked before the first externally-visible write. If its
-- lease expires with no response, the job becomes review-required and is never
-- retried blindly, preventing duplicate remote posts.

BEGIN;

ALTER TABLE public.publication_jobs ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NULL;
ALTER TABLE public.publication_jobs ADD COLUMN IF NOT EXISTS claim_token uuid NULL;
ALTER TABLE public.publication_jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL;
ALTER TABLE public.publication_jobs ADD COLUMN IF NOT EXISTS failure_code text NULL;
ALTER TABLE public.publication_jobs ADD COLUMN IF NOT EXISTS outcome_unknown boolean NOT NULL DEFAULT false;
ALTER TABLE public.publication_jobs ADD COLUMN IF NOT EXISTS remote_post_id text NULL;
ALTER TABLE public.publication_jobs ADD COLUMN IF NOT EXISTS published_at timestamptz NULL;
ALTER TABLE public.publication_jobs ADD COLUMN IF NOT EXISTS usage_event_id uuid NULL REFERENCES public.capability_usage_events(id) ON DELETE SET NULL;

ALTER TABLE public.publication_attempts ADD COLUMN IF NOT EXISTS claim_token uuid NULL;
ALTER TABLE public.publication_attempts ADD COLUMN IF NOT EXISTS request_started_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS publication_jobs_due_idx
  ON public.publication_jobs (coalesce(next_attempt_at, scheduled_at), scheduled_at, id)
  WHERE state = 'SCHEDULED';

CREATE OR REPLACE FUNCTION public.claim_due_publication_jobs(p_limit integer DEFAULT 20, p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(
  job_id uuid, profile_id uuid, variant_id uuid, provider text, scheduled_at timestamptz,
  attempt_no integer, claim_token uuid, lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 50 OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'PUBLICATION_CLAIM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- A stale worker that crossed the remote-write boundary has an ambiguous
  -- outcome. Never retry it automatically because the provider may have posted.
  UPDATE public.publication_attempts attempt
  SET state='OUTCOME_UNKNOWN', error_code='PROVIDER_OUTCOME_UNKNOWN',
      error_message='Esito provider da verificare', finished_at=clock_timestamp()
  FROM public.publication_jobs job
  WHERE attempt.job_id=job.id AND attempt.attempt_no=job.attempt_count
    AND attempt.state='REQUEST_SENT' AND job.state='PROCESSING'
    AND job.lease_expires_at < clock_timestamp();

  UPDATE public.publication_jobs job
  SET state='FAILED', failure_code='PROVIDER_OUTCOME_UNKNOWN', outcome_unknown=true,
      last_error='Esito della pubblicazione da verificare', claim_token=null,
      lease_expires_at=null, next_attempt_at=null, updated_at=clock_timestamp()
  WHERE job.state='PROCESSING' AND job.lease_expires_at < clock_timestamp()
    AND EXISTS (
      SELECT 1 FROM public.publication_attempts attempt
      WHERE attempt.job_id=job.id AND attempt.attempt_no=job.attempt_count
        AND attempt.state='OUTCOME_UNKNOWN'
    );

  PERFORM public.commit_capability_usage(job.usage_event_id)
  FROM public.publication_jobs job
  WHERE job.state='FAILED' AND job.failure_code='PROVIDER_OUTCOME_UNKNOWN'
    AND job.outcome_unknown IS TRUE AND job.usage_event_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.capability_usage_events event WHERE event.id=job.usage_event_id AND event.state='RESERVED');

  -- A lease that expired before the remote-write boundary is safe to reclaim.
  UPDATE public.publication_attempts attempt
  SET state='FAILED_SAFE', error_code='WORKER_LEASE_EXPIRED',
      error_message='Worker interrotto prima della richiesta provider', finished_at=clock_timestamp()
  FROM public.publication_jobs job
  WHERE attempt.job_id=job.id AND attempt.attempt_no=job.attempt_count
    AND attempt.state='CLAIMED' AND job.state='PROCESSING'
    AND job.lease_expires_at < clock_timestamp();

  PERFORM public.release_capability_usage(job.usage_event_id)
  FROM public.publication_jobs job
  WHERE job.state='PROCESSING' AND job.lease_expires_at < clock_timestamp()
    AND job.attempt_count>=3 AND job.usage_event_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.capability_usage_events event WHERE event.id=job.usage_event_id AND event.state='RESERVED')
    AND NOT EXISTS (SELECT 1 FROM public.publication_attempts attempt WHERE attempt.job_id=job.id AND attempt.attempt_no=job.attempt_count AND attempt.state='OUTCOME_UNKNOWN');

  UPDATE public.publication_jobs job
  SET state=CASE
        WHEN job.attempt_count>=3 THEN 'FAILED'
        WHEN EXISTS (
          SELECT 1 FROM public.content_variants variant
          WHERE variant.id=job.variant_id AND variant.profile_id=job.profile_id
            AND variant.provider=job.provider AND variant.approval_status='APPROVED' AND variant.eligible IS TRUE
        ) THEN 'SCHEDULED'
        ELSE 'BLOCKED_APPROVAL'
      END,
      claim_token=null, lease_expires_at=null,
      next_attempt_at=CASE WHEN job.attempt_count<3 AND EXISTS (
        SELECT 1 FROM public.content_variants variant
        WHERE variant.id=job.variant_id AND variant.profile_id=job.profile_id
          AND variant.provider=job.provider AND variant.approval_status='APPROVED' AND variant.eligible IS TRUE
      ) THEN clock_timestamp() ELSE NULL END,
      failure_code=CASE WHEN EXISTS (
        SELECT 1 FROM public.content_variants variant
        WHERE variant.id=job.variant_id AND variant.profile_id=job.profile_id
          AND variant.provider=job.provider AND variant.approval_status='APPROVED' AND variant.eligible IS TRUE
      ) THEN 'WORKER_LEASE_EXPIRED' ELSE 'CONTENT_NOT_APPROVED' END,
      last_error=CASE
        WHEN job.attempt_count>=3 THEN 'Pubblicazione non riuscita dopo tre tentativi sicuri'
        WHEN EXISTS (
          SELECT 1 FROM public.content_variants variant
          WHERE variant.id=job.variant_id AND variant.profile_id=job.profile_id
            AND variant.provider=job.provider AND variant.approval_status='APPROVED' AND variant.eligible IS TRUE
        ) THEN 'Pubblicazione riprogrammata in sicurezza'
        ELSE 'Il contenuto deve essere approvato prima della pubblicazione'
      END,
      updated_at=clock_timestamp()
  WHERE job.state='PROCESSING' AND job.lease_expires_at < clock_timestamp()
    AND NOT EXISTS (
      SELECT 1 FROM public.publication_attempts attempt
      WHERE attempt.job_id=job.id AND attempt.attempt_no=job.attempt_count
        AND attempt.state='OUTCOME_UNKNOWN'
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.publication_jobs job
    WHERE job.state='SCHEDULED'
      AND job.attempt_count < 3
      AND job.scheduled_at <= clock_timestamp()
      AND coalesce(job.next_attempt_at, job.scheduled_at) <= clock_timestamp()
    ORDER BY coalesce(job.next_attempt_at, job.scheduled_at), job.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.publication_jobs job
    SET state='PROCESSING', attempt_count=job.attempt_count+1,
        claim_token=gen_random_uuid(), locked_at=clock_timestamp(),
        lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
        next_attempt_at=null, failure_code=null, outcome_unknown=false,
        last_error=null, updated_at=clock_timestamp()
    FROM candidates
    WHERE job.id=candidates.id
    RETURNING job.id, job.profile_id, job.variant_id, job.provider,
      job.scheduled_at, job.attempt_count, job.claim_token, job.lease_expires_at
  ), attempts AS (
    INSERT INTO public.publication_attempts(
      job_id,profile_id,provider,attempt_no,state,claim_token,response_metadata,started_at
    )
    SELECT claimed.id,claimed.profile_id,claimed.provider,claimed.attempt_count,
      'CLAIMED',claimed.claim_token,'{}'::jsonb,clock_timestamp()
    FROM claimed
    RETURNING publication_attempts.job_id
  )
  SELECT claimed.id,claimed.profile_id,claimed.variant_id,claimed.provider,
    claimed.scheduled_at,claimed.attempt_count,claimed.claim_token,claimed.lease_expires_at
  FROM claimed JOIN attempts ON attempts.job_id=claimed.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_publication_usage_event(p_job_id uuid, p_claim_token uuid, p_usage_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.publication_jobs job
  SET usage_event_id=p_usage_event_id, updated_at=clock_timestamp()
  WHERE job.id=p_job_id AND job.state='PROCESSING' AND job.claim_token=p_claim_token
    AND (job.usage_event_id IS NULL OR job.usage_event_id=p_usage_event_id)
    AND EXISTS (
      SELECT 1 FROM public.capability_usage_events event
      WHERE event.id=p_usage_event_id AND event.profile_id=job.profile_id
        AND event.capability_key='social.'||lower(job.provider)||'.publish'
        AND event.idempotency_key='publication:v1:'||job.id::text
        AND event.state='RESERVED'
    );
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_publication_request_started(p_job_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_attempt integer;
BEGIN
  SELECT attempt_count INTO v_attempt FROM public.publication_jobs
  WHERE id=p_job_id AND state='PROCESSING' AND claim_token=p_claim_token
    AND lease_expires_at >= clock_timestamp()
    AND EXISTS (
      SELECT 1 FROM public.content_variants variant
      WHERE variant.id=publication_jobs.variant_id
        AND variant.profile_id=publication_jobs.profile_id
        AND variant.provider=publication_jobs.provider
        AND variant.approval_status='APPROVED' AND variant.eligible IS TRUE
    )
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.publication_attempts
  SET state='REQUEST_SENT', request_started_at=clock_timestamp()
  WHERE job_id=p_job_id AND attempt_no=v_attempt AND claim_token=p_claim_token AND state='CLAIMED';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_publication_job(
  p_job_id uuid, p_claim_token uuid, p_remote_post_id text,
  p_response_metadata jsonb DEFAULT '{}'::jsonb, p_usage_event_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_job public.publication_jobs%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
  IF p_remote_post_id IS NULL OR btrim(p_remote_post_id)='' OR length(p_remote_post_id)>1000 THEN
    RAISE EXCEPTION 'REMOTE_POST_ID_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_usage_event_id IS NULL THEN
    RAISE EXCEPTION 'PUBLICATION_METERING_REQUIRED' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_job FROM public.publication_jobs
  WHERE id=p_job_id AND state='PROCESSING' AND claim_token=p_claim_token
    AND usage_event_id=p_usage_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.publication_attempts
  SET state='SUCCESS', provider_request_id=p_remote_post_id,
      response_metadata=coalesce(p_response_metadata,'{}'::jsonb), finished_at=v_now
  WHERE job_id=v_job.id AND attempt_no=v_job.attempt_count AND claim_token=p_claim_token
    AND state='REQUEST_SENT';
  IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_REQUEST_BOUNDARY_REQUIRED'; END IF;
  UPDATE public.content_variants
  SET external_post_id=p_remote_post_id, published_at=v_now, updated_at=v_now
  WHERE id=v_job.variant_id AND profile_id=v_job.profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_VARIANT_INTEGRITY_FAILED'; END IF;
  UPDATE public.publication_jobs
  SET state='PUBLISHED', remote_post_id=p_remote_post_id, published_at=v_now,
      claim_token=null, lease_expires_at=null, locked_at=null, next_attempt_at=null,
      failure_code=null, outcome_unknown=false, last_error=null, updated_at=v_now
  WHERE id=v_job.id;
  IF p_usage_event_id IS NOT NULL THEN
    UPDATE public.capability_usage_events
    SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'execution_state','REMOTE_POST_PERSISTED','job_id',v_job.id,'remote_post_id',p_remote_post_id
    ) WHERE id=p_usage_event_id AND profile_id=v_job.profile_id AND state='RESERVED';
    IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_METERING_INVALID'; END IF;
    PERFORM public.commit_capability_usage(p_usage_event_id);
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_publication_job(
  p_job_id uuid, p_claim_token uuid, p_error_code text, p_customer_message text,
  p_retryable boolean, p_outcome_unknown boolean, p_retry_after_seconds integer,
  p_usage_event_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_job public.publication_jobs%ROWTYPE; v_now timestamptz:=clock_timestamp(); v_retry boolean; v_approved boolean;
BEGIN
  IF p_error_code IS NULL OR p_error_code !~ '^[A-Z0-9_]{3,80}$'
     OR p_customer_message IS NULL OR length(p_customer_message)>300
     OR p_retry_after_seconds<0 OR p_retry_after_seconds>86400 THEN
    RAISE EXCEPTION 'PUBLICATION_FAILURE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_job FROM public.publication_jobs
  WHERE id=p_job_id AND state='PROCESSING' AND claim_token=p_claim_token
    AND (p_usage_event_id IS NULL OR usage_event_id=p_usage_event_id) FOR UPDATE;
  IF NOT FOUND THEN RETURN 'STALE_CLAIM'; END IF;
  SELECT variant.approval_status='APPROVED' AND variant.eligible IS TRUE INTO v_approved
  FROM public.content_variants variant
  WHERE variant.id=v_job.variant_id AND variant.profile_id=v_job.profile_id AND variant.provider=v_job.provider;
  v_approved := coalesce(v_approved,false);
  v_retry := p_retryable AND NOT p_outcome_unknown AND v_job.attempt_count<3 AND v_approved;

  UPDATE public.publication_attempts
  SET state=CASE WHEN p_outcome_unknown THEN 'OUTCOME_UNKNOWN' WHEN v_retry THEN 'FAILED_RETRYABLE' ELSE 'FAILED_TERMINAL' END,
      error_code=p_error_code, error_message=p_customer_message, finished_at=v_now
  WHERE job_id=v_job.id AND attempt_no=v_job.attempt_count AND claim_token=p_claim_token;
  UPDATE public.publication_jobs
  SET state=CASE WHEN NOT v_approved THEN 'BLOCKED_APPROVAL' WHEN v_retry THEN 'SCHEDULED' ELSE 'FAILED' END,
      next_attempt_at=CASE WHEN v_retry THEN v_now+make_interval(secs=>p_retry_after_seconds) ELSE NULL END,
      failure_code=p_error_code, outcome_unknown=p_outcome_unknown,
      last_error=p_customer_message, claim_token=null, lease_expires_at=null,
      locked_at=null, updated_at=v_now
  WHERE id=v_job.id;

  IF p_usage_event_id IS NOT NULL AND NOT v_retry THEN
    IF p_outcome_unknown THEN
      UPDATE public.capability_usage_events SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'execution_state','REMOTE_OUTCOME_UNKNOWN','job_id',v_job.id,'failure_code',p_error_code
      ) WHERE id=p_usage_event_id AND profile_id=v_job.profile_id AND state='RESERVED';
      IF FOUND THEN PERFORM public.commit_capability_usage(p_usage_event_id); END IF;
    ELSE
      PERFORM public.release_capability_usage(p_usage_event_id);
    END IF;
  END IF;
  RETURN CASE WHEN NOT v_approved THEN 'BLOCKED_APPROVAL' WHEN v_retry THEN 'RETRY_SCHEDULED' WHEN p_outcome_unknown THEN 'OUTCOME_UNKNOWN' ELSE 'FAILED' END;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_publication_jobs(integer,integer) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.attach_publication_usage_event(uuid,uuid,uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.mark_publication_request_started(uuid,uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.complete_publication_job(uuid,uuid,text,jsonb,uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.fail_publication_job(uuid,uuid,text,text,boolean,boolean,integer,uuid) FROM PUBLIC, authenticated;

COMMIT;
