-- Phase 1: website/brand/content/social/publishing/analytics domain tables.
-- Secrets are intentionally kept out of exposed public tables.

create extension if not exists vector;

create table if not exists public.websites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  url text not null,
  normalized_origin text,
  status text not null default 'pending' check (status in ('pending','active','error','disabled')),
  robots_policy jsonb not null default '{}'::jsonb,
  last_scan_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, url)
);

create table if not exists public.website_scans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  website_id uuid not null references public.websites(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','partial','failed','canceled')),
  page_limit integer not null check (page_limit > 0),
  discovered_count integer not null default 0,
  relevant_count integer not null default 0,
  analyzed_count integer not null default 0,
  skipped_count integer not null default 0,
  coverage_note text,
  content_hash text,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.website_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  website_id uuid not null references public.websites(id) on delete cascade,
  scan_id uuid references public.website_scans(id) on delete set null,
  url text not null,
  canonical_url text,
  page_type text,
  title text,
  meta_description text,
  headings jsonb not null default '[]'::jsonb,
  content_text text,
  content_hash text,
  discovered_via text,
  http_status integer,
  is_relevant boolean not null default true,
  skip_reason text,
  metadata jsonb not null default '{}'::jsonb,
  fetched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, website_id, url)
);

create table if not exists public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','review','confirmed')),
  brand_name text,
  description text,
  industry text,
  sub_industry text,
  business_model text,
  location jsonb,
  target jsonb not null default '[]'::jsonb,
  personas jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  products jsonb not null default '[]'::jsonb,
  differentiators jsonb not null default '[]'::jsonb,
  usp text,
  value_propositions jsonb not null default '[]'::jsonb,
  brand_colors jsonb not null default '[]'::jsonb,
  secondary_colors jsonb not null default '[]'::jsonb,
  fonts jsonb not null default '[]'::jsonb,
  visual_style jsonb not null default '{}'::jsonb,
  photo_style jsonb not null default '{}'::jsonb,
  tone_of_voice jsonb not null default '{}'::jsonb,
  vocabulary jsonb not null default '[]'::jsonb,
  banned_words jsonb not null default '[]'::jsonb,
  cta_preferences jsonb not null default '[]'::jsonb,
  claims_allowed jsonb not null default '[]'::jsonb,
  claims_forbidden jsonb not null default '[]'::jsonb,
  topics jsonb not null default '[]'::jsonb,
  urls jsonb not null default '[]'::jsonb,
  social_links jsonb not null default '[]'::jsonb,
  competitors jsonb not null default '[]'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  source_summary jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_profile_locks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  brand_profile_id uuid not null references public.brand_profiles(id) on delete cascade,
  field_path text not null,
  locked_value jsonb,
  locked_by uuid references auth.users(id) on delete set null,
  locked_at timestamptz not null default now(),
  unique (brand_profile_id, field_path)
);

create table if not exists public.brand_context_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  brand_profile_id uuid not null references public.brand_profiles(id) on delete cascade,
  version integer not null,
  context jsonb not null,
  source_hash text not null,
  estimated_tokens integer,
  status text not null default 'active' check (status in ('active','superseded')),
  created_at timestamptz not null default now(),
  unique (brand_profile_id, version)
);

create table if not exists public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text,
  mime_type text,
  bytes bigint check (bytes is null or bytes >= 0),
  width integer,
  height integer,
  tags text[] not null default '{}',
  classification_confidence numeric(5,4),
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, storage_bucket, storage_path)
);

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','linkedin','google_business_profile')),
  connection_status text not null default 'reauth_required' check (connection_status in ('connected','expiring','expired','reauth_required','permission_error','disabled')),
  approval_mode text not null default 'manual' check (approval_mode in ('auto','manual')),
  granted_scopes text[] not null default '{}',
  token_expires_at timestamptz,
  connected_at timestamptz,
  last_checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_connections_tenant_platform_idx on public.social_connections(tenant_id, platform);

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.social_connections(id) on delete cascade,
  platform text not null,
  external_account_id text not null,
  account_type text,
  display_name text,
  username text,
  location_id text,
  is_selected boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_account_id)
);

create table if not exists app_private.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null unique references public.social_connections(id) on delete cascade,
  token_ciphertext bytea not null,
  refresh_token_ciphertext bytea,
  key_version integer not null,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on app_private.integration_credentials from anon, authenticated;

