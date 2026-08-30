-- Post Automatici — owner membership contract
-- 2026-08-30
-- Source of truth: profile creation is client-visible only on public.profiles;
-- database triggers derive the authenticated owner and create profile_members atomically.

BEGIN;

-- Refuse to invent ownership. Existing owner_auth_user_id values must resolve to
-- real Neon Auth identities, and any pre-existing ownership relation must agree.
DO $migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    LEFT JOIN neon_auth.user nu ON nu.id::text = p.owner_auth_user_id
    WHERE nu.id IS NULL
  ) THEN
    RAISE EXCEPTION 'OWNER_AUTH_MAPPING_UNSAFE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.app_users au ON au.id = p.owner_user_id
    WHERE au.auth_user_id IS DISTINCT FROM p.owner_auth_user_id
  ) THEN
    RAISE EXCEPTION 'OWNER_USER_MAPPING_CONFLICT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.profile_members pm ON pm.profile_id = p.id AND upper(pm.role) = 'OWNER'
    JOIN public.app_users au ON au.id = pm.user_id
    WHERE au.auth_user_id IS DISTINCT FROM p.owner_auth_user_id
  ) THEN
    RAISE EXCEPTION 'OWNER_MEMBERSHIP_CONFLICT';
  END IF;
END
$migration_guard$;

-- Create only the internal app-user identity that can be derived exactly from
-- a verified Neon Auth identity. No PII is invented or copied.
INSERT INTO public.app_users (auth_user_id)
SELECT DISTINCT p.owner_auth_user_id
FROM public.profiles p
JOIN neon_auth.user nu ON nu.id::text = p.owner_auth_user_id
ON CONFLICT (auth_user_id) DO NOTHING;

-- Normalize the legacy nullable owner_user_id using the unique auth_user_id map.
UPDATE public.profiles p
SET owner_user_id = au.id
FROM public.app_users au
WHERE au.auth_user_id = p.owner_auth_user_id
  AND p.owner_user_id IS DISTINCT FROM au.id;

-- Refuse to overwrite a pre-existing non-OWNER membership for the exact owner.
DO $membership_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.app_users au ON au.auth_user_id = p.owner_auth_user_id
    JOIN public.profile_members pm ON pm.profile_id = p.id AND pm.user_id = au.id
    WHERE upper(pm.role) <> 'OWNER'
  ) THEN
    RAISE EXCEPTION 'OWNER_ROLE_CONFLICT';
  END IF;
END
$membership_guard$;

INSERT INTO public.profile_members (profile_id, user_id, role)
SELECT p.id, p.owner_user_id, 'OWNER'
FROM public.profiles p
WHERE p.owner_user_id IS NOT NULL
ON CONFLICT (profile_id, user_id) DO NOTHING;

-- Every existing profile must now have exactly one OWNER membership.
DO $post_backfill_guard$
BEGIN
  IF EXISTS (
    SELECT p.id
    FROM public.profiles p
    LEFT JOIN public.profile_members pm ON pm.profile_id = p.id AND upper(pm.role) = 'OWNER'
    GROUP BY p.id
    HAVING count(pm.user_id) <> 1
  ) THEN
    RAISE EXCEPTION 'OWNER_BACKFILL_INCOMPLETE';
  END IF;
END
$post_backfill_guard$;

ALTER TABLE public.profiles ALTER COLUMN owner_user_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT au.id
  FROM public.app_users au
  WHERE au.auth_user_id = public.current_auth_user_id()
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.sync_profile_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  request_auth_user_id text;
  resolved_app_user_id uuid;
BEGIN
  IF NEW.owner_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'PROFILE_OWNER_REQUIRED' USING ERRCODE = '42501';
  END IF;

  request_auth_user_id := public.current_auth_user_id();
  IF request_auth_user_id IS NOT NULL
     AND NEW.owner_auth_user_id IS DISTINCT FROM request_auth_user_id THEN
    RAISE EXCEPTION 'PROFILE_OWNER_IDENTITY_MISMATCH' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM neon_auth.user nu WHERE nu.id::text = NEW.owner_auth_user_id
  ) THEN
    RAISE EXCEPTION 'PROFILE_OWNER_AUTH_IDENTITY_UNKNOWN' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.app_users (auth_user_id)
  VALUES (NEW.owner_auth_user_id)
  ON CONFLICT (auth_user_id) DO NOTHING;

  SELECT au.id
  INTO resolved_app_user_id
  FROM public.app_users au
  WHERE au.auth_user_id = NEW.owner_auth_user_id;

  IF resolved_app_user_id IS NULL THEN
    RAISE EXCEPTION 'PROFILE_OWNER_APP_USER_MISSING';
  END IF;

  IF TG_WHEN = 'BEFORE' THEN
    -- Ignore any client-supplied owner_user_id and derive it server-side.
    NEW.owner_user_id := resolved_app_user_id;
    RETURN NEW;
  END IF;

  -- AFTER INSERT: profile FK now exists, so create exactly one OWNER relation.
  INSERT INTO public.profile_members (profile_id, user_id, role)
  VALUES (NEW.id, resolved_app_user_id, 'OWNER')
  ON CONFLICT (profile_id, user_id) DO NOTHING;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS profiles_owner_prepare ON public.profiles;
CREATE TRIGGER profiles_owner_prepare
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_owner_membership();

DROP TRIGGER IF EXISTS profiles_owner_membership ON public.profiles;
CREATE TRIGGER profiles_owner_membership
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_owner_membership();

-- Keep profile ownership fields coherent on every customer-side write.
DROP POLICY IF EXISTS profiles_owner_isolation ON public.profiles;
CREATE POLICY profiles_owner_isolation
ON public.profiles
FOR ALL
USING (owner_auth_user_id = public.current_auth_user_id())
WITH CHECK (
  owner_auth_user_id = public.current_auth_user_id()
  AND owner_user_id = public.current_app_user_id()
);

-- CUSTOMERs may inspect their membership, but membership administration is no
-- longer writable through the Data API. Future admin operations must be explicit
-- server-side procedures, not direct customer writes.
DROP POLICY IF EXISTS profile_members_isolation ON public.profile_members;
DROP POLICY IF EXISTS profile_members_owner_read ON public.profile_members;
CREATE POLICY profile_members_owner_read
ON public.profile_members
FOR SELECT
USING (public.owns_profile(profile_id));

COMMIT;
