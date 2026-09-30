BEGIN;

ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS approval_mode text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS approved_by text NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS rejected_reason text NULL,
  ADD COLUMN IF NOT EXISTS approved_fingerprint text NULL;

ALTER TABLE public.content_variants DROP CONSTRAINT IF EXISTS content_variants_approval_mode_check;
ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_approval_mode_check CHECK (approval_mode IN ('MANUAL','AUTO'));

ALTER TABLE public.content_variants DROP CONSTRAINT IF EXISTS content_variants_workflow_status_check;
ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_workflow_status_check CHECK (workflow_status IN ('DRAFT','REVIEW','REVIEW_REQUIRED','APPROVED','REJECTED'));

UPDATE public.content_variants
SET workflow_status=CASE
      WHEN approval_status='APPROVED' THEN 'APPROVED'
      WHEN approval_status='CHANGES_REQUESTED' THEN 'REJECTED'
      ELSE 'REVIEW'
    END,
    approved_at=CASE WHEN approval_status='APPROVED' THEN coalesce(approved_at,updated_at) ELSE approved_at END,
    approved_by=CASE WHEN approval_status='APPROVED' THEN coalesce(approved_by,'LEGACY') ELSE approved_by END,
    approved_fingerprint=CASE WHEN approval_status='APPROVED' THEN coalesce(approved_fingerprint,qa_fingerprint) ELSE approved_fingerprint END
WHERE workflow_status='DRAFT' AND created_at < now();

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
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
    NEW.rejected_reason := NULL;
    IF OLD.workflow_status='APPROVED' OR OLD.approval_status='APPROVED' THEN
      NEW.workflow_status := 'REVIEW_REQUIRED';
    ELSIF NEW.workflow_status <> 'DRAFT' THEN
      NEW.workflow_status := 'REVIEW';
    END IF;
    IF OLD.approval_status='APPROVED' THEN
      NEW.approval_status := 'PENDING';
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
        approved_by=NULL,
        approved_at=NULL,
        rejected_reason=NULL,
        workflow_status=CASE WHEN workflow_status='APPROVED' OR approval_status='APPROVED' THEN 'REVIEW_REQUIRED' ELSE 'REVIEW' END,
        approval_status=CASE WHEN approval_status='APPROVED' THEN 'PENDING' ELSE approval_status END,
        updated_at=clock_timestamp()
    WHERE id=NEW.variant_id AND profile_id=NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$slide_qa_invalidate$;

CREATE OR REPLACE FUNCTION public.guard_content_approval_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $approval_metadata_guard$
BEGIN
  IF NEW.approval_status='APPROVED' AND OLD.approval_status IS DISTINCT FROM 'APPROVED' THEN
    IF NEW.qa_status IS DISTINCT FROM 'PASS' OR NEW.qa_fingerprint IS NULL THEN
      RAISE EXCEPTION 'CONTENT_QA_PASS_REQUIRED';
    END IF;
    IF NEW.workflow_status IS DISTINCT FROM 'APPROVED'
       OR NEW.approved_by IS NULL OR btrim(NEW.approved_by)=''
       OR NEW.approved_at IS NULL
       OR NEW.approved_fingerprint IS DISTINCT FROM NEW.qa_fingerprint THEN
      RAISE EXCEPTION 'CONTENT_APPROVAL_METADATA_REQUIRED';
    END IF;
  END IF;

  IF NEW.workflow_status='APPROVED'
     AND (NEW.approval_status IS DISTINCT FROM 'APPROVED'
          OR NEW.qa_status IS DISTINCT FROM 'PASS'
          OR NEW.approved_fingerprint IS DISTINCT FROM NEW.qa_fingerprint) THEN
    RAISE EXCEPTION 'CONTENT_APPROVAL_STATE_INCONSISTENT';
  END IF;

  RETURN NEW;
END;
$approval_metadata_guard$;

