BEGIN;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS decision_record jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.content_carousel_slides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.content_variants(id) ON DELETE CASCADE,
  position integer NOT NULL,
  purpose text NOT NULL,
  headline text NOT NULL,
  body text NOT NULL,
  hierarchy text NOT NULL,
  visual_brief text NOT NULL,
  alt_text text NOT NULL,
  asset_id uuid NULL REFERENCES public.assets(id) ON DELETE SET NULL,
  width integer NOT NULL DEFAULT 1080,
  height integer NOT NULL DEFAULT 1080,
  qa_status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_carousel_slides_position_check CHECK (position BETWEEN 1 AND 10),
  CONSTRAINT content_carousel_slides_dimensions_check CHECK (width > 0 AND height > 0),
  CONSTRAINT content_carousel_slides_qa_check CHECK (qa_status IN ('PENDING','PASS','BLOCK','FAILED')),
  UNIQUE (variant_id, position)
);

CREATE INDEX IF NOT EXISTS content_carousel_slides_profile_content_idx
  ON public.content_carousel_slides(profile_id, content_id, position);

CREATE INDEX IF NOT EXISTS content_carousel_slides_variant_idx
  ON public.content_carousel_slides(variant_id, position);

CREATE OR REPLACE FUNCTION public.validate_content_carousel_slide_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $carousel_scope$
DECLARE
  v_profile uuid;
  v_content uuid;
  v_format text;
BEGIN
  SELECT profile_id, content_id, format
    INTO v_profile, v_content, v_format
  FROM public.content_variants
  WHERE id=NEW.variant_id;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'CAROUSEL_VARIANT_NOT_FOUND';
  END IF;
  IF v_profile IS DISTINCT FROM NEW.profile_id OR v_content IS DISTINCT FROM NEW.content_id THEN
    RAISE EXCEPTION 'CAROUSEL_SCOPE_MISMATCH';
  END IF;
  IF v_format IS DISTINCT FROM 'CAROUSEL' THEN
    RAISE EXCEPTION 'CAROUSEL_FORMAT_REQUIRED';
  END IF;
  RETURN NEW;
END;
$carousel_scope$;

DROP TRIGGER IF EXISTS content_carousel_slides_scope_guard ON public.content_carousel_slides;
CREATE TRIGGER content_carousel_slides_scope_guard
BEFORE INSERT OR UPDATE OF profile_id,content_id,variant_id
ON public.content_carousel_slides
FOR EACH ROW EXECUTE FUNCTION public.validate_content_carousel_slide_scope();

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
           count(*) FILTER (WHERE asset_id IS NOT NULL AND qa_status='PASS')::int
      INTO v_count,v_ready
    FROM public.content_carousel_slides
    WHERE variant_id=NEW.id AND profile_id=NEW.profile_id;

    IF v_count < 4 OR v_count > 10 OR v_ready <> v_count THEN
      RAISE EXCEPTION 'CAROUSEL_SLIDES_NOT_READY';
    END IF;
  END IF;
  RETURN NEW;
END;
$carousel_approval$;

DROP TRIGGER IF EXISTS content_variants_carousel_approval_guard ON public.content_variants;
CREATE TRIGGER content_variants_carousel_approval_guard
BEFORE UPDATE OF approval_status ON public.content_variants
FOR EACH ROW EXECUTE FUNCTION public.guard_carousel_variant_approval();

ALTER TABLE public.content_carousel_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_carousel_slides FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_carousel_slides_owner ON public.content_carousel_slides;
CREATE POLICY content_carousel_slides_owner ON public.content_carousel_slides
  FOR ALL TO authenticated
  USING (public.owns_profile(profile_id))
  WITH CHECK (public.owns_profile(profile_id));

REVOKE ALL ON TABLE public.content_carousel_slides FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.content_carousel_slides TO authenticated;
REVOKE ALL ON FUNCTION public.validate_content_carousel_slide_scope() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION public.guard_carousel_variant_approval() FROM PUBLIC, authenticated;

COMMIT;
