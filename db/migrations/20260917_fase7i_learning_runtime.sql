-- FASE 7I — atomic, profile-scoped persistence for evidence-based learning.
-- The Worker supplies only insights calculated from real PROVIDER_API snapshots.

BEGIN;

-- Production predates the structured learning contract and still exposes the
-- customer-facing scope/insight/evidence/recommended_action columns. Keep that
-- contract and add the evidence fields used by the runtime.
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS dimension text;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS dimension_value text;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS sample_size integer;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS total_scorable_samples integer;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS baseline_score double precision;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS segment_score double precision;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS uplift_pct double precision;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS confidence text;
ALTER TABLE public.learning_insights ALTER COLUMN confidence TYPE text USING confidence::text;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS recommendation text;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS metric_basis text;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS observed_from timestamptz;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS observed_to timestamptz;
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS generated_at timestamptz DEFAULT now();
ALTER TABLE public.learning_insights ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

UPDATE public.learning_insights
SET generated_at=created_at,
    active=(applied_at IS NULL)
WHERE dimension IS NULL;

WITH ranked AS (
  SELECT id,row_number() OVER (
    PARTITION BY profile_id,dimension,dimension_value
    ORDER BY active DESC,generated_at DESC,id DESC
  ) AS position
  FROM public.learning_insights
  WHERE dimension IS NOT NULL AND dimension_value IS NOT NULL
)
DELETE FROM public.learning_insights insight
USING ranked
WHERE insight.id=ranked.id AND ranked.position>1;

CREATE UNIQUE INDEX IF NOT EXISTS learning_insights_profile_dimension_value_unique
  ON public.learning_insights(profile_id,dimension,dimension_value)
  WHERE dimension IS NOT NULL AND dimension_value IS NOT NULL;

ALTER TABLE public.learning_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_insights FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS learning_insights_customer_read ON public.learning_insights;
CREATE POLICY learning_insights_customer_read ON public.learning_insights
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));
REVOKE ALL ON TABLE public.learning_insights FROM authenticated;
GRANT SELECT ON TABLE public.learning_insights TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_learning_insights(
  p_profile_id uuid,
  p_records jsonb,
  p_generated_at timestamptz DEFAULT clock_timestamp()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_count integer:=0;
BEGIN
  IF p_profile_id IS NULL OR p_records IS NULL OR jsonb_typeof(p_records)<>'array' THEN
    RAISE EXCEPTION 'LEARNING_REFRESH_INPUT_INVALID' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_records) AS record(
      profile_id uuid,dimension text,dimension_value text,sample_size integer,
      total_scorable_samples integer,baseline_score double precision,
      segment_score double precision,uplift_pct double precision,confidence text,
      recommendation text,metric_basis text,observed_from timestamptz,
      observed_to timestamptz,generated_at timestamptz,active boolean
    )
    WHERE record.profile_id<>p_profile_id
      OR record.dimension NOT IN ('PROVIDER','FORMAT','TOPIC','WEEKDAY','HOUR')
      OR record.confidence NOT IN ('LOW','MEDIUM','HIGH')
      OR record.sample_size<2 OR record.total_scorable_samples<record.sample_size
      OR record.uplift_pct<5 OR record.recommendation IS NULL
  ) THEN
    RAISE EXCEPTION 'LEARNING_REFRESH_RECORD_INVALID' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('learning:'||p_profile_id::text,0));
  UPDATE public.learning_insights SET active=false,applied_at=p_generated_at
  WHERE profile_id=p_profile_id AND active=true;

  INSERT INTO public.learning_insights(
    scope,insight,evidence,recommended_action,applied_at,created_at,
    profile_id,dimension,dimension_value,sample_size,total_scorable_samples,
    baseline_score,segment_score,uplift_pct,confidence,recommendation,metric_basis,
    observed_from,observed_to,generated_at,active
  )
  SELECT record.dimension,record.recommendation,
    jsonb_build_object(
      'sampleSize',record.sample_size,
      'totalScorableSamples',record.total_scorable_samples,
      'baselineScore',record.baseline_score,
      'segmentScore',record.segment_score,
      'upliftPct',record.uplift_pct,
      'metricBasis',record.metric_basis,
      'observedFrom',record.observed_from,
      'observedTo',record.observed_to
    ),
    jsonb_build_object(
      'dimension',record.dimension,
      'value',record.dimension_value,
      'recommendation',record.recommendation
    ),
    NULL,p_generated_at,
    p_profile_id,record.dimension,record.dimension_value,record.sample_size,
    record.total_scorable_samples,record.baseline_score,record.segment_score,
    record.uplift_pct,record.confidence,record.recommendation,record.metric_basis,
    record.observed_from,record.observed_to,p_generated_at,true
  FROM jsonb_to_recordset(p_records) AS record(
    profile_id uuid,dimension text,dimension_value text,sample_size integer,
    total_scorable_samples integer,baseline_score double precision,
    segment_score double precision,uplift_pct double precision,confidence text,
    recommendation text,metric_basis text,observed_from timestamptz,
    observed_to timestamptz,generated_at timestamptz,active boolean
  )
  ON CONFLICT(profile_id,dimension,dimension_value)
    WHERE dimension IS NOT NULL AND dimension_value IS NOT NULL
  DO UPDATE SET
    scope=excluded.scope,
    insight=excluded.insight,
    evidence=excluded.evidence,
    recommended_action=excluded.recommended_action,
    applied_at=NULL,
    created_at=excluded.created_at,
    sample_size=excluded.sample_size,
    total_scorable_samples=excluded.total_scorable_samples,
    baseline_score=excluded.baseline_score,
    segment_score=excluded.segment_score,
    uplift_pct=excluded.uplift_pct,
    confidence=excluded.confidence,
    recommendation=excluded.recommendation,
    metric_basis=excluded.metric_basis,
    observed_from=excluded.observed_from,
    observed_to=excluded.observed_to,
    generated_at=excluded.generated_at,
    active=true;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_learning_insights(uuid,jsonb,timestamptz)
  FROM PUBLIC,authenticated;

COMMIT;
