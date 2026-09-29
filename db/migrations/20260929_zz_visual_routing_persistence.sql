-- Persist auditable visual-provider decisions per content variant.
-- Additive only: no existing data is removed or rewritten.

BEGIN;

ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS visual_provider text NULL,
  ADD COLUMN IF NOT EXISTS visual_model text NULL,
  ADD COLUMN IF NOT EXISTS visual_decision_reason text NULL,
  ADD COLUMN IF NOT EXISTS estimated_visual_cost_eur numeric NULL,
  ADD COLUMN IF NOT EXISTS actual_visual_cost_eur numeric NULL,
  ADD COLUMN IF NOT EXISTS visual_qa_status text NULL,
  ADD COLUMN IF NOT EXISTS visual_qa_details jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_visual_provider_check
  CHECK (visual_provider IS NULL OR visual_provider IN ('REAL_ASSET','OPENAI','HIGGSFIELD'));

ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_visual_cost_check
  CHECK (
    (estimated_visual_cost_eur IS NULL OR estimated_visual_cost_eur >= 0)
    AND (actual_visual_cost_eur IS NULL OR actual_visual_cost_eur >= 0)
  );

ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_visual_qa_status_check
  CHECK (visual_qa_status IS NULL OR visual_qa_status IN ('NOT_REQUIRED','PENDING','PASS','BLOCK'));

CREATE INDEX IF NOT EXISTS content_variants_visual_provider_idx
  ON public.content_variants(profile_id, visual_provider, created_at DESC)
  WHERE visual_provider IS NOT NULL;

COMMIT;
