BEGIN;

ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS content_id uuid NULL REFERENCES public.content_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider text NULL,
  ADD COLUMN IF NOT EXISTS model text NULL,
  ADD COLUMN IF NOT EXISTS cost_eur numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS width integer NULL,
  ADD COLUMN IF NOT EXISTS height integer NULL,
  ADD COLUMN IF NOT EXISTS format text NULL,
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS publication_usage integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reuse_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS content_hash text NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_provider_check;
ALTER TABLE public.assets
  ADD CONSTRAINT assets_provider_check
  CHECK (provider IS NULL OR provider IN ('REAL_ASSET','OPENAI','HIGGSFIELD'));

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_cost_check;
ALTER TABLE public.assets
  ADD CONSTRAINT assets_cost_check CHECK (cost_eur >= 0);

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_dimensions_check;
ALTER TABLE public.assets
  ADD CONSTRAINT assets_dimensions_check
  CHECK ((width IS NULL OR width > 0) AND (height IS NULL OR height > 0));

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_quality_status_check;
ALTER TABLE public.assets
  ADD CONSTRAINT assets_quality_status_check
  CHECK (quality_status IN ('PENDING','PASS','BLOCK','FAILED'));

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_identity_status_check;
ALTER TABLE public.assets
  ADD CONSTRAINT assets_identity_status_check
  CHECK (identity_status IN ('NOT_REQUIRED','PENDING','PASS','BLOCK'));

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_usage_check;
ALTER TABLE public.assets
  ADD CONSTRAINT assets_usage_check
  CHECK (publication_usage >= 0 AND reuse_count >= 0);

UPDATE public.assets
SET
  provider = CASE
    WHEN provider IS NOT NULL THEN provider
    WHEN upper(coalesce(metadata->>'provider','')) = 'OPENAI' THEN 'OPENAI'
    WHEN upper(coalesce(metadata->>'provider','')) = 'HIGGSFIELD' THEN 'HIGGSFIELD'
    WHEN source NOT ILIKE '%AI%' THEN 'REAL_ASSET'
    ELSE NULL
  END,
  model = coalesce(model, nullif(metadata->>'model','')),
  format = coalesce(format, nullif(metadata->>'aspect_ratio','')),
  updated_at = coalesce(updated_at, created_at);

CREATE INDEX IF NOT EXISTS assets_profile_created_idx
  ON public.assets(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS assets_profile_provider_idx
  ON public.assets(profile_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS assets_profile_content_idx
  ON public.assets(profile_id, content_id, created_at DESC);

CREATE INDEX IF NOT EXISTS assets_profile_quality_idx
  ON public.assets(profile_id, quality_status, identity_status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS assets_profile_content_hash_uidx
  ON public.assets(profile_id, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.track_asset_publication_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $
DECLARE v_asset_id uuid;
BEGIN
  IF NEW.state='PUBLISHED' AND OLD.state IS DISTINCT FROM 'PUBLISHED' THEN
    SELECT cv.image_asset_id INTO v_asset_id
    FROM public.content_variants cv
    WHERE cv.id=NEW.variant_id AND cv.profile_id=NEW.profile_id;
    IF v_asset_id IS NOT NULL THEN
      UPDATE public.assets
      SET publication_usage=publication_usage+1,last_used_at=coalesce(NEW.published_at,now()),updated_at=now()
      WHERE id=v_asset_id AND profile_id=NEW.profile_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS publication_asset_usage ON public.publication_jobs;
CREATE TRIGGER publication_asset_usage
AFTER UPDATE OF state ON public.publication_jobs
FOR EACH ROW EXECUTE FUNCTION public.track_asset_publication_usage();

REVOKE ALL ON FUNCTION public.track_asset_publication_usage() FROM PUBLIC,authenticated;

COMMIT;
