-- FASE 7J — profile deletion remains unavailable until a privileged,
-- dependency-aware retention workflow exists. Prevent direct customer deletes.

BEGIN;

DROP POLICY IF EXISTS profiles_owner_delete ON public.profiles;
REVOKE DELETE ON TABLE public.profiles FROM authenticated;

COMMIT;
