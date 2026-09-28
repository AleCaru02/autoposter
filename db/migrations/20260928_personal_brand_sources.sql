-- Post Automatici — FASE 5 Personal Brand Sources
-- Explicit, same-owner source authorization + content provenance enforcement.

BEGIN;

CREATE TABLE IF NOT EXISTS public.personal_brand_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  personal_brand_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  pillar text NOT NULL,
  allowed_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_claims jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_ctas jsonb NOT NULL DEFAULT '[]'::jsonb,
  asset_policy text NOT NULL DEFAULT 'REFERENCE_ONLY',
  weight numeric(8,3) NOT NULL DEFAULT 1,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_brand_sources_distinct_profiles CHECK (personal_brand_profile_id <> source_profile_id),
  CONSTRAINT personal_brand_sources_pillar_nonempty CHECK (btrim(pillar) <> ''),
  CONSTRAINT personal_brand_sources_allowed_topics_array CHECK (jsonb_typeof(allowed_topics) = 'array'),
  CONSTRAINT personal_brand_sources_allowed_claims_array CHECK (jsonb_typeof(allowed_claims) = 'array'),
  CONSTRAINT personal_brand_sources_allowed_ctas_array CHECK (jsonb_typeof(allowed_ctas) = 'array'),
  CONSTRAINT personal_brand_sources_asset_policy_check CHECK (asset_policy IN ('NO_ASSETS','REFERENCE_ONLY','REUSE_APPROVED')),
  CONSTRAINT personal_brand_sources_weight_check CHECK (weight > 0 AND weight <= 100),
  CONSTRAINT personal_brand_sources_priority_check CHECK (priority >= 0 AND priority <= 10000),
  UNIQUE (personal_brand_profile_id, source_profile_id, pillar)
);

CREATE INDEX IF NOT EXISTS personal_brand_sources_target_enabled_idx
  ON public.personal_brand_sources(personal_brand_profile_id, enabled, priority, weight DESC);
CREATE INDEX IF NOT EXISTS personal_brand_sources_source_idx
  ON public.personal_brand_sources(source_profile_id);

CREATE OR REPLACE FUNCTION public.validate_personal_brand_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pb_type text;
  pb_owner text;
  source_type text;
  source_owner text;
  source_archived timestamptz;
BEGIN
  SELECT profile_type, owner_auth_user_id
  INTO pb_type, pb_owner
  FROM public.profiles
  WHERE id = NEW.personal_brand_profile_id;

  SELECT profile_type, owner_auth_user_id, archived_at
  INTO source_type, source_owner, source_archived
  FROM public.profiles
  WHERE id = NEW.source_profile_id;

  IF pb_type IS DISTINCT FROM 'PERSONAL_BRAND' THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_SOURCE_TARGET_INVALID' USING ERRCODE = '23514';
  END IF;
  IF source_type IS DISTINCT FROM 'BUSINESS' THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_SOURCE_MUST_BE_BUSINESS' USING ERRCODE = '23514';
  END IF;
  IF pb_owner IS NULL OR source_owner IS NULL OR pb_owner IS DISTINCT FROM source_owner THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_SOURCE_OWNER_MISMATCH' USING ERRCODE = '42501';
  END IF;
  IF source_archived IS NOT NULL THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_SOURCE_ARCHIVED' USING ERRCODE = '23514';
  END IF;

  NEW.pillar := btrim(NEW.pillar);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personal_brand_sources_validate ON public.personal_brand_sources;
CREATE TRIGGER personal_brand_sources_validate
BEFORE INSERT OR UPDATE ON public.personal_brand_sources
FOR EACH ROW EXECUTE FUNCTION public.validate_personal_brand_source();

ALTER TABLE public.personal_brand_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_brand_sources FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS personal_brand_sources_owner_select ON public.personal_brand_sources;
CREATE POLICY personal_brand_sources_owner_select
ON public.personal_brand_sources
FOR SELECT TO authenticated
USING (
  public.owns_profile(personal_brand_profile_id)
  AND public.owns_profile(source_profile_id)
);

DROP POLICY IF EXISTS personal_brand_sources_owner_insert ON public.personal_brand_sources;
CREATE POLICY personal_brand_sources_owner_insert
ON public.personal_brand_sources
FOR INSERT TO authenticated
WITH CHECK (
  public.owns_profile(personal_brand_profile_id)
  AND public.owns_profile(source_profile_id)
);

