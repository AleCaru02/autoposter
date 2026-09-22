-- User-confirmed brand context complements website-derived intelligence.
-- It is profile-scoped, protected by the existing brand_profiles RLS policies,
-- and is preserved when the website is re-analyzed.

BEGIN;

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS user_context text;

ALTER TABLE public.brand_profiles
  DROP CONSTRAINT IF EXISTS brand_profiles_user_context_length;

ALTER TABLE public.brand_profiles
  ADD CONSTRAINT brand_profiles_user_context_length
  CHECK (user_context IS NULL OR char_length(user_context) <= 5000);

COMMIT;
