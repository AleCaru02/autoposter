-- Post Automatici — canonical fresh-database bootstrap.
-- Reconstructs the minimum application schema that historically existed before
-- the dated migrations in this directory. Later migrations remain authoritative
-- for their own policies, indexes, triggers, functions and feature columns.
--
-- Fresh order:
--   Better Auth / auth.user_id() ready
--   -> this bootstrap
--   -> dated migrations in filename order
--
-- Keep this file additive/idempotent and billing-provider independent.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_auth_user_id text NOT NULL,
  owner_user_id uuid NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug text NOT NULL,
  website_url text NULL,
  industry text NULL,
  timezone text NOT NULL DEFAULT 'Europe/Rome',
  onboarding_completed boolean NOT NULL DEFAULT false,
  archived_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_auth_user_id, slug)
);

CREATE TABLE IF NOT EXISTS public.profile_members (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'MEMBER',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.brand_profiles (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  description text NULL,
  business_model text NULL,
  location text NULL,
  service_area text NULL,
  target_audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  tone_of_voice jsonb NOT NULL DEFAULT '{}'::jsonb,
  visual_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  services jsonb NOT NULL DEFAULT '[]'::jsonb,
  differentiators jsonb NOT NULL DEFAULT '[]'::jsonb,
  value_propositions jsonb NOT NULL DEFAULT '[]'::jsonb,
  goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.website_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  root_url text NOT NULL,
  state text NOT NULL DEFAULT 'RUNNING',
  page_limit integer NOT NULL DEFAULT 50,
  max_depth integer NOT NULL DEFAULT 12,
  discovered_pages integer NOT NULL DEFAULT 0,
  analyzed_pages integer NOT NULL DEFAULT 0,
  skipped_pages integer NOT NULL DEFAULT 0,
  failed_pages integer NOT NULL DEFAULT 0,
  started_at timestamptz NULL,
  last_progress_at timestamptz NULL,
  finished_at timestamptz NULL,
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.website_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.website_scans(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  url text NOT NULL,
  normalized_url text NOT NULL,
  status text NOT NULL DEFAULT 'DISCOVERED',
  depth integer NOT NULL DEFAULT 0,
  title text NULL,
  meta_description text NULL,
  content_text text NULL,
  content_hash text NULL,
  discovered_from text NULL,
  skip_reason text NULL,
  error text NULL,
  scanned_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, normalized_url)
);

CREATE TABLE IF NOT EXISTS public.content_strategies (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  platform_strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source text NOT NULL,
  kind text NOT NULL,
  name text NOT NULL,
  storage_url text NOT NULL,
  mime_type text NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  topic text NOT NULL,
  objective text NULL,
  title text NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL,
  format text NOT NULL,
  eligible boolean NOT NULL DEFAULT true,
  hook text NULL,
  caption text NULL,
  cta text NULL,
  hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
  visual_brief text NULL,
  image_asset_id uuid NULL REFERENCES public.assets(id) ON DELETE SET NULL,
  alt_text text NULL,
  approval_status text NOT NULL DEFAULT 'PENDING',
  external_post_id text NULL,
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'DISCONNECTED',
  provider_account_id text NULL,
  account_name text NULL,
  token_reference text NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_validated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, provider)
);

