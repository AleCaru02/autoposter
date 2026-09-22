-- Canonical bootstrap for Post Automatici.
-- This file defines the minimum schema that existed before the chronological
-- db/migrations chain. Later migrations remain authoritative for later features.
-- Safe for a fresh Neon/Postgres database after Neon Auth/Data API provisioning.

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
  owner_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
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
CREATE INDEX IF NOT EXISTS profiles_owner_auth_idx
  ON public.profiles(owner_auth_user_id);

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
CREATE INDEX IF NOT EXISTS website_scans_profile_created_idx
  ON public.website_scans(profile_id, created_at DESC);

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
CREATE INDEX IF NOT EXISTS website_pages_profile_scan_idx
  ON public.website_pages(profile_id, scan_id);

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
CREATE INDEX IF NOT EXISTS content_items_profile_updated_idx
  ON public.content_items(profile_id, updated_at DESC);

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
CREATE INDEX IF NOT EXISTS content_variants_profile_content_idx
  ON public.content_variants(profile_id, content_id);

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
CREATE INDEX IF NOT EXISTS publication_jobs_profile_scheduled_idx
  ON public.publication_jobs(profile_id, scheduled_at);

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

-- Legacy customer-facing learning shape. The structured evidence fields are
-- deliberately added later by 20260829 and 20260917.
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
CREATE INDEX IF NOT EXISTS ai_usage_events_profile_created_idx
  ON public.ai_usage_events(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_auth_user_id text NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FASE 4B preconditions. The migration owns its policies, functions, indexes,
-- grants and bootstrapping behavior; only the canonical table contract lives here.
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
    'BOOLEAN','COUNT_PER_DAY','COUNT_PER_MONTH','CONCURRENT','MAX_CONNECTED_ACCOUNTS',
    'STORAGE','SEATS','UNLIMITED','NOT_APPLICABLE'
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
  CONSTRAINT capability_usage_buckets_nonnegative_check CHECK (
    reserved_quantity >= 0 AND committed_quantity >= 0
  ),
  CONSTRAINT capability_usage_buckets_period_check CHECK (period_end > period_start),
  PRIMARY KEY (profile_id, capability_key, period_start, period_end)
);

CREATE OR REPLACE FUNCTION public.current_auth_user_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT auth.user_id()::text
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT app_user.id
  FROM public.app_users app_user
  WHERE app_user.auth_user_id = public.current_auth_user_id()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.owns_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profile_members member
    WHERE member.profile_id = p_profile_id
      AND member.user_id = public.current_app_user_id()
  )
$$;

REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owns_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_profile(uuid) TO authenticated;

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profile_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_members FORCE ROW LEVEL SECURITY;

CREATE POLICY app_users_self_read ON public.app_users
  FOR SELECT TO authenticated
  USING (auth_user_id = public.current_auth_user_id());

CREATE POLICY profiles_bootstrap_owner ON public.profiles
  FOR ALL TO authenticated
  USING (owner_auth_user_id = public.current_auth_user_id())
  WITH CHECK (owner_auth_user_id = public.current_auth_user_id());

CREATE POLICY profile_members_bootstrap_read ON public.profile_members
  FOR SELECT TO authenticated
  USING (public.owns_profile(profile_id));

GRANT SELECT ON public.app_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT ON public.profile_members TO authenticated;

-- Common tenant tables use one canonical profile ownership boundary.
ALTER TABLE public.brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_scans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.website_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.content_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_strategies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.content_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_variants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.publication_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.publication_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.learning_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_insights FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profile_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_entitlements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capability_usage_buckets FORCE ROW LEVEL SECURITY;

CREATE POLICY brand_profiles_bootstrap_owner ON public.brand_profiles
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY website_scans_bootstrap_owner ON public.website_scans
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY website_pages_bootstrap_owner ON public.website_pages
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY content_strategies_bootstrap_owner ON public.content_strategies
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY assets_bootstrap_owner ON public.assets
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY content_items_bootstrap_owner ON public.content_items
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY content_variants_bootstrap_owner ON public.content_variants
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY social_connections_bootstrap_owner ON public.social_connections
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY schedules_bootstrap_owner ON public.schedules
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY publication_jobs_bootstrap_owner ON public.publication_jobs
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY publication_attempts_bootstrap_owner ON public.publication_attempts
  FOR ALL TO authenticated
  USING (public.owns_profile((SELECT job.profile_id FROM public.publication_jobs job WHERE job.id = job_id)))
  WITH CHECK (public.owns_profile((SELECT job.profile_id FROM public.publication_jobs job WHERE job.id = job_id)));
CREATE POLICY ai_usage_events_bootstrap_owner ON public.ai_usage_events
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));
CREATE POLICY audit_log_bootstrap_owner ON public.audit_log
  FOR ALL TO authenticated USING (public.owns_profile(profile_id)) WITH CHECK (public.owns_profile(profile_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.brand_profiles,
  public.website_scans,
  public.website_pages,
  public.content_strategies,
  public.assets,
  public.content_items,
  public.content_variants,
  public.social_connections,
  public.schedules,
  public.publication_jobs,
  public.publication_attempts,
  public.ai_usage_events,
  public.audit_log
TO authenticated;

GRANT SELECT ON public.learning_insights TO authenticated;

-- No authenticated writes are granted for entitlement/usage ledgers here.
-- FASE 4B grants customer reads and keeps writes server/internal.
