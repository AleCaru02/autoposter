-- Recovery schema drift — persist the locale contract already consumed by
-- dashboard/profile loading, Settings and onboarding provisioning.
-- Idempotent so it is safe on recovery databases where the column may already
-- exist from an emergency repair.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale text;

UPDATE public.profiles
SET locale = 'it-IT'
WHERE locale IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN locale SET DEFAULT 'it-IT';

ALTER TABLE public.profiles
  ALTER COLUMN locale SET NOT NULL;

COMMIT;
