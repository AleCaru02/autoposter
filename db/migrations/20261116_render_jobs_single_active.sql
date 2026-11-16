-- Post Automatici — at most one active Reel job per source (additive, no data change).
-- A double click, a second tab or a retried request with a new requestId can no longer
-- start a second paid run of the same source while the first is QUEUED or RUNNING.
-- Dry runs and real runs are counted separately. Finished jobs (READY_FOR_REVIEW, FAILED,
-- BLOCKED, CANCELED) never conflict, so a new Reel from the same source stays possible later.

BEGIN;

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.render_jobs
    WHERE state IN ('QUEUED','RUNNING') AND source_variant_id IS NOT NULL
    GROUP BY profile_id, source_variant_id, kind, coalesce((input->>'dryRun')::boolean,false)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'RENDER_JOBS_DUPLICATE_ACTIVE_SOURCE: resolve active duplicates before applying' USING ERRCODE = '23505';
  END IF;
END
$guard$;

CREATE UNIQUE INDEX IF NOT EXISTS render_jobs_one_active_per_source
  ON public.render_jobs (profile_id, source_variant_id, kind, (coalesce((input->>'dryRun')::boolean,false)))
  WHERE state IN ('QUEUED','RUNNING') AND source_variant_id IS NOT NULL;

COMMIT;
