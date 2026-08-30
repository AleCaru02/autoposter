-- Post Automatici — FASE 3 platform admin audit
-- 2026-08-30
-- Global platform audit is intentionally separate from tenant/workspace roles.

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_auth_user_id text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_admin_audit_created_at_idx
  ON public.platform_admin_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS platform_admin_audit_actor_idx
  ON public.platform_admin_audit (actor_auth_user_id, created_at DESC);

ALTER TABLE public.platform_admin_audit ENABLE ROW LEVEL SECURITY;

-- There are deliberately no CUSTOMER policies. Only the server-side database
-- connection behind requireSuperAdmin() may read/write this global audit table.
REVOKE ALL ON TABLE public.platform_admin_audit FROM PUBLIC;
DO $revoke_roles$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anonymous') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.platform_admin_audit FROM anonymous';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.platform_admin_audit FROM authenticated';
  END IF;
END
$revoke_roles$;

COMMIT;
