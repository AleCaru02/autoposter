-- Post Automatici — Reel engine foundation (additive, backward compatible).
-- * render_jobs: persistent, resumable cloud render pipeline (one row per Reel).
-- * content_variants.video_asset_id: the rendered MP4 attached to a REEL variant.
-- * Capabilities for Reel script, TTS voice and render, metered through the existing
--   entitlement + provider-cost budget (no unmetered paid call is possible).
-- No existing row is modified except the additive entitlement upsert for active packages.

BEGIN;

ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS video_asset_id uuid NULL REFERENCES public.assets(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_variant_id uuid NULL REFERENCES public.content_variants(id) ON DELETE SET NULL,
  output_variant_id uuid NULL REFERENCES public.content_variants(id) ON DELETE SET NULL,
  video_asset_id uuid NULL REFERENCES public.assets(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'REEL_FACELESS',
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'QUEUED',
  step text NOT NULL DEFAULT 'SCRIPT',
  steps_completed integer NOT NULL DEFAULT 0,
  steps_total integer NOT NULL DEFAULT 5,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  qa jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz NULL,
  claim_token uuid NULL,
  last_error_code text NULL,
  last_error_message text NULL,
  cost_usd numeric(12,4) NOT NULL DEFAULT 0,
  requested_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT render_jobs_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT render_jobs_kind_check CHECK (kind IN ('REEL_FACELESS','REEL_AVATAR')),
  CONSTRAINT render_jobs_state_check CHECK (state IN ('QUEUED','RUNNING','READY_FOR_REVIEW','FAILED','BLOCKED','CANCELED')),
  CONSTRAINT render_jobs_step_check CHECK (step IN ('SCRIPT','VISUALS','VOICE','RENDER','QA','DONE')),
  CONSTRAINT render_jobs_progress_check CHECK (steps_completed >= 0 AND steps_completed <= steps_total AND steps_total BETWEEN 1 AND 10),
  CONSTRAINT render_jobs_attempts_check CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10),
  CONSTRAINT render_jobs_cost_check CHECK (cost_usd >= 0)
);

CREATE INDEX IF NOT EXISTS render_jobs_profile_created_idx ON public.render_jobs(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS render_jobs_due_idx ON public.render_jobs(state, next_attempt_at) WHERE state IN ('QUEUED','RUNNING');

ALTER TABLE public.render_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.render_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS require_authenticated_identity ON public.render_jobs;
CREATE POLICY require_authenticated_identity ON public.render_jobs AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (((select auth.user_id()) IS NOT NULL)) WITH CHECK (((select auth.user_id()) IS NOT NULL));

DROP POLICY IF EXISTS render_jobs_owner_read ON public.render_jobs;
CREATE POLICY render_jobs_owner_read ON public.render_jobs
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));

-- Browser clients may only read their own jobs; every write goes through server code.
REVOKE ALL ON TABLE public.render_jobs FROM PUBLIC, authenticated;
GRANT SELECT ON TABLE public.render_jobs TO authenticated;

-- Claims due jobs with a lease. Expired leases are resumed from their persisted step
-- (every step is idempotent), until max_attempts is exhausted.
CREATE OR REPLACE FUNCTION public.claim_due_render_jobs(p_limit integer DEFAULT 1, p_lease_seconds integer DEFAULT 290)
RETURNS SETOF public.render_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 10 OR p_lease_seconds < 60 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'RENDER_CLAIM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE public.render_jobs
  SET state = CASE WHEN attempt_count >= max_attempts THEN 'FAILED' ELSE 'QUEUED' END,
      last_error_code = CASE WHEN attempt_count >= max_attempts THEN 'RENDER_ATTEMPTS_EXHAUSTED' ELSE 'RENDER_LEASE_EXPIRED' END,
      last_error_message = CASE WHEN attempt_count >= max_attempts THEN 'Tentativi esauriti: il job è stato interrotto più volte' ELSE 'Esecuzione interrotta: ripresa dallo step salvato' END,
      claim_token = NULL, lease_expires_at = NULL, next_attempt_at = clock_timestamp(),
      completed_at = CASE WHEN attempt_count >= max_attempts THEN clock_timestamp() ELSE NULL END,
      updated_at = clock_timestamp()
  WHERE state = 'RUNNING' AND lease_expires_at < clock_timestamp();

  RETURN QUERY
  WITH due AS (
    SELECT job.id FROM public.render_jobs job
    WHERE job.state = 'QUEUED' AND job.next_attempt_at <= clock_timestamp()
    ORDER BY job.next_attempt_at, job.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.render_jobs job
  SET state = 'RUNNING', claim_token = gen_random_uuid(), attempt_count = job.attempt_count + 1,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), updated_at = clock_timestamp()
  FROM due WHERE job.id = due.id
  RETURNING job.*;
END;
$$;

