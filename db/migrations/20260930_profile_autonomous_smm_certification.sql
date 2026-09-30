-- PROFILE AUTONOMOUS SMM CERTIFICATION
-- Persistent editorial memory, continuity, feedback and non-publishing certification records.
BEGIN;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS series_id uuid,
  ADD COLUMN IF NOT EXISTS sequence_number integer,
  ADD COLUMN IF NOT EXISTS previous_content_id uuid,
  ADD COLUMN IF NOT EXISTS next_topic_intent text,
  ADD COLUMN IF NOT EXISTS continuity_reason text,
  ADD COLUMN IF NOT EXISTS visual_archetype text,
  ADD COLUMN IF NOT EXISTS subject_strategy text;

DO $$ BEGIN
  ALTER TABLE public.content_items
    ADD CONSTRAINT content_items_previous_content_id_fkey
    FOREIGN KEY (previous_content_id) REFERENCES public.content_items(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.content_items
    ADD CONSTRAINT content_items_sequence_positive_check
    CHECK (sequence_number IS NULL OR sequence_number >= 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.content_items
    ADD CONSTRAINT content_items_subject_strategy_check
    CHECK (
      subject_strategy IS NULL OR subject_strategy IN (
        'CANONICAL_PERSON','PRODUCT','SERVICE','ENVIRONMENT','TEAM',
        'GENERIC_PERSON','OBJECT','TYPOGRAPHIC','INFOGRAPHIC','REAL_ASSET'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS content_items_profile_series_idx
  ON public.content_items(profile_id, series_id, sequence_number)
  WHERE series_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS content_items_profile_subject_idx
  ON public.content_items(profile_id, subject_strategy, created_at DESC)
  WHERE subject_strategy IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.profile_editorial_memory (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  memory_version integer NOT NULL DEFAULT 1,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_content_count integer NOT NULL DEFAULT 0,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_editorial_memory_snapshot_object CHECK (jsonb_typeof(snapshot)='object'),
  CONSTRAINT profile_editorial_memory_source_count_check CHECK (source_content_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.content_feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.content_items(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.content_variants(id) ON DELETE CASCADE,
  feedback_code text NOT NULL,
  note text,
  weight numeric NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'USER',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_feedback_code_check CHECK (feedback_code IN (
    'TOO_GENERIC','WRONG_TONE','BAD_VISUAL','TOO_SALESY','REPETITIVE',
    'FACT_ERROR','IDENTITY_BAD','WRONG_CTA','WRONG_SUBJECT','USER_CUSTOM'
  )),
  CONSTRAINT content_feedback_weight_check CHECK (weight >= 0.1 AND weight <= 3),
  CONSTRAINT content_feedback_source_check CHECK (source IN ('USER','SYSTEM','AUTOPILOT'))
);

CREATE INDEX IF NOT EXISTS content_feedback_profile_created_idx
  ON public.content_feedback_events(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_feedback_variant_idx
  ON public.content_feedback_events(variant_id, created_at DESC)
  WHERE variant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.profile_smm_certification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_type text NOT NULL,
  mode text NOT NULL DEFAULT 'PROFILE_SMM_CERTIFICATION',
  status text NOT NULL DEFAULT 'RUNNING',
  simulated_content_count integer NOT NULL DEFAULT 0,
  critical_failure_count integer NOT NULL DEFAULT 0,
  gates jsonb NOT NULL DEFAULT '{}'::jsonb,
  proof jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT profile_smm_certification_profile_type_check CHECK (profile_type IN ('BUSINESS','PERSONAL_BRAND')),
  CONSTRAINT profile_smm_certification_mode_check CHECK (mode IN ('PROFILE_SMM_CERTIFICATION','AUTOPILOT_TEST')),
  CONSTRAINT profile_smm_certification_status_check CHECK (status IN ('RUNNING','PASS','FAIL','BLOCKED')),
  CONSTRAINT profile_smm_certification_counts_check CHECK (simulated_content_count >= 0 AND critical_failure_count >= 0),
  CONSTRAINT profile_smm_certification_gates_object CHECK (jsonb_typeof(gates)='object'),
  CONSTRAINT profile_smm_certification_proof_object CHECK (jsonb_typeof(proof)='object')
);

CREATE INDEX IF NOT EXISTS profile_smm_certification_profile_idx
  ON public.profile_smm_certification_runs(profile_id, created_at DESC);

ALTER TABLE public.profile_editorial_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_feedback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_smm_certification_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.profile_editorial_memory FROM PUBLIC, authenticated;
REVOKE ALL ON public.content_feedback_events FROM PUBLIC, authenticated;
REVOKE ALL ON public.profile_smm_certification_runs FROM PUBLIC, authenticated;

COMMIT;
