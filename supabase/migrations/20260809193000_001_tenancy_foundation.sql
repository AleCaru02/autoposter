-- Phase 1: identity, tenant isolation, plans, quotas and audit foundation.
-- Source of truth: Git migrations. Apply only to a dedicated Supabase project.

create extension if not exists pgcrypto;

create schema if not exists app_private;
revoke all on schema app_private from anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text not null default 'it',
  timezone text not null default 'Europe/Rome',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active','suspended','closed')),
  onboarding_status text not null default 'not_started' check (onboarding_status in ('not_started','in_progress','completed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('owner','admin','editor','viewer')),
  status text not null default 'active' check (status in ('active','invited','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists tenant_members_user_idx on public.tenant_members(user_id, status);

create table if not exists app_private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

revoke all on app_private.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = app_private, public, pg_temp
as $$
  select exists (
    select 1 from app_private.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  );
$$;

create or replace function public.has_tenant_role(p_tenant_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role = any(p_roles)
  );
$$;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_tenant_member(uuid) from public;
revoke all on function public.has_tenant_role(uuid, text[]) from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid, text[]) to authenticated;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.create_tenant(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_tenant uuid;
  v_slug text;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  v_slug := lower(regexp_replace(trim(p_slug), '[^a-zA-Z0-9-]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);

  if char_length(trim(p_name)) < 2 or char_length(v_slug) < 2 or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'INVALID_TENANT_DATA' using errcode = '22023';
  end if;

  insert into public.tenants(name, slug, created_by, onboarding_status)
  values (trim(p_name), v_slug, v_user, 'in_progress')
  returning id into v_tenant;

  insert into public.tenant_members(tenant_id, user_id, role, status)
  values (v_tenant, v_user, 'owner', 'active');

  return v_tenant;
end;
$$;

revoke all on function public.create_tenant(text, text) from public;
grant execute on function public.create_tenant(text, text) to authenticated;

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  price_amount numeric(12,2),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  billing_interval text check (billing_interval in ('month','quarter','year','manual')),
  posts_per_week integer not null default 0 check (posts_per_week >= 0),
  monthly_post_limit integer check (monthly_post_limit is null or monthly_post_limit >= 0),
  platforms text[] not null default '{}',
  competitor_refresh_frequency text,
  analytics_level text not null default 'basic',
  auto_publish_allowed boolean not null default false,
  website_page_limit integer not null default 20 check (website_page_limit > 0),
  ai_budget_cents integer check (ai_budget_cents is null or ai_budget_cents >= 0),
  storage_mb integer not null default 1024 check (storage_mb >= 0),
  team_members integer not null default 1 check (team_members > 0),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  provider text not null default 'manual' check (provider in ('manual','stripe')),
  provider_customer_id text,
  provider_subscription_id text,
  status text not null default 'active' check (status in ('active','trialing','past_due','canceled','paused','incomplete')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists subscriptions_provider_sub_uidx
  on public.subscriptions(provider, provider_subscription_id)
  where provider_subscription_id is not null;
create index if not exists subscriptions_tenant_idx on public.subscriptions(tenant_id, status);

create table if not exists public.tenant_plan_overrides (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  overrides jsonb not null default '{}'::jsonb,
  reason text,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.tenant_usage_counters (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  metric text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  used bigint not null default 0 check (used >= 0),
  reserved bigint not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  unique (tenant_id, metric, period_start, period_end),
  check (period_end > period_start)
);
create index if not exists tenant_usage_lookup_idx on public.tenant_usage_counters(tenant_id, metric, period_end desc);

create table if not exists public.tenant_feature_flags (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (tenant_id, flag_key)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user','system','admin','webhook')),
  action text not null,
  entity_type text,
  entity_id text,
  correlation_id uuid,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_tenant_created_idx on public.audit_logs(tenant_id, created_at desc);
create index if not exists audit_logs_correlation_idx on public.audit_logs(correlation_id) where correlation_id is not null;

-- updated_at triggers
create or replace trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create or replace trigger tenants_set_updated_at before update on public.tenants for each row execute function public.set_updated_at();
create or replace trigger tenant_members_set_updated_at before update on public.tenant_members for each row execute function public.set_updated_at();
create or replace trigger plans_set_updated_at before update on public.plans for each row execute function public.set_updated_at();
create or replace trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

-- RLS
alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.tenant_plan_overrides enable row level security;
alter table public.tenant_usage_counters enable row level security;
alter table public.tenant_feature_flags enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_select_self on public.profiles
for select to authenticated
using (user_id = auth.uid() or public.is_platform_admin());
create policy profiles_update_self on public.profiles
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy tenants_select_member on public.tenants
for select to authenticated
using (public.is_tenant_member(id) or public.is_platform_admin());
create policy tenants_update_admin on public.tenants
for update to authenticated
using (public.has_tenant_role(id, array['owner','admin']) or public.is_platform_admin())
with check (public.has_tenant_role(id, array['owner','admin']) or public.is_platform_admin());

create policy tenant_members_select_member on public.tenant_members
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

create policy plans_select_active on public.plans
for select to anon, authenticated
using (status = 'active' or public.is_platform_admin());

create policy subscriptions_select_member on public.subscriptions
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy tenant_plan_overrides_select_member on public.tenant_plan_overrides
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy tenant_usage_select_member on public.tenant_usage_counters
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy tenant_flags_select_member on public.tenant_feature_flags
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy audit_logs_select_admin on public.audit_logs
for select to authenticated
using (
  public.is_platform_admin()
  or (tenant_id is not null and public.has_tenant_role(tenant_id, array['owner','admin']))
);

-- Explicit table privileges. RLS still applies where granted.
grant select, update on public.profiles to authenticated;
grant select, update on public.tenants to authenticated;
grant select on public.tenant_members to authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.subscriptions, public.tenant_plan_overrides, public.tenant_usage_counters, public.tenant_feature_flags, public.audit_logs to authenticated;