create table if not exists public.telegram_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  status text not null default 'disconnected' check (status in ('disconnected','pending','connected','disabled')),
  telegram_chat_id text,
  telegram_user_id text,
  connected_at timestamptz,
  last_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  website_url text,
  location text,
  status text not null default 'suggested' check (status in ('suggested','accepted','rejected','manual')),
  rationale text,
  public_sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  snapshot jsonb not null,
  content_hash text,
  coverage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.content_strategies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft','confirmed','superseded')),
  objectives jsonb not null default '[]'::jsonb,
  audience jsonb not null default '{}'::jsonb,
  content_mix jsonb not null default '{}'::jsonb,
  platform_strategy jsonb not null default '{}'::jsonb,
  scheduling_preferences jsonb not null default '{}'::jsonb,
  minimum_analytics_sample integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, version)
);

create table if not exists public.content_pillars (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  strategy_id uuid not null references public.content_strategies(id) on delete cascade,
  name text not null,
  description text,
  target_share numeric(5,2),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  pillar_id uuid references public.content_pillars(id) on delete set null,
  topic text not null,
  angle text,
  objective text,
  source_mode text not null default 'evergreen' check (source_mode in ('evergreen','brand_knowledge','web_research','analytics')),
  source_refs jsonb not null default '[]'::jsonb,
  status text not null default 'idea' check (status in ('idea','selected','used','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign text,
  pillar_id uuid references public.content_pillars(id) on delete set null,
  idea_id uuid references public.content_ideas(id) on delete set null,
  topic text not null,
  objective text,
  core_concept jsonb not null default '{}'::jsonb,
  status text not null default 'idea' check (status in ('idea','generating','draft','qa','ready','awaiting_approval','approved','scheduled','publishing','published','failed','rejected','needs_review')),
  fact_confidence text not null default 'unknown' check (fact_confidence in ('confirmed','inferred','unknown')),
  quality_score jsonb not null default '{}'::jsonb,
  prompt_version text,
  generation_version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists posts_tenant_status_created_idx on public.posts(tenant_id, status, created_at desc);

create table if not exists public.post_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  platform text not null check (platform in ('facebook','instagram','linkedin','google_business_profile')),
  platform_decision text not null default 'native_variant' check (platform_decision in ('native_variant','separate_concept','skip')),
  format text,
  hook text,
  caption text,
  cta text,
  hashtags text[] not null default '{}',
  alt_text text,
  visual_brief jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  approval_mode text not null default 'manual' check (approval_mode in ('auto','manual')),
  approval_status text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  status text not null default 'draft',
  external_post_id text,
  generation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, platform)
);
create index if not exists post_variants_schedule_idx on public.post_variants(tenant_id, scheduled_at) where scheduled_at is not null;

create table if not exists public.post_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null references public.post_variants(id) on delete cascade,
  asset_id uuid references public.brand_assets(id) on delete set null,
  source_type text not null check (source_type in ('real_asset','deterministic_graphic','ai_generated')),
  storage_bucket text,
  storage_path text,
  role text not null default 'primary',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.post_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null references public.post_variants(id) on delete cascade,
  approved_by uuid references auth.users(id) on delete set null,
  source text not null check (source in ('web','telegram','system')),
  created_at timestamptz not null default now()
);

create table if not exists public.post_rejections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null references public.post_variants(id) on delete cascade,
  rejected_by uuid references auth.users(id) on delete set null,
  reason text,
  source text not null check (source in ('web','telegram')),
  created_at timestamptz not null default now()
);

create table if not exists public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null references public.post_variants(id) on delete cascade,
  platform text not null,
  scheduled_at timestamptz not null,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued','locked','publishing','succeeded','retry_wait','failed','canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  correlation_id uuid not null default gen_random_uuid(),
  external_post_id text,
  last_error_class text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index if not exists publication_jobs_due_idx on public.publication_jobs(status, coalesce(next_attempt_at, scheduled_at));

create table if not exists public.publication_attempts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  publication_job_id uuid not null references public.publication_jobs(id) on delete cascade,
  attempt_no integer not null,
  provider_request_id text,
  external_post_id text,
  outcome text not null check (outcome in ('success','retryable_error','non_retryable_error','auth_error','rate_limit','validation_error','platform_rejection','unknown')),
  http_status integer,
  provider_code text,
  duration_ms integer,
  response_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (publication_job_id, attempt_no)
);

create table if not exists public.published_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null references public.post_variants(id) on delete cascade,
  publication_job_id uuid references public.publication_jobs(id) on delete set null,
  platform text not null,
  external_account_id text,
  external_post_id text not null,
  external_url text,
  published_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (platform, external_post_id)
);

create table if not exists public.analytics_snapshots (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  published_post_id uuid not null references public.published_posts(id) on delete cascade,
  platform text not null,
  snapshot_at timestamptz not null,
  metrics jsonb not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (published_post_id, snapshot_at)
);

create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task text not null,
  provider text not null default 'openai',
  model text not null,
  prompt_version text,
  input_tokens bigint,
  cached_input_tokens bigint,
  output_tokens bigint,
  image_count integer not null default 0,
  web_search_calls integer not null default 0,
  estimated_cost_microunits bigint,
  correlation_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_tenant_created_idx on public.ai_usage_events(tenant_id, created_at desc);

