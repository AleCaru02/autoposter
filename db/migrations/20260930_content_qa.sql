BEGIN;

ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS factual_basis jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS qa_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS qa_fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS qa_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS qa_checked_at timestamptz NULL;

ALTER TABLE public.content_variants DROP CONSTRAINT IF EXISTS content_variants_qa_status_check;
ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_qa_status_check
  CHECK (qa_status IN ('PENDING','PASS','FAIL','NEEDS_SOURCE'));

ALTER TABLE public.content_carousel_slides
  ADD COLUMN IF NOT EXISTS qa_fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS qa_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS qa_checked_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS public.content_qa_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.content_variants(id) ON DELETE CASCADE,
  slide_id uuid NULL REFERENCES public.content_carousel_slides(id) ON DELETE CASCADE,
  scope text NOT NULL,
  content_fingerprint text NOT NULL,
  overall_status text NOT NULL,
  brand_status text NOT NULL,
  copy_status text NOT NULL,
  visual_status text NOT NULL,
  fact_status text NOT NULL,
  platform_status text NOT NULL,
  duplicate_status text NOT NULL,
  budget_status text NOT NULL,
  reason text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_type text NOT NULL DEFAULT 'MANUAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_qa_results_scope_check CHECK (scope IN ('GLOBAL','SLIDE')),
  CONSTRAINT content_qa_results_overall_check CHECK (overall_status IN ('PASS','FAIL','NEEDS_SOURCE')),
  CONSTRAINT content_qa_results_brand_check CHECK (brand_status IN ('PASS','FAIL','NEEDS_SOURCE','SKIP')),
  CONSTRAINT content_qa_results_copy_check CHECK (copy_status IN ('PASS','FAIL','NEEDS_SOURCE','SKIP')),
  CONSTRAINT content_qa_results_visual_check CHECK (visual_status IN ('PASS','FAIL','NEEDS_SOURCE','SKIP')),
  CONSTRAINT content_qa_results_fact_check CHECK (fact_status IN ('PASS','FAIL','NEEDS_SOURCE','SKIP')),
  CONSTRAINT content_qa_results_platform_check CHECK (platform_status IN ('PASS','FAIL','NEEDS_SOURCE','SKIP')),
  CONSTRAINT content_qa_results_duplicate_check CHECK (duplicate_status IN ('PASS','FAIL','NEEDS_SOURCE','SKIP')),
  CONSTRAINT content_qa_results_budget_check CHECK (budget_status IN ('PASS','FAIL','NEEDS_SOURCE','SKIP')),
  CONSTRAINT content_qa_results_actor_check CHECK (actor_type IN ('MANUAL','AUTOPILOT','SYSTEM'))
);

CREATE INDEX IF NOT EXISTS content_qa_results_profile_variant_idx
  ON public.content_qa_results(profile_id, variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_qa_results_run_idx
  ON public.content_qa_results(run_id, scope, created_at);

ALTER TABLE public.content_qa_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_qa_results FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_qa_results_owner_read ON public.content_qa_results;
CREATE POLICY content_qa_results_owner_read ON public.content_qa_results
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));

REVOKE ALL ON TABLE public.content_qa_results FROM PUBLIC, authenticated;
GRANT SELECT ON TABLE public.content_qa_results TO authenticated;

