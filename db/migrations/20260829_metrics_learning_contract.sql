-- Post Automatici — canonical persistence contract for real social metrics and learning.
-- Idempotent by design. This file is not applied automatically by deploys.

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider text NOT NULL,
  content_id uuid NULL REFERENCES content_items(id) ON DELETE SET NULL,
  variant_id uuid NULL REFERENCES content_variants(id) ON DELETE SET NULL,
  external_post_id text NOT NULL,
  format text NOT NULL,
  topic text NOT NULL,
  published_at timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'PROVIDER_API',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS profile_id uuid;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS content_id uuid;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS variant_id uuid;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS external_post_id text;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS format text;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS captured_at timestamptz DEFAULT now();
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS metrics jsonb DEFAULT '{}'::jsonb;
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS source text DEFAULT 'PROVIDER_API';
ALTER TABLE metric_snapshots ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS metric_snapshots_profile_captured_idx
  ON metric_snapshots (profile_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS metric_snapshots_profile_post_idx
  ON metric_snapshots (profile_id, provider, external_post_id);

CREATE TABLE IF NOT EXISTS learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  dimension_value text NOT NULL,
  sample_size integer NOT NULL,
  total_scorable_samples integer NOT NULL,
  baseline_score double precision NOT NULL,
  segment_score double precision NOT NULL,
  uplift_pct double precision NOT NULL,
  confidence text NOT NULL,
  recommendation text NOT NULL,
  metric_basis text NOT NULL,
  observed_from timestamptz NOT NULL,
  observed_to timestamptz NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS profile_id uuid;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS dimension text;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS dimension_value text;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS sample_size integer;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS total_scorable_samples integer;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS baseline_score double precision;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS segment_score double precision;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS uplift_pct double precision;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS confidence text;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS recommendation text;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS metric_basis text;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS observed_from timestamptz;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS observed_to timestamptz;
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS generated_at timestamptz DEFAULT now();
ALTER TABLE learning_insights ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS learning_insights_profile_generated_idx
  ON learning_insights (profile_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS learning_insights_profile_dimension_idx
  ON learning_insights (profile_id, dimension, dimension_value);
