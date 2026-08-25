-- Post Automatici - personal-only compatibility for the existing workspace service.
-- This is NOT billing and exposes no commercial plan/checkout. It only removes legacy branching
-- while the product remains personal-first and free infrastructure.

create table if not exists public.plans(
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'active' check(status in ('active','inactive')),
  posts_per_week integer not null default 21,
  monthly_post_limit integer not null default 1000,
  platforms text[] not null default array['instagram','facebook','linkedin','google_business_profile'],
  created_at timestamptz not null default now()
);
insert into public.plans(code,name,status,posts_per_week,monthly_post_limit)
values('local-dev','Uso personale','active',21,1000)
on conflict(code) do update set name='Uso personale',status='active',posts_per_week=21,monthly_post_limit=1000;

create table if not exists public.subscriptions(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  provider text not null default 'manual' check(provider='manual'),
  status text not null default 'active' check(status in ('active','canceled')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.subscriptions is 'Personal entitlement compatibility only. No payment provider or commercial subscription is active.';

create table if not exists public.tenant_usage_counters(
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  counter_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  used integer not null default 0 check(used>=0),
  updated_at timestamptz not null default now(),
  unique(tenant_id,counter_key,period_start,period_end)
);

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.tenant_usage_counters enable row level security;
create policy plans_authenticated_read on public.plans for select to authenticated using(status='active');
create policy subscriptions_member_read on public.subscriptions for select to authenticated using(public.is_tenant_member(tenant_id));
create policy tenant_usage_member_read on public.tenant_usage_counters for select to authenticated using(public.is_tenant_member(tenant_id));
grant select on public.plans,public.subscriptions,public.tenant_usage_counters to authenticated;
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
