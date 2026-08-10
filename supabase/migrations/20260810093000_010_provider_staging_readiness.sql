-- Provider & Staging Readiness: OAuth, webhooks, provider health, provenance, document ingestion and thumbnail metadata.
-- No live credentials or provider calls are introduced by this migration.

alter table public.brand_assets
  add column if not exists thumbnail_small_path text,
  add column if not exists thumbnail_medium_path text,
  add column if not exists thumbnail_status text not null default 'pending',
  add column if not exists thumbnail_metadata jsonb not null default '{}'::jsonb;

alter table public.brand_assets drop constraint if exists brand_assets_thumbnail_status_check;
alter table public.brand_assets add constraint brand_assets_thumbnail_status_check
  check (thumbnail_status in ('pending','processing','ready','failed','not_applicable'));

update public.brand_assets
set thumbnail_status = case when mime_type like 'image/%' then 'pending' else 'not_applicable' end
where thumbnail_status = 'pending' and mime_type is not null;

alter table public.social_connections drop constraint if exists social_connections_connection_status_check;
alter table public.social_connections add constraint social_connections_connection_status_check check (
  connection_status in ('connected','degraded','expiring','expired','reauth_required','permission_missing','rate_limited','provider_error','disconnected','disabled')
);

alter table public.social_connections
  add column if not exists provider_subject_id text,
  add column if not exists provider_connection_key text,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists recommended_action text,
  add column if not exists last_publish_at timestamptz,
  add column if not exists disconnected_at timestamptz,
  add column if not exists reconnect_count integer not null default 0,
  add column if not exists revoked_at timestamptz;

create unique index if not exists social_connections_provider_subject_uidx
  on public.social_connections(tenant_id, platform, provider_subject_id)
  where provider_subject_id is not null;

alter table public.social_accounts
  add column if not exists health_status text not null default 'connected',
  add column if not exists granted_scopes text[] not null default '{}',
  add column if not exists capabilities text[] not null default '{}',
  add column if not exists missing_permissions text[] not null default '{}',
  add column if not exists token_expires_at timestamptz,
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_publish_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_message text;

alter table public.social_accounts drop constraint if exists social_accounts_health_status_check;
alter table public.social_accounts add constraint social_accounts_health_status_check check (
  health_status in ('connected','degraded','expiring','expired','reauth_required','permission_missing','rate_limited','provider_error','disconnected')
);

create table if not exists app_private.oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  redirect_uri text not null,
  requested_scopes text[] not null default '{}',
  pkce_method text,
  code_verifier_ciphertext bytea,
  key_version integer not null default 1,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (pkce_method is null or pkce_method in ('S256'))
);
create index if not exists oauth_states_expiry_idx on app_private.oauth_states(expires_at) where consumed_at is null;
revoke all on app_private.oauth_states from anon, authenticated;
grant all on app_private.oauth_states to service_role;

alter table app_private.integration_credentials
  add column if not exists credential_version integer not null default 1,
  add column if not exists cipher_algorithm text not null default 'mock-envelope-v1',
  add column if not exists rotated_at timestamptz,
  add column if not exists revoked_at timestamptz;

