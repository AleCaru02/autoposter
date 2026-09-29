-- Post Automatici — persistent visual provider routing decisions.
-- Records the autonomous REAL_ASSET / OPENAI / HIGGSFIELD choice per social variant.
-- Does not execute any Higgsfield provider request.

BEGIN;

ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS visual_provider text NULL,
  ADD COLUMN IF NOT EXISTS visual_model text NULL,
  ADD COLUMN IF NOT EXISTS visual_decision_reason text NULL,
  ADD COLUMN IF NOT EXISTS visual_estimated_cost_eur numeric NULL,
  ADD COLUMN IF NOT EXISTS visual_actual_cost_eur numeric NULL,
  ADD COLUMN IF NOT EXISTS identity_qa_status text NOT NULL DEFAULT 'NOT_REQUIRED';

ALTER TABLE public.content_variants
  DROP CONSTRAINT IF EXISTS content_variants_visual_provider_check,
  DROP CONSTRAINT IF EXISTS content_variants_visual_estimated_cost_check,
  DROP CONSTRAINT IF EXISTS content_variants_visual_actual_cost_check,
  DROP CONSTRAINT IF EXISTS content_variants_identity_qa_status_check;

ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_visual_provider_check
    CHECK (visual_provider IS NULL OR visual_provider IN ('REAL_ASSET','OPENAI','HIGGSFIELD')),
  ADD CONSTRAINT content_variants_visual_estimated_cost_check
    CHECK (visual_estimated_cost_eur IS NULL OR visual_estimated_cost_eur >= 0),
  ADD CONSTRAINT content_variants_visual_actual_cost_check
    CHECK (visual_actual_cost_eur IS NULL OR visual_actual_cost_eur >= 0),
  ADD CONSTRAINT content_variants_identity_qa_status_check
    CHECK (identity_qa_status IN ('NOT_REQUIRED','PENDING','PASS','BLOCK'));

CREATE INDEX IF NOT EXISTS content_variants_visual_provider_idx
  ON public.content_variants(profile_id, visual_provider, created_at DESC)
  WHERE visual_provider IS NOT NULL;

COMMIT;
