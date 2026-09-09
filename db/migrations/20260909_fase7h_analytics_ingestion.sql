-- FASE 7H — tenant-safe, retryable and idempotent provider analytics ingestion.
-- Provider reads are claimed server-side; customers can only read their own
-- normalized snapshots through RLS and can never mutate collector state.

BEGIN;

ALTER TABLE public.metric_snapshots ADD COLUMN IF NOT EXISTS job_id uuid NULL REFERENCES public.publication_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.metric_snapshots ADD COLUMN IF NOT EXISTS content_id uuid NULL REFERENCES public.content_items(id) ON DELETE SET NULL;
ALTER TABLE public.metric_snapshots ADD COLUMN IF NOT EXISTS external_post_id text NULL;
ALTER TABLE public.metric_snapshots ADD COLUMN IF NOT EXISTS format text NULL;
ALTER TABLE public.metric_snapshots ADD COLUMN IF NOT EXISTS topic text NULL;
ALTER TABLE public.metric_snapshots ADD COLUMN IF NOT EXISTS published_at timestamptz NULL;
ALTER TABLE public.metric_snapshots ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

UPDATE public.metric_snapshots snapshot
SET content_id=coalesce(snapshot.content_id,variant.content_id),
    external_post_id=coalesce(snapshot.external_post_id,variant.external_post_id),
    format=coalesce(snapshot.format,variant.format),
    topic=coalesce(snapshot.topic,item.topic),
    published_at=coalesce(snapshot.published_at,variant.published_at)
FROM public.content_variants variant
JOIN public.content_items item ON item.id=variant.content_id AND item.profile_id=variant.profile_id
WHERE variant.id=snapshot.variant_id AND variant.profile_id=snapshot.profile_id;

CREATE UNIQUE INDEX IF NOT EXISTS metric_snapshots_post_hour_unique
  ON public.metric_snapshots (profile_id, provider, external_post_id, captured_at);

ALTER TABLE public.metric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metric_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metric_snapshots_customer_read ON public.metric_snapshots;
CREATE POLICY metric_snapshots_customer_read ON public.metric_snapshots
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));
REVOKE ALL ON TABLE public.metric_snapshots FROM authenticated;
GRANT SELECT ON TABLE public.metric_snapshots TO authenticated;

CREATE TABLE IF NOT EXISTS public.analytics_sync_targets (
  job_id uuid PRIMARY KEY REFERENCES public.publication_jobs(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('INSTAGRAM','FACEBOOK','LINKEDIN')),
  external_post_id text NOT NULL,
  state text NOT NULL DEFAULT 'SCHEDULED' CHECK (state IN ('SCHEDULED','PROCESSING','BLOCKED','NOT_FOUND','COMPLETED')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid NULL,
  lease_expires_at timestamptz NULL,
  last_synced_at timestamptz NULL,
  last_error_code text NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, provider, external_post_id)
);

CREATE INDEX IF NOT EXISTS analytics_sync_targets_due_idx
  ON public.analytics_sync_targets (next_attempt_at, job_id)
  WHERE state = 'SCHEDULED';

ALTER TABLE public.analytics_sync_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sync_targets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analytics_sync_targets FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_analytics_sync_targets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_inserted integer;
BEGIN
  INSERT INTO public.analytics_sync_targets(job_id, profile_id, provider, external_post_id)
  SELECT job.id, job.profile_id, job.provider, job.remote_post_id
  FROM public.publication_jobs job
  WHERE job.state='PUBLISHED' AND job.remote_post_id IS NOT NULL
    AND btrim(job.remote_post_id)<>''
    AND job.provider IN ('INSTAGRAM','FACEBOOK','LINKEDIN')
    AND coalesce(job.published_at,job.updated_at) >= clock_timestamp()-interval '30 days'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_analytics_syncs(p_limit integer DEFAULT 20, p_lease_seconds integer DEFAULT 120)