create table if not exists public.feedback_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid references public.post_variants(id) on delete set null,
  event_type text not null,
  ai_value jsonb,
  user_value jsonb,
  diff jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.editorial_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  topic text,
  angle text,
  hook text,
  cta text,
  pillar_id uuid references public.content_pillars(id) on delete set null,
  visual_concept text,
  published_at timestamptz,
  performance_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists editorial_memory_recent_idx on public.editorial_memory(tenant_id, created_at desc);

create table if not exists public.content_fingerprints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  post_variant_id uuid references public.post_variants(id) on delete cascade,
  text_sha256 text,
  normalized_sha256 text,
  topic_key text,
  hook_key text,
  visual_key text,
  embedding vector,
  embedding_model text,
  created_at timestamptz not null default now()
);
create index if not exists content_fingerprints_tenant_recent_idx on public.content_fingerprints(tenant_id, created_at desc);
create index if not exists content_fingerprints_text_idx on public.content_fingerprints(text_sha256) where text_sha256 is not null;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  channel text not null check (channel in ('in_app','telegram','email')),
  type text not null,
  title text,
  body text,
  status text not null default 'pending' check (status in ('pending','sent','failed','read')),
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists notifications_dedupe_uidx on public.notifications(tenant_id, dedupe_key) where dedupe_key is not null;

-- Shared updated_at triggers.
create or replace trigger websites_set_updated_at before update on public.websites for each row execute function public.set_updated_at();
create or replace trigger brand_profiles_set_updated_at before update on public.brand_profiles for each row execute function public.set_updated_at();
create or replace trigger social_connections_set_updated_at before update on public.social_connections for each row execute function public.set_updated_at();
create or replace trigger social_accounts_set_updated_at before update on public.social_accounts for each row execute function public.set_updated_at();
create or replace trigger telegram_connections_set_updated_at before update on public.telegram_connections for each row execute function public.set_updated_at();
create or replace trigger competitors_set_updated_at before update on public.competitors for each row execute function public.set_updated_at();
create or replace trigger content_strategies_set_updated_at before update on public.content_strategies for each row execute function public.set_updated_at();
create or replace trigger posts_set_updated_at before update on public.posts for each row execute function public.set_updated_at();
create or replace trigger post_variants_set_updated_at before update on public.post_variants for each row execute function public.set_updated_at();
create or replace trigger publication_jobs_set_updated_at before update on public.publication_jobs for each row execute function public.set_updated_at();

-- RLS: all tenant tables are deny-by-default, then receive scoped read/write policies.
do $$
declare
  t text;
begin
  foreach t in array array[
    'websites','website_scans','website_pages','brand_profiles','brand_profile_locks','brand_context_versions','brand_assets',
    'social_connections','social_accounts','telegram_connections','competitors','competitor_snapshots','content_strategies','content_pillars',
    'content_ideas','posts','post_variants','post_assets','post_approvals','post_rejections','publication_jobs','publication_attempts',
    'published_posts','analytics_snapshots','ai_usage_events','feedback_events','editorial_memory','content_fingerprints','notifications'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_tenant_member(tenant_id) or public.is_platform_admin())',
      t || '_tenant_select', t
    );
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Editable content-domain tables: owner/admin/editor.
do $$
declare
  t text;
begin
  foreach t in array array[
    'websites','brand_profiles','brand_profile_locks','brand_assets','competitors','content_strategies','content_pillars',
    'content_ideas','posts','post_variants','post_assets','post_approvals','post_rejections','feedback_events'
  ]
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''editor'']) or public.is_platform_admin())',
      t || '_tenant_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''editor'']) or public.is_platform_admin()) with check (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''editor'']) or public.is_platform_admin())',
      t || '_tenant_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'',''editor'']) or public.is_platform_admin())',
      t || '_tenant_delete', t
    );
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Connection metadata is sensitive: only owner/admin can mutate it.
do $$
declare
  t text;
begin
  foreach t in array array['social_connections','social_accounts','telegram_connections']
  loop
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_tenant_role(tenant_id, array[''owner'',''admin'']) or public.is_platform_admin())',
      t || '_admin_insert', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'']) or public.is_platform_admin()) with check (public.has_tenant_role(tenant_id, array[''owner'',''admin'']) or public.is_platform_admin())',
      t || '_admin_update', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_tenant_role(tenant_id, array[''owner'',''admin'']) or public.is_platform_admin())',
      t || '_admin_delete', t
    );
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- Scanner, AI usage, fingerprints, publication jobs/attempts/published posts and analytics are written only by server/service-role.
-- Authenticated clients receive SELECT through the policies above, but no write grants/policies.
