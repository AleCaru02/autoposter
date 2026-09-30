BEGIN;

ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS approval_mode text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'REVIEW',
  ADD COLUMN IF NOT EXISTS approved_by text NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS rejected_reason text NULL,
  ADD COLUMN IF NOT EXISTS approved_fingerprint text NULL;

ALTER TABLE public.content_variants DROP CONSTRAINT IF EXISTS content_variants_approval_mode_check;
ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_approval_mode_check
  CHECK (approval_mode IN ('MANUAL','AUTO'));

ALTER TABLE public.content_variants DROP CONSTRAINT IF EXISTS content_variants_review_status_check;
ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_review_status_check
  CHECK (review_status IN ('DRAFT','REVIEW','REVIEW_REQUIRED','APPROVED','REJECTED'));

UPDATE public.content_variants
SET review_status = CASE
      WHEN approval_status='APPROVED' THEN 'APPROVED'
      WHEN approval_status='CHANGES_REQUESTED' THEN 'REJECTED'
      ELSE 'REVIEW'
    END,
    approved_by = CASE WHEN approval_status='APPROVED' THEN coalesce(approved_by,'LEGACY_MIGRATION') ELSE approved_by END,
    approved_at = CASE WHEN approval_status='APPROVED' THEN coalesce(approved_at,updated_at) ELSE approved_at END,
    approved_fingerprint = CASE WHEN approval_status='APPROVED' THEN coalesce(approved_fingerprint,qa_fingerprint) ELSE approved_fingerprint END
WHERE review_status IS DISTINCT FROM CASE
      WHEN approval_status='APPROVED' THEN 'APPROVED'
      WHEN approval_status='CHANGES_REQUESTED' THEN 'REJECTED'
      ELSE 'REVIEW'
    END
   OR (approval_status='APPROVED' AND (approved_by IS NULL OR approved_at IS NULL));

CREATE OR REPLACE FUNCTION public.invalidate_variant_qa_on_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=public,pg_temp
AS $qa_invalidate$
BEGIN
  IF ROW(NEW.hook,NEW.caption,NEW.cta,NEW.hashtags,NEW.visual_brief,NEW.alt_text,NEW.image_asset_id,NEW.eligible,NEW.provider,NEW.format)
     IS DISTINCT FROM
     ROW(OLD.hook,OLD.caption,OLD.cta,OLD.hashtags,OLD.visual_brief,OLD.alt_text,OLD.image_asset_id,OLD.eligible,OLD.provider,OLD.format) THEN
    NEW.qa_status := 'PENDING';
    NEW.qa_fingerprint := NULL;
    NEW.qa_result := '{}'::jsonb;
    NEW.qa_checked_at := NULL;
    NEW.approved_fingerprint := NULL;
    IF OLD.approval_status='APPROVED' OR OLD.review_status='APPROVED' THEN
      NEW.approval_status := 'PENDING';
      NEW.review_status := 'REVIEW_REQUIRED';
      NEW.approved_by := NULL;
      NEW.approved_at := NULL;
      NEW.rejected_reason := NULL;
    ELSIF NEW.review_status NOT IN ('DRAFT','REJECTED') THEN
      NEW.review_status := 'REVIEW';
    END IF;
  END IF;
  RETURN NEW;
END;
$qa_invalidate$;

CREATE OR REPLACE FUNCTION public.invalidate_carousel_slide_qa_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $slide_qa_invalidate$
BEGIN
  IF ROW(NEW.position,NEW.purpose,NEW.headline,NEW.body,NEW.hierarchy,NEW.visual_brief,NEW.alt_text,NEW.asset_id,NEW.width,NEW.height)
     IS DISTINCT FROM
     ROW(OLD.position,OLD.purpose,OLD.headline,OLD.body,OLD.hierarchy,OLD.visual_brief,OLD.alt_text,OLD.asset_id,OLD.width,OLD.height) THEN
    NEW.qa_status := 'PENDING';
    NEW.qa_fingerprint := NULL;
    NEW.qa_result := '{}'::jsonb;
    NEW.qa_checked_at := NULL;

    UPDATE public.content_variants
    SET qa_status='PENDING',
        qa_fingerprint=NULL,
        qa_result='{}'::jsonb,
        qa_checked_at=NULL,
        approved_fingerprint=NULL,
        review_status=CASE WHEN approval_status='APPROVED' OR review_status='APPROVED' THEN 'REVIEW_REQUIRED' ELSE 'REVIEW' END,
        approval_status=CASE WHEN approval_status='APPROVED' THEN 'PENDING' ELSE approval_status END,
        approved_by=CASE WHEN approval_status='APPROVED' OR review_status='APPROVED' THEN NULL ELSE approved_by END,
        approved_at=CASE WHEN approval_status='APPROVED' OR review_status='APPROVED' THEN NULL ELSE approved_at END,
        rejected_reason=NULL,
        updated_at=clock_timestamp()
    WHERE id=NEW.variant_id AND profile_id=NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$slide_qa_invalidate$;

