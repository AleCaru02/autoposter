-- FASE 7B — one provider exchange/discovery sequence per signed OAuth state.
-- Server-owned: customer roles cannot inspect callback state or results.

BEGIN;

CREATE TABLE IF NOT EXISTS public.social_oauth_callbacks (
  nonce text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'GBP')),
  status text NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_oauth_callbacks_expiry_idx
  ON public.social_oauth_callbacks(expires_at);

ALTER TABLE public.social_oauth_callbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_oauth_callbacks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_oauth_callbacks FROM PUBLIC, authenticated;

COMMIT;
