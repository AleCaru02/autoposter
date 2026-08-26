-- Gate 13: calendario e frequenze per profilo.
-- Idempotente: può essere riapplicata senza duplicare indice/trigger.

CREATE UNIQUE INDEX IF NOT EXISTS schedules_profile_provider_unique
  ON public.schedules (profile_id, provider)
  WHERE provider IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_publication_job_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile uuid;
  v_provider text;
  v_eligible boolean;
  v_approval text;
BEGIN
  SELECT profile_id, provider, eligible, approval_status
    INTO v_profile, v_provider, v_eligible, v_approval
    FROM public.content_variants
   WHERE id = NEW.variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'publication variant not found';
  END IF;
  IF v_profile <> NEW.profile_id THEN
    RAISE EXCEPTION 'publication profile mismatch';
  END IF;
  IF v_provider IS DISTINCT FROM NEW.provider THEN
    RAISE EXCEPTION 'publication provider mismatch';
  END IF;
  IF NEW.state IN ('SCHEDULED', 'QUEUED')
     AND (v_eligible IS NOT TRUE OR v_approval <> 'APPROVED') THEN
    RAISE EXCEPTION 'publication variant must be eligible and approved';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_jobs_variant_guard ON public.publication_jobs;
CREATE TRIGGER publication_jobs_variant_guard
BEFORE INSERT OR UPDATE OF variant_id, profile_id, provider, state
ON public.publication_jobs
FOR EACH ROW
EXECUTE FUNCTION public.validate_publication_job_variant();

CREATE OR REPLACE FUNCTION public.sync_publication_jobs_on_variant_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.approval_status <> 'APPROVED' OR NEW.eligible IS NOT TRUE THEN
    UPDATE public.publication_jobs
       SET state = 'BLOCKED_APPROVAL', updated_at = now()
     WHERE variant_id = NEW.id
       AND state = 'SCHEDULED';
  ELSIF (OLD.approval_status <> 'APPROVED' OR OLD.eligible IS NOT TRUE)
        AND NEW.approval_status = 'APPROVED'
        AND NEW.eligible IS TRUE THEN
    UPDATE public.publication_jobs
       SET state = 'SCHEDULED', updated_at = now()
     WHERE variant_id = NEW.id
       AND state = 'BLOCKED_APPROVAL'
       AND scheduled_at > now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_variants_calendar_approval_sync ON public.content_variants;
CREATE TRIGGER content_variants_calendar_approval_sync
AFTER UPDATE OF approval_status, eligible
ON public.content_variants
FOR EACH ROW
EXECUTE FUNCTION public.sync_publication_jobs_on_variant_approval();
