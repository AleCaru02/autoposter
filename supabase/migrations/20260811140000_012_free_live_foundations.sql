-- Free live-foundation hardening: explicit data mode, persistent AI cost controls,
-- website knowledge resources, account lifecycle and scheduler reconciliation.
-- No live provider, billing or remote-only dependency is enabled by this migration.

alter table public.tenants
  add column if not exists data_mode text not null default 'DEMO';

do $$ begin
  alter table public.tenants add constraint tenants_data_mode_check check (data_mode in ('DEMO','REAL'));
exception when duplicate_object then null; end $$;

create table if not exists public.website_resources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  website_id uuid not null references public.websites(id) on delete cascade,
  scan_id uuid references public.website_scans(id) on delete cascade,
  page_url text,
  resource_type text not null check (resource_type in ('robots','sitemap','sitemap_index','stylesheet','favicon','logo_candidate','image_candidate','raw_page')),
  url text not null,
  content_text text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (tenant_id, scan_id, resource_type, url)
);
create index if not exists website_resources_scan_idx on public.website_resources(tenant_id, scan_id, resource_type);
alter table public.website_resources enable row level security;
create policy website_resources_read on public.website_resources
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
grant select on public.website_resources to authenticated;
grant all on public.website_resources to service_role;

create table if not exists public.tenant_ai_budgets (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  currency text not null default 'USD' check (currency in ('USD','EUR')),
  soft_limit_microunits bigint not null default 0 check (soft_limit_microunits >= 0),
  hard_limit_microunits bigint not null default 0 check (hard_limit_microunits >= 0),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (hard_limit_microunits = 0 or soft_limit_microunits <= hard_limit_microunits)
);
alter table public.tenant_ai_budgets enable row level security;
create policy tenant_ai_budgets_read on public.tenant_ai_budgets
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
grant select on public.tenant_ai_budgets to authenticated;
grant all on public.tenant_ai_budgets to service_role;

create table if not exists app_private.global_ai_budget (
  singleton boolean primary key default true check (singleton),
  currency text not null default 'USD' check (currency in ('USD','EUR')),
  soft_limit_microunits bigint not null default 0 check (soft_limit_microunits >= 0),
  hard_limit_microunits bigint not null default 0 check (hard_limit_microunits >= 0),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (hard_limit_microunits = 0 or soft_limit_microunits <= hard_limit_microunits)
);
revoke all on app_private.global_ai_budget from public, anon, authenticated;
grant all on app_private.global_ai_budget to service_role;

create table if not exists public.ai_cost_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  operation_type text not null,
  capability text not null,
  model_key text not null,
  estimated_cost_microunits bigint not null check (estimated_cost_microunits >= 0),
  actual_cost_microunits bigint check (actual_cost_microunits is null or actual_cost_microunits >= 0),
  idempotency_key text not null,
  status text not null default 'reserved' check (status in ('reserved','committed','released','rejected')),
  soft_limit_exceeded boolean not null default false,
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  unique (tenant_id, idempotency_key),
  check (period_end > period_start)
);
create index if not exists ai_cost_reservations_period_idx on public.ai_cost_reservations(tenant_id, period_start, period_end, status);
alter table public.ai_cost_reservations enable row level security;
create policy ai_cost_reservations_read on public.ai_cost_reservations
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
grant select on public.ai_cost_reservations to authenticated;
grant all on public.ai_cost_reservations to service_role;

alter table public.ai_usage_events add column if not exists operation_type text;
alter table public.ai_usage_events add column if not exists capability text;
alter table public.ai_usage_events add column if not exists actual_cost_microunits bigint;
alter table public.ai_usage_events add column if not exists cost_reservation_id uuid references public.ai_cost_reservations(id) on delete set null;
alter table public.ai_usage_events add column if not exists usage_status text not null default 'estimated';

