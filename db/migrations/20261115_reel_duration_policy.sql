-- Reel duration policy per profile (additive, nullable: NULL = default 20-40 s).
-- A single Reel can still override it at enqueue time (stored in render_jobs.input.duration).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reel_min_seconds smallint,
  ADD COLUMN IF NOT EXISTS reel_max_seconds smallint;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_reel_duration_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_reel_duration_check CHECK (
  (reel_min_seconds IS NULL AND reel_max_seconds IS NULL)
  OR (
    reel_min_seconds BETWEEN 10 AND 85
    AND reel_max_seconds BETWEEN 15 AND 90
    AND reel_max_seconds - reel_min_seconds >= 5
  )
);

COMMENT ON COLUMN public.profiles.reel_min_seconds IS 'Minimum Reel length in seconds for this profile (NULL = default 20).';
COMMENT ON COLUMN public.profiles.reel_max_seconds IS 'Maximum Reel length in seconds for this profile (NULL = default 40).';