RETURNS TABLE(
  job_id uuid, profile_id uuid, variant_id uuid, content_id uuid, provider text,
  external_post_id text, format text, topic text, published_at timestamptz,
  claim_token uuid, lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 50 OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
    RAISE EXCEPTION 'ANALYTICS_CLAIM_INPUT_INVALID' USING ERRCODE='22023';
  END IF;

  PERFORM public.refresh_analytics_sync_targets();

  UPDATE public.analytics_sync_targets stale
  SET state='SCHEDULED', claim_token=NULL, lease_expires_at=NULL,
      next_attempt_at=clock_timestamp(), last_error_code='WORKER_LEASE_EXPIRED',
      last_error='Aggiornamento risultati riprogrammato', updated_at=clock_timestamp()
  WHERE stale.state='PROCESSING' AND stale.lease_expires_at < clock_timestamp();

  RETURN QUERY
  WITH candidates AS (
    SELECT target.job_id
    FROM public.analytics_sync_targets target
    JOIN public.publication_jobs job ON job.id=target.job_id
    WHERE target.state='SCHEDULED' AND target.next_attempt_at<=clock_timestamp()
      AND job.state='PUBLISHED' AND job.remote_post_id=target.external_post_id
      AND coalesce(job.published_at,job.updated_at)>=clock_timestamp()-interval '30 days'
    ORDER BY target.next_attempt_at,target.job_id
    FOR UPDATE OF target SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.analytics_sync_targets target
    SET state='PROCESSING',claim_token=gen_random_uuid(),
        lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
        updated_at=clock_timestamp()
    FROM candidates WHERE target.job_id=candidates.job_id
    RETURNING target.*
  )
  SELECT claimed.job_id,claimed.profile_id,job.variant_id,variant.content_id,
    claimed.provider,claimed.external_post_id,variant.format,item.topic,
    coalesce(job.published_at,variant.published_at,job.updated_at),
    claimed.claim_token,claimed.lease_expires_at
  FROM claimed
  JOIN public.publication_jobs job ON job.id=claimed.job_id AND job.profile_id=claimed.profile_id
  JOIN public.content_variants variant ON variant.id=job.variant_id AND variant.profile_id=job.profile_id
  JOIN public.content_items item ON item.id=variant.content_id AND item.profile_id=job.profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_analytics_sync(
  p_job_id uuid, p_claim_token uuid, p_metrics jsonb,
  p_captured_at timestamptz DEFAULT clock_timestamp(), p_source text DEFAULT 'PROVIDER_API'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_target public.analytics_sync_targets%ROWTYPE; v_snapshot_id uuid; v_published_at timestamptz;
DECLARE v_variant_id uuid; v_content_id uuid; v_format text; v_topic text; v_bucket timestamptz;
BEGIN
  IF p_metrics IS NULL OR jsonb_typeof(p_metrics)<>'object' OR p_metrics='{}'::jsonb THEN
    RAISE EXCEPTION 'ANALYTICS_METRICS_EMPTY' USING ERRCODE='22023';
  END IF;
  IF p_source<>'PROVIDER_API' THEN RAISE EXCEPTION 'ANALYTICS_SOURCE_INVALID' USING ERRCODE='22023'; END IF;

  SELECT * INTO v_target FROM public.analytics_sync_targets
  WHERE job_id=p_job_id AND state='PROCESSING' AND claim_token=p_claim_token
    AND lease_expires_at>=clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT job.variant_id,variant.content_id,variant.format,item.topic,
    coalesce(job.published_at,variant.published_at,job.updated_at)
  INTO v_variant_id,v_content_id,v_format,v_topic,v_published_at
  FROM public.publication_jobs job
  JOIN public.content_variants variant ON variant.id=job.variant_id AND variant.profile_id=job.profile_id
  JOIN public.content_items item ON item.id=variant.content_id AND item.profile_id=job.profile_id
  WHERE job.id=v_target.job_id AND job.profile_id=v_target.profile_id
    AND job.provider=v_target.provider AND job.remote_post_id=v_target.external_post_id
    AND job.state='PUBLISHED';
  IF NOT FOUND THEN RAISE EXCEPTION 'ANALYTICS_TARGET_INTEGRITY_FAILED'; END IF;

  v_bucket=date_trunc('hour',p_captured_at);
  INSERT INTO public.metric_snapshots(
    profile_id,provider,content_id,variant_id,job_id,external_post_id,format,topic,
    published_at,captured_at,metrics,source
  ) VALUES (
    v_target.profile_id,v_target.provider,v_content_id,v_variant_id,v_target.job_id,
    v_target.external_post_id,v_format,v_topic,v_published_at,v_bucket,p_metrics,p_source
  )
  ON CONFLICT (profile_id,provider,external_post_id,captured_at)
  DO UPDATE SET metrics=excluded.metrics,source='PROVIDER_API'
  RETURNING id INTO v_snapshot_id;

  UPDATE public.analytics_sync_targets
  SET state=CASE WHEN v_published_at<clock_timestamp()-interval '30 days' THEN 'COMPLETED' ELSE 'SCHEDULED' END,
      consecutive_failures=0,last_synced_at=p_captured_at,
      next_attempt_at=clock_timestamp()+CASE WHEN v_published_at>=clock_timestamp()-interval '7 days' THEN interval '6 hours' ELSE interval '24 hours' END,
      claim_token=NULL,lease_expires_at=NULL,last_error_code=NULL,last_error=NULL,updated_at=clock_timestamp()
  WHERE job_id=p_job_id AND claim_token=p_claim_token;
  RETURN v_snapshot_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_analytics_sync(
  p_job_id uuid, p_claim_token uuid, p_error_code text, p_customer_message text,
  p_retryable boolean, p_terminal_state text DEFAULT NULL, p_retry_after_seconds integer DEFAULT 900
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_failures integer; v_state text;
BEGIN
  IF p_error_code IS NULL OR btrim(p_error_code)='' OR length(p_error_code)>120
    OR p_customer_message IS NULL OR length(p_customer_message)>300
    OR p_retry_after_seconds<60 OR p_retry_after_seconds>86400
    OR p_terminal_state IS NOT NULL AND p_terminal_state NOT IN ('BLOCKED','NOT_FOUND') THEN
    RAISE EXCEPTION 'ANALYTICS_FAILURE_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT consecutive_failures+1 INTO v_failures FROM public.analytics_sync_targets
  WHERE job_id=p_job_id AND state='PROCESSING' AND claim_token=p_claim_token FOR UPDATE;
  IF NOT FOUND THEN RETURN 'STALE_CLAIM'; END IF;
  v_state=CASE WHEN p_terminal_state IS NOT NULL THEN p_terminal_state WHEN p_retryable AND v_failures<5 THEN 'SCHEDULED' ELSE 'BLOCKED' END;
  UPDATE public.analytics_sync_targets
  SET state=v_state,consecutive_failures=v_failures,
      next_attempt_at=CASE WHEN v_state='SCHEDULED' THEN clock_timestamp()+make_interval(secs=>p_retry_after_seconds) ELSE next_attempt_at END,
      claim_token=NULL,lease_expires_at=NULL,last_error_code=p_error_code,
      last_error=p_customer_message,updated_at=clock_timestamp()
  WHERE job_id=p_job_id;
  RETURN v_state;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_analytics_sync_targets() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_analytics_syncs(integer,integer) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.complete_analytics_sync(uuid,uuid,jsonb,timestamptz,text) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.fail_analytics_sync(uuid,uuid,text,text,boolean,text,integer) FROM PUBLIC, authenticated;

COMMIT;