do $$ begin
  alter table public.ai_usage_events add constraint ai_usage_actual_cost_nonnegative check (actual_cost_microunits is null or actual_cost_microunits >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.ai_usage_events add constraint ai_usage_status_check check (usage_status in ('estimated','final','failed','rejected'));
exception when duplicate_object then null; end $$;

create or replace function app_private.reserve_ai_cost(
  p_tenant_id uuid,
  p_operation_type text,
  p_capability text,
  p_model_key text,
  p_estimated_cost_microunits bigint,
  p_idempotency_key text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_tenant public.tenant_ai_budgets%rowtype;
  v_global app_private.global_ai_budget%rowtype;
  v_existing public.ai_cost_reservations%rowtype;
  v_start timestamptz := date_trunc('month', p_now);
  v_end timestamptz := date_trunc('month', p_now) + interval '1 month';
  v_tenant_spent bigint := 0;
  v_global_spent bigint := 0;
  v_id uuid;
  v_soft boolean := false;
begin
  if p_estimated_cost_microunits < 0 or nullif(trim(p_idempotency_key),'') is null then
    raise exception 'AI_COST_INVALID_RESERVATION' using errcode='22023';
  end if;

  select * into v_existing from public.ai_cost_reservations
  where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('reservation_id',v_existing.id,'status',v_existing.status,'soft_limit_exceeded',v_existing.soft_limit_exceeded,'idempotent_replay',true);
  end if;

  select * into v_tenant from public.tenant_ai_budgets where tenant_id=p_tenant_id for update;
  if v_tenant.tenant_id is null or not v_tenant.enabled or v_tenant.hard_limit_microunits <= 0 then
    raise exception 'AI_TENANT_BUDGET_NOT_CONFIGURED' using errcode='42501';
  end if;
  select * into v_global from app_private.global_ai_budget where singleton=true for update;
  if v_global.singleton is null or not v_global.enabled or v_global.hard_limit_microunits <= 0 then
    raise exception 'AI_GLOBAL_BUDGET_NOT_CONFIGURED' using errcode='42501';
  end if;
  if v_tenant.currency <> v_global.currency then raise exception 'AI_BUDGET_CURRENCY_MISMATCH'; end if;

  select coalesce(sum(coalesce(actual_cost_microunits,estimated_cost_microunits)),0) into v_tenant_spent
  from public.ai_cost_reservations where tenant_id=p_tenant_id and status in ('reserved','committed') and period_start=v_start and period_end=v_end;
  select coalesce(sum(coalesce(actual_cost_microunits,estimated_cost_microunits)),0) into v_global_spent
  from public.ai_cost_reservations where status in ('reserved','committed') and period_start=v_start and period_end=v_end;

  if v_tenant_spent + p_estimated_cost_microunits > v_tenant.hard_limit_microunits then
    raise exception 'AI_TENANT_HARD_LIMIT_EXCEEDED' using errcode='P0001';
  end if;
  if v_global_spent + p_estimated_cost_microunits > v_global.hard_limit_microunits then
    raise exception 'AI_GLOBAL_HARD_LIMIT_EXCEEDED' using errcode='P0001';
  end if;

  v_soft := (v_tenant.soft_limit_microunits > 0 and v_tenant_spent + p_estimated_cost_microunits > v_tenant.soft_limit_microunits)
    or (v_global.soft_limit_microunits > 0 and v_global_spent + p_estimated_cost_microunits > v_global.soft_limit_microunits);

  insert into public.ai_cost_reservations(tenant_id,operation_type,capability,model_key,estimated_cost_microunits,idempotency_key,status,soft_limit_exceeded,period_start,period_end)
  values(p_tenant_id,p_operation_type,p_capability,p_model_key,p_estimated_cost_microunits,p_idempotency_key,'reserved',v_soft,v_start,v_end)
  returning id into v_id;
  return jsonb_build_object('reservation_id',v_id,'status','reserved','soft_limit_exceeded',v_soft,'idempotent_replay',false);
end;
$$;
revoke all on function app_private.reserve_ai_cost(uuid,text,text,text,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function app_private.reserve_ai_cost(uuid,text,text,text,bigint,text,timestamptz) to service_role;

create or replace function app_private.commit_ai_cost(p_reservation_id uuid,p_actual_cost_microunits bigint)
returns jsonb language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare v_res public.ai_cost_reservations%rowtype;
begin
  if p_actual_cost_microunits < 0 then raise exception 'AI_COST_INVALID_ACTUAL'; end if;
  select * into v_res from public.ai_cost_reservations where id=p_reservation_id for update;
  if v_res.id is null then raise exception 'AI_COST_RESERVATION_NOT_FOUND'; end if;
  if v_res.status='committed' then return jsonb_build_object('reservation_id',v_res.id,'status','committed','idempotent_replay',true); end if;
  if v_res.status<>'reserved' then raise exception 'AI_COST_RESERVATION_NOT_ACTIVE'; end if;
  update public.ai_cost_reservations set status='committed',actual_cost_microunits=p_actual_cost_microunits,committed_at=now() where id=p_reservation_id;
  return jsonb_build_object('reservation_id',p_reservation_id,'status','committed','actual_cost_microunits',p_actual_cost_microunits,'idempotent_replay',false);
end; $$;
revoke all on function app_private.commit_ai_cost(uuid,bigint) from public,anon,authenticated;
grant execute on function app_private.commit_ai_cost(uuid,bigint) to service_role;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  requesting_user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  scope text not null check (scope in ('ACCOUNT','TENANT')),
  status text not null default 'REQUESTED' check (status in ('REQUESTED','APPROVED','PROCESSING','COMPLETED','REJECTED','CANCELED')),
  reason text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists account_deletion_requests_user_idx on public.account_deletion_requests(requesting_user_id,requested_at desc);
alter table public.account_deletion_requests enable row level security;
create policy account_deletion_requests_read on public.account_deletion_requests
for select to authenticated
using (requesting_user_id=auth.uid() or public.is_platform_admin());
create policy account_deletion_requests_insert on public.account_deletion_requests
for insert to authenticated
with check (requesting_user_id=auth.uid() and (tenant_id is null or public.is_tenant_member(tenant_id)));
grant select,insert on public.account_deletion_requests to authenticated;
grant all on public.account_deletion_requests to service_role;

create table if not exists app_private.account_lifecycle_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  target_user_id uuid,
  tenant_id_snapshot uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
revoke all on app_private.account_lifecycle_audit from public,anon,authenticated;
grant all on app_private.account_lifecycle_audit to service_role;

alter table public.publication_jobs add column if not exists reconciliation_state text not null default 'not_started';
alter table public.publication_jobs add column if not exists reconciled_at timestamptz;
alter table public.publication_jobs add column if not exists provider_request_id text;
do $$ begin
  alter table public.publication_jobs add constraint publication_jobs_reconciliation_state_check check (reconciliation_state in ('not_started','pending','confirmed','not_found','failed'));
exception when duplicate_object then null; end $$;

create table if not exists app_private.rate_limit_windows (
  scope text not null,
  subject_hash text not null,
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  updated_at timestamptz not null default now(),
  primary key(scope,subject_hash,window_start)
);
revoke all on app_private.rate_limit_windows from public,anon,authenticated;
grant all on app_private.rate_limit_windows to service_role;

comment on column public.tenants.data_mode is 'DEMO may contain explicit fixtures; REAL must never synthesize provider/analytics data.';
comment on table public.website_resources is 'Raw non-AI website knowledge and discovered public resources for later brand intelligence.';
comment on table public.ai_cost_reservations is 'Server-side preflight cost reservations. Live AI adapters must reserve before external calls.';