CREATE TABLE IF NOT EXISTS public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Rome',
  posts_per_week integer NOT NULL DEFAULT 0,
  preferred_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  auto_choose boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.publication_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.content_variants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  state text NOT NULL DEFAULT 'BLOCKED_APPROVAL',
  scheduled_at timestamptz NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0,
  locked_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.publication_jobs(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL,
  state text NOT NULL DEFAULT 'CLAIMED',
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  UNIQUE (job_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation text NOT NULL,
  model text NOT NULL,
  input_tokens integer NULL,
  output_tokens integer NULL,
  cost_usd numeric NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_auth_user_id text NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Legacy learning shape consumed by the later canonical learning migrations.
-- 20260829 adds the metrics-oriented fields; 20260917 backfills them from these
-- historical columns before locking the real learning runtime contract.
CREATE TABLE IF NOT EXISTS public.learning_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope text NOT NULL,
  insight text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_action jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FASE 4B grants sort before the FASE 4B foundation file. These three source
-- tables therefore belong to the canonical baseline. Only their structural
-- contract is bootstrapped here; FASE 4B remains authoritative for its indexes,
-- RLS read policies, reservation functions, revokes and bootstrap trigger.
CREATE TABLE IF NOT EXISTS public.profile_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  limit_type text NOT NULL,
  limit_value numeric NULL,
  period_type text NOT NULL DEFAULT 'NONE',
  source text NOT NULL DEFAULT 'INTERNAL_BASELINE',
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_entitlements_limit_type_check CHECK (limit_type IN (
    'BOOLEAN','COUNT_PER_DAY','COUNT_PER_MONTH','CONCURRENT','MAX_CONNECTED_ACCOUNTS','STORAGE','SEATS','UNLIMITED','NOT_APPLICABLE'
  )),
  CONSTRAINT profile_entitlements_period_type_check CHECK (period_type IN ('NONE','DAY','MONTH','CUSTOM')),
  CONSTRAINT profile_entitlements_limit_value_check CHECK (limit_value IS NULL OR limit_value >= 0),
  CONSTRAINT profile_entitlements_window_check CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  UNIQUE (profile_id, capability_key)
);

CREATE TABLE IF NOT EXISTS public.capability_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  quantity numeric NOT NULL,
  state text NOT NULL DEFAULT 'RESERVED',
  idempotency_key text NOT NULL,
  source text NOT NULL DEFAULT 'APPLICATION',
  reference_id text NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz NULL,
  released_at timestamptz NULL,
  CONSTRAINT capability_usage_events_quantity_check CHECK (quantity > 0),
  CONSTRAINT capability_usage_events_state_check CHECK (state IN ('RESERVED','COMMITTED','RELEASED')),
  CONSTRAINT capability_usage_events_period_check CHECK (period_end > period_start),
  UNIQUE (profile_id, capability_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.capability_usage_buckets (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  capability_key text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  reserved_quantity numeric NOT NULL DEFAULT 0,
  committed_quantity numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capability_usage_buckets_nonnegative_check CHECK (reserved_quantity >= 0 AND committed_quantity >= 0),
  CONSTRAINT capability_usage_buckets_period_check CHECK (period_end > period_start),
  PRIMARY KEY (profile_id, capability_key, period_start, period_end)
);

CREATE OR REPLACE FUNCTION public.current_auth_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.user_id()::text
$function$;

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

CREATE OR REPLACE FUNCTION public.owns_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_profile_id
      AND p.owner_auth_user_id = public.current_auth_user_id()
  )
$function$;

REVOKE ALL ON FUNCTION public.current_auth_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_auth_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_profile(uuid) TO authenticated;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_users_self_read ON public.app_users;
CREATE POLICY app_users_self_read ON public.app_users
  FOR SELECT TO authenticated
  USING (auth_user_id = public.current_auth_user_id());

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_bootstrap_owner ON public.profiles;
CREATE POLICY profiles_bootstrap_owner ON public.profiles
  FOR ALL TO authenticated
  USING (owner_auth_user_id = public.current_auth_user_id())
  WITH CHECK (owner_auth_user_id = public.current_auth_user_id());

ALTER TABLE public.profile_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_members_bootstrap_read ON public.profile_members;
CREATE POLICY profile_members_bootstrap_read ON public.profile_members
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));

DO $tenant_policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'brand_profiles','website_scans','website_pages','content_strategies','assets',
    'content_items','content_variants','social_connections','schedules',
    'publication_jobs','ai_usage_events','audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I_bootstrap_owner ON public.%I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_bootstrap_owner ON public.%I FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id))',
      table_name, table_name
    );
  END LOOP;
END
$tenant_policies$;

ALTER TABLE public.publication_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publication_attempts_bootstrap_owner ON public.publication_attempts;
CREATE POLICY publication_attempts_bootstrap_owner ON public.publication_attempts
  FOR ALL TO authenticated
  USING (
    public.owns_profile((
      SELECT job.profile_id
      FROM public.publication_jobs job
      WHERE job.id = publication_attempts.job_id
    ))
  )
  WITH CHECK (
    public.owns_profile((
      SELECT job.profile_id
      FROM public.publication_jobs job
      WHERE job.id = publication_attempts.job_id
    ))
  );

-- Entitlement/usage baseline is deliberately fail-closed until FASE 4B applies.
ALTER TABLE public.profile_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_entitlements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_buckets FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_users, public.profiles, public.profile_members,
  public.brand_profiles, public.website_scans, public.website_pages,
  public.content_strategies, public.assets, public.content_items, public.content_variants,
  public.social_connections, public.schedules, public.publication_jobs,
  public.publication_attempts, public.ai_usage_events, public.audit_log,
  public.profile_entitlements, public.capability_usage_events, public.capability_usage_buckets
FROM PUBLIC;

DO $anonymous_revoke$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anonymous') THEN
    REVOKE ALL ON TABLE public.app_users, public.profiles, public.profile_members,
      public.brand_profiles, public.website_scans, public.website_pages,
      public.content_strategies, public.assets, public.content_items, public.content_variants,
      public.social_connections, public.schedules, public.publication_jobs,
      public.publication_attempts, public.ai_usage_events, public.audit_log,
      public.profile_entitlements, public.capability_usage_events, public.capability_usage_buckets
    FROM anonymous;
  END IF;
END
$anonymous_revoke$;

GRANT SELECT ON TABLE public.app_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.profile_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.brand_profiles, public.website_scans, public.website_pages,
  public.content_strategies, public.assets, public.content_items, public.content_variants,
  public.social_connections, public.schedules, public.publication_jobs,
  public.publication_attempts, public.ai_usage_events, public.audit_log
TO authenticated;

COMMIT;
