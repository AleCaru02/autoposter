-- Local E2E persistence for onboarding, brand version history and learning insights.
-- This migration remains environment-agnostic and is safe to apply later to a dedicated remote project.

alter table public.posts add column if not exists planned_at timestamptz;
alter table public.posts add column if not exists primary_platform text check (primary_platform is null or primary_platform in ('facebook','instagram','linkedin','google_business_profile'));
alter table public.posts add column if not exists format text;
create index if not exists posts_tenant_planned_idx on public.posts(tenant_id, planned_at) where planned_at is not null;

create table if not exists public.onboarding_sessions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  current_step text not null default 'business' check (current_step in ('business','goals','target','brand','social','frequency','publishing','summary','completed')),
  business jsonb not null default '{}'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  target jsonb not null default '{}'::jsonb,
  social jsonb not null default '[]'::jsonb,
  frequency jsonb not null default '{}'::jsonb,
  publishing_modes jsonb not null default '{}'::jsonb,
  scan_summary jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brand_profile_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  brand_profile_id uuid not null,
  version integer not null,
  status text not null default 'draft' check (status in ('draft','review','confirmed','superseded')),
  snapshot jsonb not null,
  source_summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (brand_profile_id, version),
  constraint brand_profile_versions_tenant_profile_fkey foreign key (tenant_id, brand_profile_id)
    references public.brand_profiles(tenant_id, id) on delete cascade
);
create unique index if not exists brand_profile_versions_tenant_id_uidx on public.brand_profile_versions(tenant_id, id);
create index if not exists brand_profile_versions_tenant_created_idx on public.brand_profile_versions(tenant_id, created_at desc);

create table if not exists public.learning_insights (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  insight_type text not null check (insight_type in ('pillar','cta','style','format','platform','approval','general')),
  title text not null,
  body text not null,
  evidence jsonb not null default '{}'::jsonb,
  sample_size integer not null default 0 check (sample_size >= 0),
  confidence numeric(5,4) not null default 0 check (confidence >= 0 and confidence <= 1),
  status text not null default 'suggested' check (status in ('suggested','applied','dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists learning_insights_tenant_id_uidx on public.learning_insights(tenant_id, id);
create index if not exists learning_insights_tenant_created_idx on public.learning_insights(tenant_id, created_at desc);

create or replace trigger onboarding_sessions_set_updated_at before update on public.onboarding_sessions for each row execute function public.set_updated_at();
create or replace trigger learning_insights_set_updated_at before update on public.learning_insights for each row execute function public.set_updated_at();

alter table public.onboarding_sessions enable row level security;
alter table public.brand_profile_versions enable row level security;
alter table public.learning_insights enable row level security;

create policy onboarding_sessions_tenant_select on public.onboarding_sessions
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy onboarding_sessions_tenant_insert on public.onboarding_sessions
for insert to authenticated
with check (public.has_tenant_role(tenant_id, array['owner','admin','editor']) or public.is_platform_admin());
create policy onboarding_sessions_tenant_update on public.onboarding_sessions
for update to authenticated
using (public.has_tenant_role(tenant_id, array['owner','admin','editor']) or public.is_platform_admin())
with check (public.has_tenant_role(tenant_id, array['owner','admin','editor']) or public.is_platform_admin());
create policy onboarding_sessions_tenant_delete on public.onboarding_sessions
for delete to authenticated
using (public.has_tenant_role(tenant_id, array['owner','admin']) or public.is_platform_admin());

grant select, insert, update, delete on public.onboarding_sessions to authenticated;

create policy brand_profile_versions_tenant_select on public.brand_profile_versions
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
create policy brand_profile_versions_tenant_insert on public.brand_profile_versions
for insert to authenticated
with check (public.has_tenant_role(tenant_id, array['owner','admin','editor']) or public.is_platform_admin());
create policy brand_profile_versions_tenant_update on public.brand_profile_versions
for update to authenticated
using (public.has_tenant_role(tenant_id, array['owner','admin','editor']) or public.is_platform_admin())
with check (public.has_tenant_role(tenant_id, array['owner','admin','editor']) or public.is_platform_admin());

grant select, insert, update on public.brand_profile_versions to authenticated;

create policy learning_insights_tenant_select on public.learning_insights
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

-- Learning insight writes are server-side only. Authenticated users may read tenant-scoped evidence.
grant select on public.learning_insights to authenticated;

grant select, insert, update, delete on public.onboarding_sessions, public.brand_profile_versions, public.learning_insights to service_role;
