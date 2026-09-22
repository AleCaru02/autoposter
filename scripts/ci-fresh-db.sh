#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C

: "${DATABASE_URL:?DATABASE_URL is required}"

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE anonymous NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '') $$;

CREATE SCHEMA neon_auth;
CREATE TABLE neon_auth."user" (
  id text PRIMARY KEY,
  email text,
  name text,
  role text NOT NULL DEFAULT 'user',
  banned boolean NOT NULL DEFAULT false,
  "banExpires" timestamptz
);
SQL

for migration in db/migrations/*.sql; do
  echo "::group::Applying ${migration}"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "${migration}"
  echo "::endgroup::"
done

psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 <<'SQL'
DO $assertions$
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.profile_entitlements') IS NULL
     OR to_regclass('public.capability_usage_events') IS NULL
     OR to_regclass('public.capability_usage_buckets') IS NULL THEN
    RAISE EXCEPTION 'FRESH_DB_REQUIRED_TABLE_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='id'
      AND data_type='uuid' AND is_nullable='NO'
  ) THEN
    RAISE EXCEPTION 'FRESH_DB_CANONICAL_PROFILE_ID_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles' AND column_name='locale'
      AND data_type='text' AND is_nullable='NO'
      AND column_default = '''it-IT''::text'
  ) THEN
    RAISE EXCEPTION 'FRESH_DB_PROFILE_LOCALE_CONTRACT_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='publication_attempts'
      AND column_name IN ('profile_id','provider')
  ) THEN
    RAISE EXCEPTION 'FRESH_DB_PUBLICATION_ATTEMPT_TENANT_DUPLICATION';
  END IF;

  IF (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='publication_attempts'
      AND column_name IN ('claim_token','request_started_at','error_code','error_message','provider_request_id')
  ) <> 5 THEN
    RAISE EXCEPTION 'FRESH_DB_PUBLICATION_ATTEMPT_F7F_COLUMNS_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='profile_entitlements'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'FRESH_DB_ENTITLEMENT_RLS_MISSING';
  END IF;

  IF to_regprocedure('public.current_app_user_id()') IS NULL
     OR to_regprocedure('public.owns_profile(uuid)') IS NULL
     OR to_regprocedure('public.reserve_capability_usage(uuid,text,numeric,numeric,timestamp with time zone,timestamp with time zone,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'FRESH_DB_REQUIRED_FUNCTION_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='publication_attempts'
      AND policyname='publication_attempts_bootstrap_owner'
      AND coalesce(qual,'') LIKE '%publication_jobs%'
  ) THEN
    RAISE EXCEPTION 'FRESH_DB_PUBLICATION_ATTEMPT_TENANT_POLICY_MISSING';
  END IF;
END
$assertions$;

SELECT 'FRESH_DB_CI_PASS' AS result;
SQL