-- Claims one specific job (immediate run after enqueue); same lease semantics.
CREATE OR REPLACE FUNCTION public.claim_render_job(p_job_id uuid, p_lease_seconds integer DEFAULT 290)
RETURNS SETOF public.render_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_lease_seconds < 60 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'RENDER_CLAIM_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE public.render_jobs job
  SET state = 'RUNNING', claim_token = gen_random_uuid(), attempt_count = job.attempt_count + 1,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), updated_at = clock_timestamp()
  WHERE job.id = p_job_id AND job.state = 'QUEUED' AND job.next_attempt_at <= clock_timestamp()
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_render_jobs(integer, integer) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.claim_render_job(uuid, integer) FROM PUBLIC, authenticated;

-- A REEL variant can be approved only with a technically verified MP4 attached.
CREATE OR REPLACE FUNCTION public.guard_reel_variant_video()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.format = 'REEL' AND (NEW.workflow_status = 'APPROVED' OR NEW.approval_status = 'APPROVED') THEN
    IF NEW.video_asset_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.assets asset
      WHERE asset.id = NEW.video_asset_id AND asset.profile_id = NEW.profile_id
        AND asset.kind = 'VIDEO' AND asset.quality_status = 'PASS'
    ) THEN
      RAISE EXCEPTION 'REEL_VIDEO_QA_REQUIRED' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_variants_reel_video_guard ON public.content_variants;
CREATE TRIGGER content_variants_reel_video_guard
  BEFORE INSERT OR UPDATE ON public.content_variants
  FOR EACH ROW EXECUTE FUNCTION public.guard_reel_variant_video();

-- Metered capabilities (personal package enabled, commercial disabled).
INSERT INTO public.entitlement_package_capabilities(
  package_key,package_version,capability_key,enabled,limit_type,limit_value,period_type,provider_attempt_reserve_usd,metadata
) VALUES
  ('personal_operator',1,'ai.reel.script',true,'COUNT_PER_MONTH',200,'MONTH',0.08,'{"block":"REEL_ENGINE","personalFirst":true}'::jsonb),
  ('personal_operator',1,'ai.voice.tts',true,'COUNT_PER_MONTH',200,'MONTH',0.05,'{"block":"REEL_ENGINE","personalFirst":true}'::jsonb),
  ('personal_operator',1,'video.reel.render',true,'COUNT_PER_MONTH',150,'MONTH',0.01,'{"block":"REEL_ENGINE","personalFirst":true}'::jsonb),
  ('commercial_guarded',1,'ai.reel.script',false,'COUNT_PER_MONTH',NULL,'NONE',NULL,'{"block":"REEL_ENGINE","commercialNotReady":true}'::jsonb),
  ('commercial_guarded',1,'ai.voice.tts',false,'COUNT_PER_MONTH',NULL,'NONE',NULL,'{"block":"REEL_ENGINE","commercialNotReady":true}'::jsonb),
  ('commercial_guarded',1,'video.reel.render',false,'COUNT_PER_MONTH',NULL,'NONE',NULL,'{"block":"REEL_ENGINE","commercialNotReady":true}'::jsonb)
ON CONFLICT (package_key,package_version,capability_key) DO UPDATE SET
  enabled=EXCLUDED.enabled,
  limit_type=EXCLUDED.limit_type,
  limit_value=EXCLUDED.limit_value,
  period_type=EXCLUDED.period_type,
  provider_attempt_reserve_usd=EXCLUDED.provider_attempt_reserve_usd,
  metadata=EXCLUDED.metadata;

INSERT INTO public.profile_entitlements(
  profile_id,capability_key,enabled,limit_type,limit_value,period_type,source,metadata
)
SELECT assignment.profile_id,cap.capability_key,cap.enabled,cap.limit_type,cap.limit_value,cap.period_type,
       'PACKAGE:'||assignment.package_key||':v'||assignment.package_version::text,
       jsonb_build_object('package_key',assignment.package_key,'package_version',assignment.package_version,
                          'package_assignment_id',assignment.id,'provider_attempt_reserve_usd',cap.provider_attempt_reserve_usd)
FROM public.profile_entitlement_package_assignments assignment
JOIN public.entitlement_package_capabilities cap
  ON cap.package_key=assignment.package_key
 AND cap.package_version=assignment.package_version
 AND cap.capability_key IN ('ai.reel.script','ai.voice.tts','video.reel.render')
WHERE assignment.revoked_at IS NULL
ON CONFLICT (profile_id,capability_key) DO UPDATE SET
  enabled=EXCLUDED.enabled,
  limit_type=EXCLUDED.limit_type,
  limit_value=EXCLUDED.limit_value,
  period_type=EXCLUDED.period_type,
  source=EXCLUDED.source,
  metadata=EXCLUDED.metadata,
  updated_at=now();

COMMIT;