CREATE OR REPLACE FUNCTION public.guard_content_qa_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $qa_approval$
DECLARE
  v_asset_ready boolean;
BEGIN
  IF NEW.approval_status='APPROVED' AND OLD.approval_status IS DISTINCT FROM 'APPROVED' THEN
    IF NEW.qa_status IS DISTINCT FROM 'PASS' OR NEW.qa_fingerprint IS NULL THEN
      RAISE EXCEPTION 'CONTENT_QA_PASS_REQUIRED';
    END IF;
    IF NEW.approval_mode NOT IN ('MANUAL','AUTO') OR coalesce(btrim(NEW.approved_by),'')='' THEN
      RAISE EXCEPTION 'CONTENT_APPROVAL_METADATA_REQUIRED';
    END IF;

    IF NEW.image_asset_id IS NOT NULL THEN
      SELECT (a.quality_status='PASS' AND a.identity_status IN ('NOT_REQUIRED','PASS'))
      INTO v_asset_ready
      FROM public.assets a
      WHERE a.id=NEW.image_asset_id AND a.profile_id=NEW.profile_id;
      IF coalesce(v_asset_ready,false) IS FALSE THEN
        RAISE EXCEPTION 'CONTENT_ASSET_QA_PASS_REQUIRED';
      END IF;
    END IF;

    NEW.review_status := 'APPROVED';
    NEW.approved_at := clock_timestamp();
    NEW.approved_fingerprint := NEW.qa_fingerprint;
    NEW.rejected_reason := NULL;
  ELSIF NEW.approval_status='CHANGES_REQUESTED' AND OLD.approval_status IS DISTINCT FROM 'CHANGES_REQUESTED' THEN
    IF coalesce(btrim(NEW.rejected_reason),'')='' THEN
      NEW.rejected_reason := 'Modifiche richieste';
    END IF;
    NEW.review_status := 'REJECTED';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.approved_fingerprint := NULL;
  ELSIF NEW.approval_status='PENDING' AND OLD.approval_status IS DISTINCT FROM 'PENDING'
        AND NEW.review_status <> 'REVIEW_REQUIRED' THEN
    NEW.review_status := 'REVIEW';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.approved_fingerprint := NULL;
  END IF;
  RETURN NEW;
END;
$qa_approval$;