DROP POLICY IF EXISTS personal_brand_sources_owner_update ON public.personal_brand_sources;
CREATE POLICY personal_brand_sources_owner_update
ON public.personal_brand_sources
FOR UPDATE TO authenticated
USING (
  public.owns_profile(personal_brand_profile_id)
  AND public.owns_profile(source_profile_id)
)
WITH CHECK (
  public.owns_profile(personal_brand_profile_id)
  AND public.owns_profile(source_profile_id)
);

DROP POLICY IF EXISTS personal_brand_sources_owner_delete ON public.personal_brand_sources;
CREATE POLICY personal_brand_sources_owner_delete
ON public.personal_brand_sources
FOR DELETE TO authenticated
USING (
  public.owns_profile(personal_brand_profile_id)
  AND public.owns_profile(source_profile_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.personal_brand_sources TO authenticated;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS pillar text NULL,
  ADD COLUMN IF NOT EXISTS source_profile_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_profile_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fact_provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS editorial_cta text NULL,
  ADD COLUMN IF NOT EXISTS source_mix_approved boolean NOT NULL DEFAULT false;

ALTER TABLE public.content_items
  DROP CONSTRAINT IF EXISTS content_items_source_refs_array,
  DROP CONSTRAINT IF EXISTS content_items_audience_object,
  DROP CONSTRAINT IF EXISTS content_items_fact_provenance_array;

ALTER TABLE public.content_items
  ADD CONSTRAINT content_items_source_refs_array CHECK (jsonb_typeof(source_refs) = 'array'),
  ADD CONSTRAINT content_items_audience_object CHECK (jsonb_typeof(audience) = 'object'),
  ADD CONSTRAINT content_items_fact_provenance_array CHECK (jsonb_typeof(fact_provenance) = 'array');

CREATE INDEX IF NOT EXISTS content_items_source_profile_idx
  ON public.content_items(source_profile_id)
  WHERE source_profile_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_personal_brand_content_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  content_profile_type text;
  source_id uuid;
  source_count integer;
BEGIN
  SELECT profile_type INTO content_profile_type
  FROM public.profiles
  WHERE id = NEW.profile_id;

  IF content_profile_type IS DISTINCT FROM 'PERSONAL_BRAND' THEN
    RETURN NEW;
  END IF;

  IF NEW.pillar IS NULL OR btrim(NEW.pillar) = '' THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_CONTENT_PILLAR_REQUIRED' USING ERRCODE = '23514';
  END IF;
  NEW.pillar := btrim(NEW.pillar);

  IF NEW.objective IS NULL OR btrim(NEW.objective) = '' THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_CONTENT_OBJECTIVE_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF NEW.editorial_cta IS NULL OR btrim(NEW.editorial_cta) = '' THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_CONTENT_CTA_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF NEW.audience = '{}'::jsonb THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_CONTENT_AUDIENCE_REQUIRED' USING ERRCODE = '23514';
  END IF;

  IF NEW.source_profile_id IS NOT NULL AND NOT (NEW.source_profile_id = ANY(NEW.source_profile_ids)) THEN
    NEW.source_profile_ids := array_append(NEW.source_profile_ids, NEW.source_profile_id);
  END IF;

  SELECT count(DISTINCT x) INTO source_count
  FROM unnest(NEW.source_profile_ids) AS x;

  IF source_count > 1 AND NOT NEW.source_mix_approved THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_SOURCE_MIX_REQUIRES_APPROVAL' USING ERRCODE = '23514';
  END IF;

  FOREACH source_id IN ARRAY NEW.source_profile_ids LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM public.personal_brand_sources s
      WHERE s.personal_brand_profile_id = NEW.profile_id
        AND s.source_profile_id = source_id
        AND s.enabled = true
        AND s.pillar = NEW.pillar
    ) THEN
      RAISE EXCEPTION 'PERSONAL_BRAND_SOURCE_NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF source_count > 0 AND jsonb_array_length(NEW.source_refs) = 0 THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_CONTENT_SOURCES_REQUIRED' USING ERRCODE = '23514';
  END IF;
  IF source_count > 0 AND jsonb_array_length(NEW.fact_provenance) = 0 THEN
    RAISE EXCEPTION 'PERSONAL_BRAND_CONTENT_PROVENANCE_REQUIRED' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_items_personal_brand_provenance ON public.content_items;
CREATE TRIGGER content_items_personal_brand_provenance
BEFORE INSERT OR UPDATE OF profile_id, pillar, objective, source_profile_id, source_profile_ids, source_refs, audience, fact_provenance, editorial_cta, source_mix_approved
ON public.content_items
FOR EACH ROW EXECUTE FUNCTION public.validate_personal_brand_content_provenance();

COMMIT;
