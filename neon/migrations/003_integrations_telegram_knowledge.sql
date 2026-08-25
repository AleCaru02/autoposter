-- Post Automatici - integration/Telegram/document foundations for Neon personal production.
-- No provider is connected by this migration. Secrets stay app_private and server-only.

create table if not exists public.social_connections(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null check(platform in ('facebook','instagram','linkedin','google_business_profile')),
  connection_status text not null default 'disconnected' check(connection_status in ('connected','degraded','expiring','expired','reauth_required','permission_missing','rate_limited','provider_error','disconnected','disabled')),
  approval_mode text not null default 'manual' check(approval_mode in ('auto','manual')),
  granted_scopes text[] not null default '{}',
  token_expires_at timestamptz,connected_at timestamptz,last_checked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  provider_subject_id text,provider_connection_key text,last_error_code text,last_error_message text,recommended_action text,last_publish_at timestamptz,disconnected_at timestamptz,reconnect_count integer not null default 0,revoked_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique(tenant_id,id)
);
create unique index if not exists social_connections_provider_subject_uidx on public.social_connections(tenant_id,platform,provider_subject_id) where provider_subject_id is not null;
create index if not exists social_connections_tenant_platform_idx on public.social_connections(tenant_id,platform);

create table if not exists public.social_accounts(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,connection_id uuid not null,platform text not null,external_account_id text not null,account_type text,display_name text,username text,location_id text,is_selected boolean not null default false,metadata jsonb not null default '{}'::jsonb,
  health_status text not null default 'connected' check(health_status in ('connected','degraded','expiring','expired','reauth_required','permission_missing','rate_limited','provider_error','disconnected')),
  granted_scopes text[] not null default '{}',capabilities text[] not null default '{}',missing_permissions text[] not null default '{}',token_expires_at timestamptz,last_checked_at timestamptz,last_publish_at timestamptz,last_error_code text,last_error_message text,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(connection_id,external_account_id),unique(tenant_id,id),foreign key(tenant_id,connection_id) references public.social_connections(tenant_id,id) on delete cascade
);

create table if not exists app_private.integration_credentials(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,connection_id uuid not null unique references public.social_connections(id) on delete cascade,
  token_ciphertext bytea not null,refresh_token_ciphertext bytea,key_version integer not null default 1,expires_at timestamptz,metadata jsonb not null default '{}'::jsonb,credential_version integer not null default 1,cipher_algorithm text not null default 'aes-256-gcm',rotated_at timestamptz,revoked_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
revoke all on app_private.integration_credentials from public,anonymous,authenticated;

create table if not exists app_private.oauth_states(
  id uuid primary key default gen_random_uuid(),state_hash text not null unique,tenant_id uuid not null references public.tenants(id) on delete cascade,user_id uuid not null,provider text not null,redirect_uri text not null,requested_scopes text[] not null default '{}',pkce_method text check(pkce_method is null or pkce_method='S256'),code_verifier_ciphertext bytea,key_version integer not null default 1,expires_at timestamptz not null,consumed_at timestamptz,created_at timestamptz not null default now(),check(expires_at>created_at)
);
revoke all on app_private.oauth_states from public,anonymous,authenticated;
create index if not exists oauth_states_expiry_idx on app_private.oauth_states(expires_at) where consumed_at is null;

create table if not exists public.provider_permission_grants(
  id bigint generated always as identity primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,connection_id uuid not null,account_id uuid,provider text not null,scope text not null,feature_key text not null,requirement text not null check(requirement in ('required','optional')),status text not null check(status in ('granted','missing','unknown')),checked_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb,
  foreign key(tenant_id,connection_id) references public.social_connections(tenant_id,id) on delete cascade,
  foreign key(tenant_id,account_id) references public.social_accounts(tenant_id,id) on delete cascade,
  unique(connection_id,account_id,scope,feature_key)
);
create table if not exists public.provider_webhook_events(
  id uuid primary key default gen_random_uuid(),tenant_id uuid references public.tenants(id) on delete cascade,connection_id uuid,account_id uuid,provider text not null,event_type text not null,external_id text,payload_hash text not null,signature_status text not null check(signature_status in ('verified','invalid','not_applicable')),processing_status text not null default 'RECEIVED' check(processing_status in ('RECEIVED','VERIFIED','PROCESSING','PROCESSED','FAILED','IGNORED_DUPLICATE')),attempts integer not null default 0,correlation_id uuid not null default gen_random_uuid(),provider_timestamp timestamptz,received_at timestamptz not null default now(),processed_at timestamptz,last_error_code text,metadata jsonb not null default '{}'::jsonb,
  foreign key(tenant_id,connection_id) references public.social_connections(tenant_id,id) on delete set null(connection_id),
  foreign key(tenant_id,account_id) references public.social_accounts(tenant_id,id) on delete set null(account_id)
);
create unique index if not exists provider_webhook_external_uidx on public.provider_webhook_events(provider,external_id) where external_id is not null;
create unique index if not exists provider_webhook_hash_uidx on public.provider_webhook_events(provider,payload_hash,event_type,coalesce(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid));
create table if not exists public.provider_audit_events(
  id bigint generated always as identity primary key,tenant_id uuid references public.tenants(id) on delete cascade,actor_user_id uuid,provider text not null,connection_id uuid,account_id uuid,action text not null,outcome text not null check(outcome in ('success','failure','blocked','dry_run')),correlation_id uuid not null default gen_random_uuid(),error_code text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),
  foreign key(tenant_id,connection_id) references public.social_connections(tenant_id,id) on delete set null(connection_id),
  foreign key(tenant_id,account_id) references public.social_accounts(tenant_id,id) on delete set null(account_id)
);

