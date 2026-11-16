-- Operational telemetry only: no user secrets, profile identifiers or provider tokens stored.
-- Server-only table; cron heartbeats allow monitoring of the actual scheduler.
CREATE TABLE IF NOT EXISTS public.ops_cron_heartbeats (
  job_name text PRIMARY KEY CHECK (job_name IN ('content','social','render')),
  last_success_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ops_cron_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_cron_heartbeats FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ops_cron_heartbeats FROM PUBLIC;
DO $roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.ops_cron_heartbeats FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anonymous') THEN
    REVOKE ALL ON public.ops_cron_heartbeats FROM anonymous;
  END IF;
END $roles$;