create or replace function app_private.store_integration_credential(
  p_tenant_id uuid,
  p_connection_id uuid,
  p_token_ciphertext bytea,
  p_refresh_token_ciphertext bytea,
  p_key_version integer,
  p_expires_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = app_private, public, pg_temp
as $$
declare v_id uuid;
begin
  insert into app_private.integration_credentials(
    tenant_id, connection_id, token_ciphertext, refresh_token_ciphertext, key_version, expires_at, metadata, updated_at
  ) values (
    p_tenant_id, p_connection_id, p_token_ciphertext, p_refresh_token_ciphertext, p_key_version, p_expires_at, coalesce(p_metadata,'{}'::jsonb), now()
  )
  on conflict (connection_id) do update set
    token_ciphertext = excluded.token_ciphertext,
    refresh_token_ciphertext = excluded.refresh_token_ciphertext,
    key_version = excluded.key_version,
    expires_at = excluded.expires_at,
    metadata = excluded.metadata,
    credential_version = app_private.integration_credentials.credential_version + 1,
    rotated_at = now(),
    revoked_at = null,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app_private.get_integration_credential(p_connection_id uuid)
returns app_private.integration_credentials
language sql
stable
security definer
set search_path = app_private, pg_temp
as $$
  select * from app_private.integration_credentials where connection_id = p_connection_id and revoked_at is null
$$;

create or replace function app_private.delete_integration_credential(p_connection_id uuid)
returns boolean
language plpgsql
security definer
set search_path = app_private, pg_temp
as $$
begin
  update app_private.integration_credentials
  set revoked_at = now(), token_ciphertext = '\\x00'::bytea, refresh_token_ciphertext = null, updated_at = now()
  where connection_id = p_connection_id and revoked_at is null;
  return found;
end;
$$;

revoke all on function app_private.store_integration_credential(uuid,uuid,bytea,bytea,integer,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function app_private.get_integration_credential(uuid) from public, anon, authenticated;
revoke all on function app_private.delete_integration_credential(uuid) from public, anon, authenticated;
grant execute on function app_private.store_integration_credential(uuid,uuid,bytea,bytea,integer,timestamptz,jsonb) to service_role;
grant execute on function app_private.get_integration_credential(uuid) to service_role;
grant execute on function app_private.delete_integration_credential(uuid) to service_role;

create table if not exists public.provider_permission_grants (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null,
  account_id uuid,
  provider text not null,
  scope text not null,
  feature_key text not null,
  requirement text not null check (requirement in ('required','optional')),
  status text not null check (status in ('granted','missing','unknown')),
  checked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint provider_permission_connection_tenant_fk foreign key (tenant_id, connection_id)
    references public.social_connections(tenant_id, id) on delete cascade,
  constraint provider_permission_account_tenant_fk foreign key (tenant_id, account_id)
    references public.social_accounts(tenant_id, id) on delete cascade,
  unique (connection_id, account_id, scope, feature_key)
);
create index if not exists provider_permission_tenant_idx on public.provider_permission_grants(tenant_id, provider, status);

create table if not exists public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  connection_id uuid,
  account_id uuid,
  provider text not null,
  event_type text not null,
  external_id text,
  payload_hash text not null,
  signature_status text not null check (signature_status in ('verified','invalid','not_applicable')),
  processing_status text not null default 'RECEIVED' check (processing_status in ('RECEIVED','VERIFIED','PROCESSING','PROCESSED','FAILED','IGNORED_DUPLICATE')),
  attempts integer not null default 0 check (attempts >= 0),
  correlation_id uuid not null default gen_random_uuid(),
  provider_timestamp timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  constraint webhook_connection_tenant_fk foreign key (tenant_id, connection_id)
    references public.social_connections(tenant_id, id) on delete set null (connection_id),
  constraint webhook_account_tenant_fk foreign key (tenant_id, account_id)
    references public.social_accounts(tenant_id, id) on delete set null (account_id)
);
create unique index if not exists provider_webhook_external_uidx
  on public.provider_webhook_events(provider, external_id) where external_id is not null;
create unique index if not exists provider_webhook_hash_uidx
  on public.provider_webhook_events(provider, payload_hash, event_type, coalesce(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists provider_webhook_status_idx on public.provider_webhook_events(processing_status, received_at);

create table if not exists public.provider_audit_events (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  connection_id uuid,
  account_id uuid,
  action text not null,
  outcome text not null check (outcome in ('success','failure','blocked','dry_run')),
  correlation_id uuid not null default gen_random_uuid(),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint provider_audit_connection_tenant_fk foreign key (tenant_id, connection_id)
    references public.social_connections(tenant_id, id) on delete set null (connection_id),
  constraint provider_audit_account_tenant_fk foreign key (tenant_id, account_id)
    references public.social_accounts(tenant_id, id) on delete set null (account_id)
);
create index if not exists provider_audit_tenant_created_idx on public.provider_audit_events(tenant_id, created_at desc);

create table if not exists public.document_ingestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  status text not null default 'UPLOADED' check (status in ('UPLOADED','PROCESSING','INDEXED','FAILED','REQUIRES_AI')),
  provider_key text not null default 'mock-local',
  extracted_text text,
  extracted_metadata jsonb not null default '{}'::jsonb,
  classification jsonb not null default '{}'::jsonb,
  summary text,
  chunk_count integer not null default 0 check (chunk_count >= 0),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_ingestion_asset_tenant_fk foreign key (tenant_id, asset_id)
    references public.brand_assets(tenant_id, id) on delete cascade,
  unique (asset_id)
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingestion_id uuid not null references public.document_ingestions(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (ingestion_id, chunk_index)
);
create index if not exists document_chunks_tenant_idx on public.document_chunks(tenant_id, ingestion_id, chunk_index);

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_type text not null check (source_type in ('WEBSITE','DOCUMENT','USER_CONFIRMED','USER_INPUT','PUBLIC_RESEARCH','SOCIAL','SYSTEM_INFERENCE')),
  source_ref text,
  source_entity_id uuid,
  confidence numeric(5,4) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  confirmed boolean not null default false,
  observed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_sources_tenant_type_idx on public.knowledge_sources(tenant_id, source_type, observed_at desc);

create table if not exists public.knowledge_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null,
  fact_key text not null,
  fact_value jsonb not null,
  confidence numeric(5,4) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  confirmed boolean not null default false,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  constraint knowledge_fact_source_tenant_fk foreign key (tenant_id, source_id)
    references public.knowledge_sources(tenant_id, id) on delete cascade
);
create index if not exists knowledge_facts_lookup_idx on public.knowledge_facts(tenant_id, fact_key, valid_from desc);

-- Extend entitlement payload without changing existing callers.
create or replace function app_private.resolve_tenant_entitlements(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.plans%rowtype;
  v_overrides jsonb := '{}'::jsonb;
begin
  select p.* into v_plan
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.tenant_id = p_tenant_id
    and s.status in ('active','trialing')
    and (s.current_period_end is null or s.current_period_end > now())
  order by s.created_at desc limit 1;

  if v_plan.id is null then
    return jsonb_build_object(
      'has_plan', false, 'posts_per_week', 0, 'monthly_post_limit', 0, 'platforms', '[]'::jsonb,
      'auto_publish_allowed', false, 'website_page_limit', 0, 'ai_budget_cents', 0,
      'storage_mb', 0, 'team_members', 1, 'analytics_level', 'none', 'competitor_refresh_frequency', null,
      'image_generation_allowed', false, 'premium_chat_allowed', false, 'plan_config', '{}'::jsonb, 'overrides', '{}'::jsonb
    );
  end if;

  select coalesce(tpo.overrides, '{}'::jsonb) into v_overrides
  from public.tenant_plan_overrides tpo
  where tpo.tenant_id = p_tenant_id and (tpo.expires_at is null or tpo.expires_at > now());
  v_overrides := coalesce(v_overrides, '{}'::jsonb);

  return jsonb_build_object(
    'has_plan', true,
    'plan_id', v_plan.id,
    'plan_code', v_plan.code,
    'posts_per_week', coalesce((v_overrides ->> 'posts_per_week')::integer, v_plan.posts_per_week),
    'monthly_post_limit', coalesce((v_overrides ->> 'monthly_post_limit')::integer, v_plan.monthly_post_limit),
    'platforms', coalesce(v_overrides -> 'platforms', to_jsonb(v_plan.platforms)),
    'auto_publish_allowed', coalesce((v_overrides ->> 'auto_publish_allowed')::boolean, v_plan.auto_publish_allowed),
    'website_page_limit', coalesce((v_overrides ->> 'website_page_limit')::integer, v_plan.website_page_limit),
    'ai_budget_cents', coalesce((v_overrides ->> 'ai_budget_cents')::integer, v_plan.ai_budget_cents),
    'storage_mb', coalesce((v_overrides ->> 'storage_mb')::integer, v_plan.storage_mb),
    'team_members', coalesce((v_overrides ->> 'team_members')::integer, v_plan.team_members),
    'analytics_level', coalesce(v_overrides ->> 'analytics_level', v_plan.analytics_level),
    'competitor_refresh_frequency', coalesce(v_overrides ->> 'competitor_refresh_frequency', v_plan.competitor_refresh_frequency),
    'image_generation_allowed', coalesce((v_overrides ->> 'image_generation_allowed')::boolean, (v_plan.config ->> 'image_generation_allowed')::boolean, false),
    'premium_chat_allowed', coalesce((v_overrides ->> 'premium_chat_allowed')::boolean, (v_plan.config ->> 'premium_chat_allowed')::boolean, false),
    'plan_config', v_plan.config,
    'overrides', v_overrides
  );
end;
$$;

create or replace function app_private.assert_tenant_feature(
  p_tenant_id uuid,
  p_feature text,
  p_platform text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = app_private, public, pg_temp
as $$
declare e jsonb; allowed boolean := false;
begin
  e := app_private.resolve_tenant_entitlements(p_tenant_id);
  if coalesce((e->>'has_plan')::boolean,false) is false then raise exception 'NO_ACTIVE_PLAN' using errcode='42501'; end if;
  allowed := case p_feature
    when 'auto_publish' then coalesce((e->>'auto_publish_allowed')::boolean,false)
    when 'image_generation' then coalesce((e->>'image_generation_allowed')::boolean,false)
    when 'premium_chat' then coalesce((e->>'premium_chat_allowed')::boolean,false)
    when 'platform' then p_platform is not null and (e->'platforms') ? p_platform
    when 'advanced_analytics' then coalesce(e->>'analytics_level','basic') in ('advanced','pro')
    else false end;
  if not allowed then raise exception 'FEATURE_NOT_ENTITLED:%', p_feature using errcode='42501'; end if;
  return jsonb_build_object('allowed',true,'feature',p_feature,'platform',p_platform);
end;
$$;
revoke all on function app_private.assert_tenant_feature(uuid,text,text) from public, anon, authenticated;
grant execute on function app_private.assert_tenant_feature(uuid,text,text) to service_role;

-- RLS: readable by tenant members; mutations are server-only except existing connection/account policies.
alter table public.provider_permission_grants enable row level security;
alter table public.provider_webhook_events enable row level security;
alter table public.provider_audit_events enable row level security;
alter table public.document_ingestions enable row level security;
alter table public.document_chunks enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_facts enable row level security;

create policy provider_permission_read on public.provider_permission_grants for select to authenticated using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy provider_webhook_read on public.provider_webhook_events for select to authenticated using (tenant_id is not null and (public.is_tenant_member(tenant_id) or public.is_platform_admin()));
create policy provider_audit_read on public.provider_audit_events for select to authenticated using (tenant_id is not null and (public.is_tenant_member(tenant_id) or public.is_platform_admin()));
create policy document_ingestions_read on public.document_ingestions for select to authenticated using (public.is_tenant_member(tenant_id));
create policy document_chunks_read on public.document_chunks for select to authenticated using (public.is_tenant_member(tenant_id));
create policy knowledge_sources_read on public.knowledge_sources for select to authenticated using (public.is_tenant_member(tenant_id));
create policy knowledge_facts_read on public.knowledge_facts for select to authenticated using (public.is_tenant_member(tenant_id));

grant select on public.provider_permission_grants, public.provider_webhook_events, public.provider_audit_events, public.document_ingestions, public.document_chunks, public.knowledge_sources, public.knowledge_facts to authenticated;
grant all on public.provider_permission_grants, public.provider_webhook_events, public.provider_audit_events, public.document_ingestions, public.document_chunks, public.knowledge_sources, public.knowledge_facts to service_role;
grant usage, select on sequence public.provider_permission_grants_id_seq, public.provider_audit_events_id_seq to service_role;

-- Composite uniqueness required by tenant-aware FKs introduced above.
create unique index if not exists social_connections_tenant_id_id_uidx on public.social_connections(tenant_id,id);
create unique index if not exists social_accounts_tenant_id_id_uidx on public.social_accounts(tenant_id,id);
create unique index if not exists knowledge_sources_tenant_id_id_uidx on public.knowledge_sources(tenant_id,id);