CREATE OR REPLACE FUNCTION public.persist_content_qa_result(
  p_profile_id uuid,
  p_content_id uuid,
  p_variant_id uuid,
  p_run_id uuid,
  p_fingerprint text,
  p_overall_status text,
  p_brand_status text,
  p_copy_status text,
  p_visual_status text,
  p_fact_status text,
  p_platform_status text,
  p_duplicate_status text,
  p_budget_status text,
  p_reason text,
  p_details jsonb,
  p_actor_type text,
  p_slide_results jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $qa_persist$
DECLARE
  slide_record jsonb;
  v_slide_id uuid;
  v_slide_status text;
  v_slide_overall text;
BEGIN
  IF p_overall_status NOT IN ('PASS','FAIL','NEEDS_SOURCE')
     OR p_actor_type NOT IN ('MANUAL','AUTOPILOT','SYSTEM') THEN
    RAISE EXCEPTION 'CONTENT_QA_RESULT_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.content_variants v
    WHERE v.id=p_variant_id AND v.content_id=p_content_id AND v.profile_id=p_profile_id
  ) THEN
    RAISE EXCEPTION 'CONTENT_QA_VARIANT_NOT_FOUND';
  END IF;

  INSERT INTO public.content_qa_results(
    run_id,profile_id,content_id,variant_id,slide_id,scope,content_fingerprint,
    overall_status,brand_status,copy_status,visual_status,fact_status,platform_status,
    duplicate_status,budget_status,reason,details,actor_type
  ) VALUES (
    p_run_id,p_profile_id,p_content_id,p_variant_id,NULL,'GLOBAL',p_fingerprint,
    p_overall_status,p_brand_status,p_copy_status,p_visual_status,p_fact_status,p_platform_status,
    p_duplicate_status,p_budget_status,coalesce(p_reason,''),coalesce(p_details,'{}'::jsonb),p_actor_type
  );

  UPDATE public.content_variants
  SET qa_status=p_overall_status,
      qa_fingerprint=p_fingerprint,
      qa_result=coalesce(p_details,'{}'::jsonb),
      qa_checked_at=clock_timestamp(),
      updated_at=updated_at
  WHERE id=p_variant_id AND profile_id=p_profile_id;

  IF jsonb_typeof(coalesce(p_slide_results,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'CONTENT_QA_SLIDE_RESULTS_INVALID';
  END IF;

  FOR slide_record IN SELECT value FROM jsonb_array_elements(coalesce(p_slide_results,'[]'::jsonb))
  LOOP
    v_slide_id := nullif(slide_record->>'slideId','')::uuid;
    v_slide_overall := coalesce(slide_record->>'qualityStatus','FAIL');
    IF v_slide_overall NOT IN ('PASS','FAIL','NEEDS_SOURCE') THEN
      RAISE EXCEPTION 'CONTENT_QA_SLIDE_STATUS_INVALID';
    END IF;
    v_slide_status := CASE WHEN v_slide_overall='PASS' THEN 'PASS' ELSE 'BLOCK' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.content_carousel_slides s
      WHERE s.id=v_slide_id AND s.variant_id=p_variant_id AND s.profile_id=p_profile_id
    ) THEN
      RAISE EXCEPTION 'CONTENT_QA_SLIDE_NOT_FOUND';
    END IF;

    INSERT INTO public.content_qa_results(
      run_id,profile_id,content_id,variant_id,slide_id,scope,content_fingerprint,
      overall_status,brand_status,copy_status,visual_status,fact_status,platform_status,
      duplicate_status,budget_status,reason,details,actor_type
    ) VALUES (
      p_run_id,p_profile_id,p_content_id,p_variant_id,v_slide_id,'SLIDE',p_fingerprint,
      v_slide_overall,
      coalesce(slide_record->>'brandStatus','FAIL'),
      coalesce(slide_record->>'copyStatus','FAIL'),
      coalesce(slide_record->>'visualStatus','FAIL'),
      coalesce(slide_record->>'factStatus','FAIL'),
      'SKIP','SKIP','SKIP',
      coalesce(slide_record->>'reason',''),
      slide_record,
      p_actor_type
    );

    UPDATE public.content_carousel_slides
    SET qa_status=v_slide_status,
        qa_fingerprint=p_fingerprint,
        qa_result=slide_record,
        qa_checked_at=clock_timestamp(),
        updated_at=clock_timestamp()
    WHERE id=v_slide_id AND profile_id=p_profile_id;
  END LOOP;
END;
$qa_persist$;

REVOKE ALL ON FUNCTION public.persist_content_qa_result(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb,text,jsonb)
  FROM PUBLIC, authenticated;

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
    IF OLD.approval_status='APPROVED' THEN
      NEW.approval_status := 'PENDING';
    END IF;
  END IF;
  RETURN NEW;
END;
$qa_invalidate$;

DROP TRIGGER IF EXISTS content_variants_qa_invalidation ON public.content_variants;
CREATE TRIGGER content_variants_qa_invalidation
BEFORE UPDATE ON public.content_variants
FOR EACH ROW EXECUTE FUNCTION public.invalidate_variant_qa_on_change();

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
        approval_status=CASE WHEN approval_status='APPROVED' THEN 'PENDING' ELSE approval_status END,
        updated_at=clock_timestamp()
    WHERE id=NEW.variant_id AND profile_id=NEW.profile_id;
  END IF;
  RETURN NEW;
END;
$slide_qa_invalidate$;

DROP TRIGGER IF EXISTS content_carousel_slides_qa_invalidation ON public.content_carousel_slides;
CREATE TRIGGER content_carousel_slides_qa_invalidation
BEFORE UPDATE ON public.content_carousel_slides
FOR EACH ROW EXECUTE FUNCTION public.invalidate_carousel_slide_qa_on_change();

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

    IF NEW.image_asset_id IS NOT NULL THEN
      SELECT (a.quality_status='PASS' AND a.identity_status IN ('NOT_REQUIRED','PASS'))
      INTO v_asset_ready
      FROM public.assets a
      WHERE a.id=NEW.image_asset_id AND a.profile_id=NEW.profile_id;
      IF coalesce(v_asset_ready,false) IS FALSE THEN
        RAISE EXCEPTION 'CONTENT_ASSET_QA_PASS_REQUIRED';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$qa_approval$;

DROP TRIGGER IF EXISTS content_variants_qa_approval_guard ON public.content_variants;
CREATE TRIGGER content_variants_qa_approval_guard
BEFORE UPDATE OF approval_status ON public.content_variants
FOR EACH ROW EXECUTE FUNCTION public.guard_content_qa_approval();

CREATE OR REPLACE FUNCTION public.guard_carousel_variant_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $carousel_approval$
DECLARE
  v_count integer;
  v_ready integer;
BEGIN
  IF NEW.format='CAROUSEL' AND NEW.approval_status='APPROVED' AND OLD.approval_status IS DISTINCT FROM 'APPROVED' THEN
    SELECT count(*)::int,
           count(*) FILTER (
             WHERE s.asset_id IS NOT NULL
               AND s.qa_status='PASS'
               AND a.quality_status='PASS'
               AND a.identity_status IN ('NOT_REQUIRED','PASS')
           )::int
      INTO v_count,v_ready
    FROM public.content_carousel_slides s
    LEFT JOIN public.assets a ON a.id=s.asset_id AND a.profile_id=s.profile_id
    WHERE s.variant_id=NEW.id AND s.profile_id=NEW.profile_id;

    IF v_count < 4 OR v_count > 10 OR v_ready <> v_count THEN
      RAISE EXCEPTION 'CAROUSEL_SLIDES_NOT_READY';
    END IF;
  END IF;
  RETURN NEW;
END;
$carousel_approval$;

REVOKE ALL ON FUNCTION public.invalidate_variant_qa_on_change() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_carousel_slide_qa_on_change() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.guard_content_qa_approval() FROM PUBLIC, authenticated;

COMMIT;
