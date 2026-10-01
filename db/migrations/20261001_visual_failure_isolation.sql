-- Persist visual generation independently from copy so image failures never destroy text work.
ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS visual_generation_status text NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS visual_generation_error text,
  ADD COLUMN IF NOT EXISTS visual_generation_updated_at timestamptz;

ALTER TABLE public.content_carousel_slides
  ADD COLUMN IF NOT EXISTS visual_generation_status text NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN IF NOT EXISTS visual_generation_error text,
  ADD COLUMN IF NOT EXISTS visual_generation_updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.content_variants
    ADD CONSTRAINT content_variants_visual_generation_status_check
    CHECK (visual_generation_status IN ('NOT_STARTED','IN_PROGRESS','PASS','FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.content_carousel_slides
    ADD CONSTRAINT content_carousel_slides_visual_generation_status_check
    CHECK (visual_generation_status IN ('NOT_STARTED','IN_PROGRESS','PASS','FAILED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS content_variants_visual_generation_idx
  ON public.content_variants(profile_id, visual_generation_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS content_carousel_slides_visual_generation_idx
  ON public.content_carousel_slides(profile_id, visual_generation_status, updated_at DESC);
