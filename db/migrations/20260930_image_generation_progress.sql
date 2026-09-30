BEGIN;

CREATE TABLE IF NOT EXISTS public.image_generation_operations (
  operation_id text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content_variant_id uuid NULL REFERENCES public.content_variants(id) ON DELETE CASCADE,
  carousel_slide_id uuid NULL REFERENCES public.content_carousel_slides(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'RUNNING',
  phase text NOT NULL DEFAULT 'VALIDATING',
  progress integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  asset_id uuid NULL REFERENCES public.assets(id) ON DELETE SET NULL,
  error_code text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT image_generation_operations_state_check CHECK (state IN ('RUNNING','COMPLETED','FAILED')),
  CONSTRAINT image_generation_operations_progress_check CHECK (progress BETWEEN 0 AND 100),
  CONSTRAINT image_generation_operations_id_check CHECK (operation_id ~ '^[A-Za-z0-9._:-]{16,128}$')
);

CREATE INDEX IF NOT EXISTS image_generation_operations_profile_updated_idx
  ON public.image_generation_operations(profile_id, updated_at DESC);

ALTER TABLE public.image_generation_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_generation_operations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS image_generation_operations_owner ON public.image_generation_operations;
CREATE POLICY image_generation_operations_owner ON public.image_generation_operations
  FOR ALL TO authenticated
  USING (public.owns_profile(profile_id))
  WITH CHECK (public.owns_profile(profile_id));

REVOKE ALL ON TABLE public.image_generation_operations FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.image_generation_operations TO authenticated;

COMMIT;
