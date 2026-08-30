-- FASE 2 follow-up: keep owner derivation server-side while allowing a brand-new
-- authenticated customer to create their own profile in the same statement that
-- creates app_users/OWNER through the BEFORE/AFTER triggers.
--
-- INSERT only trusts the authenticated owner_auth_user_id. The BEFORE trigger
-- overwrites owner_user_id with the server-resolved app user. UPDATE keeps the
-- stronger owner_user_id invariant so clients cannot transfer ownership.

BEGIN;

DROP POLICY IF EXISTS profiles_owner_isolation ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_select ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_update ON public.profiles;
DROP POLICY IF EXISTS profiles_owner_delete ON public.profiles;

CREATE POLICY profiles_owner_select
ON public.profiles
FOR SELECT
USING (owner_auth_user_id = public.current_auth_user_id());

CREATE POLICY profiles_owner_insert
ON public.profiles
FOR INSERT
WITH CHECK (owner_auth_user_id = public.current_auth_user_id());

CREATE POLICY profiles_owner_update
ON public.profiles
FOR UPDATE
USING (owner_auth_user_id = public.current_auth_user_id())
WITH CHECK (
  owner_auth_user_id = public.current_auth_user_id()
  AND owner_user_id = public.current_app_user_id()
);

CREATE POLICY profiles_owner_delete
ON public.profiles
FOR DELETE
USING (owner_auth_user_id = public.current_auth_user_id());

COMMIT;