DROP TRIGGER IF EXISTS content_variants_approval_metadata_guard ON public.content_variants;
CREATE TRIGGER content_variants_approval_metadata_guard
BEFORE UPDATE OF approval_status,workflow_status,approved_by,approved_at,approved_fingerprint
ON public.content_variants
FOR EACH ROW EXECUTE FUNCTION public.guard_content_approval_metadata();

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
RETURNS TABLE(variant_id uuid, approval_status text, workflow_status text, content_status text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $review_v2$
DECLARE
  v_variant public.content_variants%ROWTYPE;
  v_content_status text;
  v_workflow_status text;
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
    RAISE EXCEPTION 'CONTENT_REJECTION_REASON_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN neon_auth.user auth_user ON auth_user.id::text=p_actor_auth_user_id AND coalesce(auth_user.banned,false) IS FALSE
    WHERE profile.id=p_profile_id AND profile.owner_auth_user_id=p_actor_auth_user_id AND profile.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_FORBIDDEN' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_variant
  FROM public.content_variants
  WHERE id=p_variant_id AND content_id=p_content_id AND profile_id=p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_REVIEW_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_variant.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_STALE' USING ERRCODE='40001';
  END IF;

  v_changed := ROW(
    coalesce(v_variant.hook,''),coalesce(v_variant.caption,''),coalesce(v_variant.cta,''),v_variant.hashtags,
    coalesce(v_variant.visual_brief,''),coalesce(v_variant.alt_text,'')
  ) IS DISTINCT FROM ROW(
    coalesce(btrim(p_hook),''),btrim(p_caption),coalesce(btrim(p_cta),''),p_hashtags,
    coalesce(btrim(p_visual_brief),''),coalesce(btrim(p_alt_text),'')
  );

  IF p_approval_status='APPROVED' THEN
    IF v_changed THEN RAISE EXCEPTION 'CONTENT_SAVE_BEFORE_APPROVAL' USING ERRCODE='22023'; END IF;
    IF v_variant.qa_status IS DISTINCT FROM 'PASS' OR v_variant.qa_fingerprint IS NULL THEN
      RAISE EXCEPTION 'CONTENT_QA_PASS_REQUIRED' USING ERRCODE='22023';
    END IF;
    v_workflow_status := 'APPROVED';
  ELSIF p_approval_status='CHANGES_REQUESTED' THEN
    v_workflow_status := 'REJECTED';
  ELSE
    v_workflow_status := CASE
      WHEN v_variant.workflow_status='APPROVED' OR v_variant.approval_status='APPROVED' THEN 'REVIEW_REQUIRED'
      WHEN v_variant.workflow_status='DRAFT' AND NOT v_changed THEN 'REVIEW'
      ELSE 'REVIEW'
    END;
  END IF;

  UPDATE public.content_variants
  SET hook=nullif(btrim(p_hook),''),
      caption=btrim(p_caption),
      cta=nullif(btrim(p_cta),''),
      hashtags=p_hashtags,
      visual_brief=nullif(btrim(p_visual_brief),''),
      alt_text=nullif(btrim(p_alt_text),''),
      approval_mode='MANUAL',
      approval_status=p_approval_status,
      workflow_status=v_workflow_status,
      approved_by=CASE WHEN p_approval_status='APPROVED' THEN p_actor_auth_user_id ELSE NULL END,
      approved_at=CASE WHEN p_approval_status='APPROVED' THEN v_updated_at ELSE NULL END,
      approved_fingerprint=CASE WHEN p_approval_status='APPROVED' THEN qa_fingerprint ELSE NULL END,
      rejected_reason=CASE WHEN p_approval_status='CHANGES_REQUESTED' THEN left(btrim(p_rejected_reason),1000) ELSE NULL END,
      updated_at=v_updated_at
  WHERE id=p_variant_id;

  SELECT CASE
    WHEN bool_and(variant.workflow_status='APPROVED') THEN 'APPROVED'
    WHEN bool_or(variant.workflow_status='REJECTED') THEN 'CHANGES_REQUESTED'
    ELSE 'IN_REVIEW'
  END INTO v_content_status
  FROM public.content_variants variant
  WHERE variant.content_id=p_content_id AND variant.profile_id=p_profile_id;

  UPDATE public.content_items
  SET status=v_content_status,updated_at=v_updated_at
  WHERE id=p_content_id AND profile_id=p_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_REVIEW_NOT_FOUND' USING ERRCODE='P0002'; END IF;

  RETURN QUERY SELECT p_variant_id,p_approval_status,v_workflow_status,v_content_status,v_updated_at;
END;
$review_v2$;

REVOKE ALL ON FUNCTION public.review_content_variant_v2(text,uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text,text,text)
  FROM PUBLIC,authenticated;

CREATE OR REPLACE FUNCTION public.mark_content_variant_in_review(p_profile_id uuid,p_variant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $mark_review$
DECLARE v_status text;
BEGIN
  UPDATE public.content_variants
  SET workflow_status=CASE WHEN workflow_status='APPROVED' THEN 'REVIEW_REQUIRED' ELSE 'REVIEW' END,
      approval_status=CASE WHEN approval_status='APPROVED' THEN 'PENDING' ELSE approval_status END,
      approved_by=CASE WHEN approval_status='APPROVED' THEN NULL ELSE approved_by END,
      approved_at=CASE WHEN approval_status='APPROVED' THEN NULL ELSE approved_at END,
      approved_fingerprint=CASE WHEN approval_status='APPROVED' THEN NULL ELSE approved_fingerprint END,
      updated_at=updated_at
  WHERE id=p_variant_id AND profile_id=p_profile_id
  RETURNING workflow_status INTO v_status;
  IF v_status IS NULL THEN RAISE EXCEPTION 'CONTENT_REVIEW_NOT_FOUND'; END IF;
  RETURN v_status;
END;
$mark_review$;

REVOKE ALL ON FUNCTION public.mark_content_variant_in_review(uuid,uuid) FROM PUBLIC,authenticated;

CREATE OR REPLACE FUNCTION public.auto_approve_content_variant(
  p_profile_id uuid,
  p_variant_id uuid,
  p_approved_by text DEFAULT 'SYSTEM_AUTOPILOT'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $auto_approve$
DECLARE
  v_variant public.content_variants%ROWTYPE;
  v_ready integer;
  v_total integer;
  v_now timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO v_variant
  FROM public.content_variants
  WHERE id=p_variant_id AND profile_id=p_profile_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTENT_REVIEW_NOT_FOUND'; END IF;

  IF v_variant.approval_mode<>'AUTO'
     OR v_variant.eligible IS NOT TRUE
     OR v_variant.qa_status IS DISTINCT FROM 'PASS'
     OR v_variant.qa_fingerprint IS NULL THEN
    RETURN false;
  END IF;

  IF v_variant.format='CAROUSEL' THEN
    SELECT count(*)::int,
           count(*) FILTER (
             WHERE s.asset_id IS NOT NULL
               AND s.qa_status='PASS'
               AND a.quality_status='PASS'
               AND a.identity_status IN ('NOT_REQUIRED','PASS')
           )::int
      INTO v_total,v_ready
    FROM public.content_carousel_slides s
    LEFT JOIN public.assets a ON a.id=s.asset_id AND a.profile_id=s.profile_id
    WHERE s.variant_id=v_variant.id AND s.profile_id=v_variant.profile_id;
    IF v_total<4 OR v_total>10 OR v_ready<>v_total THEN RETURN false; END IF;
  ELSE
    IF v_variant.image_asset_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.assets a
      WHERE a.id=v_variant.image_asset_id AND a.profile_id=v_variant.profile_id
        AND a.quality_status='PASS' AND a.identity_status IN ('NOT_REQUIRED','PASS')
    ) THEN
      RETURN false;
    END IF;
  END IF;

  UPDATE public.content_variants
  SET approval_status='APPROVED',
      workflow_status='APPROVED',
      approved_by=coalesce(nullif(btrim(p_approved_by),''),'SYSTEM_AUTOPILOT'),
      approved_at=v_now,
      approved_fingerprint=qa_fingerprint,
      rejected_reason=NULL,
      updated_at=v_now
  WHERE id=v_variant.id AND profile_id=v_variant.profile_id;

  UPDATE public.content_items item
  SET status=CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM public.content_variants other
          WHERE other.content_id=item.id AND other.profile_id=item.profile_id
            AND other.workflow_status<>'APPROVED'
        ) THEN 'APPROVED'
        ELSE 'IN_REVIEW'
      END,
      updated_at=v_now
  WHERE item.id=v_variant.content_id AND item.profile_id=v_variant.profile_id;

  RETURN true;
END;
$auto_approve$;

REVOKE ALL ON FUNCTION public.auto_approve_content_variant(uuid,uuid,text) FROM PUBLIC,authenticated;

COMMIT;