CREATE OR REPLACE FUNCTION public.review_content_variant_v2(
  p_actor_auth_user_id text,
  p_profile_id uuid,
  p_content_id uuid,
  p_variant_id uuid,
  p_expected_updated_at timestamptz,
  p_hook text,
  p_caption text,
  p_cta text,
  p_hashtags jsonb,
  p_visual_brief text,
  p_alt_text text,
  p_approval_status text,
  p_rejected_reason text DEFAULT NULL
)
RETURNS TABLE(
  variant_id uuid,
  approval_status text,
  review_status text,
  approval_mode text,
  approved_by text,
  approved_at timestamptz,
  rejected_reason text,
  content_status text,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $review_v2$
DECLARE
  v_variant public.content_variants%ROWTYPE;
  v_content_status text;
  v_updated_at timestamptz := clock_timestamp();
  v_changed boolean;
BEGIN
  IF p_actor_auth_user_id IS NULL OR btrim(p_actor_auth_user_id)='' THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_approval_status NOT IN ('PENDING','APPROVED','CHANGES_REQUESTED')
     OR coalesce(btrim(p_caption),'')=''
     OR jsonb_typeof(coalesce(p_hashtags,'[]'::jsonb))<>'array' THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_approval_status='CHANGES_REQUESTED' AND coalesce(btrim(p_rejected_reason),'')='' THEN
    RAISE EXCEPTION 'CONTENT_REJECTED_REASON_REQUIRED' USING ERRCODE='22023';
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
    RAISE EXCEPTION 'CONTENT_REVIEW_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  SELECT variant.* INTO v_variant
  FROM public.content_variants variant
  WHERE variant.id=p_variant_id
    AND variant.content_id=p_content_id
    AND variant.profile_id=p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_REVIEW_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_variant.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_STALE' USING ERRCODE='40001';
  END IF;

  v_changed := ROW(
    coalesce(v_variant.hook,''),coalesce(v_variant.caption,''),coalesce(v_variant.cta,''),
    v_variant.hashtags,coalesce(v_variant.visual_brief,''),coalesce(v_variant.alt_text,'')
  ) IS DISTINCT FROM ROW(
    coalesce(btrim(p_hook),''),btrim(p_caption),coalesce(btrim(p_cta),''),
    p_hashtags,coalesce(btrim(p_visual_brief),''),coalesce(btrim(p_alt_text),'')
  );
  IF p_approval_status='APPROVED' AND v_changed THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_QA_REQUIRED_AFTER_EDIT' USING ERRCODE='22023';
  END IF;

  UPDATE public.content_variants variant
  SET hook=nullif(btrim(p_hook),''),
      caption=btrim(p_caption),
      cta=nullif(btrim(p_cta),''),
      hashtags=p_hashtags,
      visual_brief=nullif(btrim(p_visual_brief),''),
      alt_text=nullif(btrim(p_alt_text),''),
      approval_status=p_approval_status,
      approval_mode='MANUAL',
      approved_by=CASE WHEN p_approval_status='APPROVED' THEN p_actor_auth_user_id ELSE NULL END,
      rejected_reason=CASE WHEN p_approval_status='CHANGES_REQUESTED' THEN btrim(p_rejected_reason) ELSE NULL END,
      review_status=CASE
        WHEN p_approval_status='APPROVED' THEN variant.review_status
        WHEN p_approval_status='CHANGES_REQUESTED' THEN 'REJECTED'
        WHEN variant.review_status='REVIEW_REQUIRED' THEN 'REVIEW_REQUIRED'
        ELSE 'REVIEW'
      END,
      updated_at=v_updated_at
  WHERE variant.id=p_variant_id;

  SELECT CASE
    WHEN bool_and(variant.approval_status='APPROVED') THEN 'APPROVED'
    WHEN bool_or(variant.approval_status='CHANGES_REQUESTED') THEN 'CHANGES_REQUESTED'
    ELSE 'IN_REVIEW'
  END INTO v_content_status
  FROM public.content_variants variant
  WHERE variant.content_id=p_content_id AND variant.profile_id=p_profile_id;

  UPDATE public.content_items item
  SET status=v_content_status,updated_at=v_updated_at
  WHERE item.id=p_content_id AND item.profile_id=p_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_REVIEW_NOT_FOUND' USING ERRCODE='P0002'; END IF;

  RETURN QUERY
  SELECT variant.id,variant.approval_status,variant.review_status,variant.approval_mode,
         variant.approved_by,variant.approved_at,variant.rejected_reason,
         v_content_status,variant.updated_at
  FROM public.content_variants variant
  WHERE variant.id=p_variant_id;
END;
$review_v2$;

REVOKE ALL ON FUNCTION public.review_content_variant_v2(text,uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text,text,text)
FROM PUBLIC,authenticated;

CREATE OR REPLACE FUNCTION public.validate_publication_job_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $pub_guard$
DECLARE
  v_profile uuid;
  v_provider text;
  v_eligible boolean;
  v_approval text;
  v_review text;
  v_qa text;
  v_qa_fingerprint text;
  v_approved_fingerprint text;
BEGIN
  SELECT profile_id,provider,eligible,approval_status,review_status,qa_status,qa_fingerprint,approved_fingerprint
    INTO v_profile,v_provider,v_eligible,v_approval,v_review,v_qa,v_qa_fingerprint,v_approved_fingerprint
  FROM public.content_variants
  WHERE id=NEW.variant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'publication variant not found'; END IF;
  IF v_profile<>NEW.profile_id THEN RAISE EXCEPTION 'publication profile mismatch'; END IF;
  IF v_provider IS DISTINCT FROM NEW.provider THEN RAISE EXCEPTION 'publication provider mismatch'; END IF;
  IF NEW.state IN ('SCHEDULED','QUEUED','PROCESSING')
     AND (
       v_eligible IS NOT TRUE
       OR v_approval<>'APPROVED'
       OR v_review<>'APPROVED'
       OR v_qa<>'PASS'
       OR v_qa_fingerprint IS NULL
       OR v_approved_fingerprint IS DISTINCT FROM v_qa_fingerprint
     ) THEN
    RAISE EXCEPTION 'publication variant must match approved QA fingerprint';
  END IF;
  RETURN NEW;
END;
$pub_guard$;

CREATE OR REPLACE FUNCTION public.mark_publication_request_started(p_job_id uuid,p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $request_boundary$
DECLARE v_attempt integer;
BEGIN
  SELECT attempt_count INTO v_attempt
  FROM public.publication_jobs
  WHERE id=p_job_id
    AND state='PROCESSING'
    AND claim_token=p_claim_token
    AND lease_expires_at>=clock_timestamp()
    AND EXISTS (
      SELECT 1
      FROM public.content_variants variant
      WHERE variant.id=publication_jobs.variant_id
        AND variant.profile_id=publication_jobs.profile_id
        AND variant.provider=publication_jobs.provider
        AND variant.approval_status='APPROVED'
        AND variant.review_status='APPROVED'
        AND variant.qa_status='PASS'
        AND variant.qa_fingerprint IS NOT NULL
        AND variant.approved_fingerprint=variant.qa_fingerprint
        AND variant.eligible IS TRUE
    )
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.publication_attempts
  SET state='REQUEST_SENT',request_started_at=clock_timestamp()
  WHERE job_id=p_job_id AND attempt_no=v_attempt AND claim_token=p_claim_token AND state='CLAIMED';
  RETURN FOUND;
END;
$request_boundary$;

REVOKE ALL ON FUNCTION public.mark_publication_request_started(uuid,uuid) FROM PUBLIC,authenticated;

COMMIT;