create table if not exists public.telegram_connections(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null unique references public.tenants(id) on delete cascade,status text not null default 'disconnected' check(status in ('disconnected','pending','connected','disabled')),telegram_chat_id text,telegram_user_id text,connected_at timestamptz,last_verified_at timestamptz,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists app_private.telegram_pairing_requests(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,token_hash text not null unique,requested_by uuid,expires_at timestamptz not null default(now()+interval '15 minutes'),used_at timestamptz,created_at timestamptz not null default now()
);
revoke all on app_private.telegram_pairing_requests from public,anonymous,authenticated;
create table if not exists public.telegram_approval_requests(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_variant_id uuid not null references public.post_variants(id) on delete cascade,telegram_connection_id uuid references public.telegram_connections(id) on delete set null,callback_token_hash text not null unique,telegram_chat_id text,telegram_message_id text,status text not null default 'pending' check(status in ('pending','approved','rejected','regenerate_text','regenerate_visual','regenerate_all','skipped','expired','failed')),last_action text check(last_action is null or last_action in ('publish','regenerate_text','regenerate_visual','regenerate_all','skip','reject')),expires_at timestamptz not null default(now()+interval '7 days'),acted_at timestamptz,error_code text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);

create table if not exists public.document_ingestions(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,asset_id uuid not null,status text not null default 'UPLOADED' check(status in ('UPLOADED','PROCESSING','INDEXED','FAILED','REQUIRES_AI')),provider_key text not null default 'local',extracted_text text,extracted_metadata jsonb not null default '{}'::jsonb,classification jsonb not null default '{}'::jsonb,summary text,chunk_count integer not null default 0,error_code text,started_at timestamptz,completed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(tenant_id,asset_id) references public.brand_assets(tenant_id,id) on delete cascade,unique(asset_id)
);
create table if not exists public.document_chunks(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,ingestion_id uuid not null references public.document_ingestions(id) on delete cascade,chunk_index integer not null check(chunk_index>=0),content text not null,content_hash text not null,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(ingestion_id,chunk_index)
);
create table if not exists public.knowledge_sources(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,source_type text not null check(source_type in ('WEBSITE','DOCUMENT','USER_CONFIRMED','USER_INPUT','PUBLIC_RESEARCH','SOCIAL','SYSTEM_INFERENCE')),source_ref text,source_entity_id uuid,confidence numeric(5,4) not null default 0.5 check(confidence between 0 and 1),confirmed boolean not null default false,observed_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(tenant_id,id)
);
create table if not exists public.knowledge_facts(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,source_id uuid not null,fact_key text not null,fact_value jsonb not null,confidence numeric(5,4) not null default 0.5 check(confidence between 0 and 1),confirmed boolean not null default false,valid_from timestamptz not null default now(),valid_until timestamptz,created_at timestamptz not null default now(),foreign key(tenant_id,source_id) references public.knowledge_sources(tenant_id,id) on delete cascade
);

create table if not exists public.account_deletion_requests(
  id uuid primary key default gen_random_uuid(),requesting_user_id uuid not null,tenant_id uuid references public.tenants(id) on delete cascade,scope text not null check(scope in ('ACCOUNT','TENANT')),status text not null default 'REQUESTED' check(status in ('REQUESTED','APPROVED','PROCESSING','COMPLETED','REJECTED','CANCELED')),reason text,requested_at timestamptz not null default now(),processed_at timestamptz,processed_by uuid,metadata jsonb not null default '{}'::jsonb
);

create trigger social_connections_set_updated_at before update on public.social_connections for each row execute function public.set_updated_at();
create trigger social_accounts_set_updated_at before update on public.social_accounts for each row execute function public.set_updated_at();
create trigger telegram_connections_set_updated_at before update on public.telegram_connections for each row execute function public.set_updated_at();
create trigger telegram_approval_requests_set_updated_at before update on public.telegram_approval_requests for each row execute function public.set_updated_at();
create trigger document_ingestions_set_updated_at before update on public.document_ingestions for each row execute function public.set_updated_at();

-- RLS: connection/account/knowledge rows are tenant-readable; provider writes are server-only until OAuth is real.
do $$ declare t text; begin
 foreach t in array array['social_connections','social_accounts','provider_permission_grants','provider_webhook_events','provider_audit_events','telegram_connections','telegram_approval_requests','document_ingestions','document_chunks','knowledge_sources','knowledge_facts'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('create policy %I on public.%I for select to authenticated using(tenant_id is not null and public.is_tenant_member(tenant_id))',t||'_member_read',t);
 end loop;
end $$;
alter table public.account_deletion_requests enable row level security;
create policy account_deletion_self_read on public.account_deletion_requests for select to authenticated using(requesting_user_id=public.current_user_id());
create policy account_deletion_self_insert on public.account_deletion_requests for insert to authenticated with check(requesting_user_id=public.current_user_id() and (tenant_id is null or public.is_tenant_member(tenant_id)));
create policy telegram_approval_editor_insert on public.telegram_approval_requests for insert to authenticated with check(public.has_tenant_role(tenant_id,array['owner','admin','editor']));
create policy telegram_approval_editor_update on public.telegram_approval_requests for update to authenticated using(public.has_tenant_role(tenant_id,array['owner','admin','editor'])) with check(public.has_tenant_role(tenant_id,array['owner','admin','editor']));

grant select on public.social_connections,public.social_accounts,public.provider_permission_grants,public.provider_webhook_events,public.provider_audit_events,public.telegram_connections,public.document_ingestions,public.document_chunks,public.knowledge_sources,public.knowledge_facts to authenticated;
grant select,insert,update on public.telegram_approval_requests to authenticated;
grant select,insert on public.account_deletion_requests to authenticated;
