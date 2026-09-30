BEGIN;

CREATE OR REPLACE FUNCTION public.is_variant_publish_ready(
  p_variant_id uuid,
  p_profile_id uuid,
  p_provider text DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $publish_ready$
  SELECT EXISTS (
    SELECT 1
    FROM public.content_variants v
    WHERE v.id=p_variant_id
      AND v.profile_id=p_profile_id
      AND (p_provider IS NULL OR v.provider=p_provider)
      AND v.eligible IS TRUE
      AND v.approval_status='APPROVED'
      AND v.workflow_status='APPROVED'
      AND v.qa_status='PASS'
      AND v.qa_fingerprint IS NOT NULL
      AND v.approved_fingerprint=v.qa_fingerprint
      AND coalesce(btrim(v.approved_by),'')<>''
      AND v.approved_at IS NOT NULL
      AND (
        v.format<>'CAROUSEL'
        OR (
          (SELECT count(*) FROM public.content_carousel_slides s
            WHERE s.variant_id=v.id AND s.profile_id=v.profile_id) BETWEEN 4 AND 10
          AND NOT EXISTS (
            SELECT 1
            FROM public.content_carousel_slides s
            LEFT JOIN public.assets a
              ON a.id=s.asset_id
             AND a.profile_id=s.profile_id
            WHERE s.variant_id=v.id
              AND s.profile_id=v.profile_id
              AND (
                s.asset_id IS NULL
                OR s.qa_status<>'PASS'
                OR a.id IS NULL
                OR a.quality_status<>'PASS'
                OR a.identity_status NOT IN ('NOT_REQUIRED','PASS')
              )
          )
        )
      )
      AND (
        v.image_asset_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.assets a
          WHERE a.id=v.image_asset_id
            AND a.profile_id=v.profile_id
            AND a.quality_status='PASS'
            AND a.identity_status IN ('NOT_REQUIRED','PASS')
        )
      )
  );
$publish_ready$;

REVOKE ALL ON FUNCTION public.is_variant_publish_ready(uuid,uuid,text) FROM PUBLIC,authenticated;

CREATE OR REPLACE FUNCTION public.validate_publication_job_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $publication_guard$
DECLARE
  v_profile uuid;
  v_provider text;
BEGIN
  SELECT profile_id,provider INTO v_profile,v_provider
  FROM public.content_variants
  WHERE id=NEW.variant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication variant not found'; END IF;
  IF v_profile<>NEW.profile_id THEN RAISE EXCEPTION 'publication profile mismatch'; END IF;
  IF v_provider IS DISTINCT FROM NEW.provider THEN RAISE EXCEPTION 'publication provider mismatch'; END IF;

  IF NEW.state IN ('SCHEDULED','QUEUED','PROCESSING')
     AND public.is_variant_publish_ready(NEW.variant_id,NEW.profile_id,NEW.provider) IS NOT TRUE THEN
    RAISE EXCEPTION 'publication variant must match approved QA fingerprint';
  END IF;

  RETURN NEW;
END;
$publication_guard$;

DROP TRIGGER IF EXISTS publication_jobs_variant_guard ON public.publication_jobs;
CREATE TRIGGER publication_jobs_variant_guard
BEFORE INSERT OR UPDATE OF variant_id,profile_id,provider,state
ON public.publication_jobs
FOR EACH ROW EXECUTE FUNCTION public.validate_publication_job_variant();

CREATE OR REPLACE FUNCTION public.sync_publication_jobs_on_variant_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $publication_sync$
DECLARE
  v_ready boolean;
BEGIN
  v_ready := public.is_variant_publish_ready(NEW.id,NEW.profile_id,NEW.provider);

  IF v_ready IS NOT TRUE THEN
    UPDATE public.publication_jobs
       SET state='BLOCKED_APPROVAL',
           next_attempt_at=NULL,
           updated_at=clock_timestamp()
     WHERE variant_id=NEW.id
       AND profile_id=NEW.profile_id
       AND state IN ('SCHEDULED','QUEUED');
  ELSIF OLD.id IS NOT NULL
        AND public.is_variant_publish_ready(OLD.id,OLD.profile_id,OLD.provider) IS NOT TRUE THEN
    UPDATE public.publication_jobs
       SET state='SCHEDULED',
           updated_at=clock_timestamp()
     WHERE variant_id=NEW.id
       AND profile_id=NEW.profile_id
       AND state='BLOCKED_APPROVAL'
       AND scheduled_at>clock_timestamp();
  END IF;

  RETURN NEW;
END;
$publication_sync$;

DROP TRIGGER IF EXISTS content_variants_calendar_approval_sync ON public.content_variants;
CREATE TRIGGER content_variants_calendar_approval_sync
AFTER UPDATE ON public.content_variants
FOR EACH ROW EXECUTE FUNCTION public.sync_publication_jobs_on_variant_approval();

UPDATE public.publication_jobs j
SET state='BLOCKED_APPROVAL',
    next_attempt_at=NULL,
    updated_at=clock_timestamp()
WHERE j.state IN ('SCHEDULED','QUEUED')
  AND public.is_variant_publish_ready(j.variant_id,j.profile_id,j.provider) IS NOT TRUE;

CREATE OR REPLACE FUNCTION public.mark_publication_request_started(p_job_id uuid,p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $request_boundary$
DECLARE
  v_attempt integer;
BEGIN
  SELECT attempt_count INTO v_attempt
  FROM public.publication_jobs
  WHERE id=p_job_id
    AND state='PROCESSING'
    AND claim_token=p_claim_token
    AND lease_expires_at>=clock_timestamp()
    AND public.is_variant_publish_ready(variant_id,profile_id,provider) IS TRUE
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.publication_attempts
  SET state='REQUEST_SENT',
      request_started_at=clock_timestamp()
  WHERE job_id=p_job_id
    AND attempt_no=v_attempt
    AND claim_token=p_claim_token
    AND state='CLAIMED';

  RETURN FOUND;
END;
$request_boundary$;

REVOKE ALL ON FUNCTION public.mark_publication_request_started(uuid,uuid) FROM PUBLIC,authenticated;

COMMIT;
