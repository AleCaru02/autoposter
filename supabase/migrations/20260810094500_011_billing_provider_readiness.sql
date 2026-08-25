-- Stripe/billing readiness only. No Stripe API calls, product creation, price IDs or live secrets.

create table if not exists app_private.billing_plan_mappings (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe')),
  environment text not null check (environment in ('STAGING','PRODUCTION')),
  external_product_id text,
  external_price_id text,
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, provider, environment),
  unique (provider, environment, external_price_id)
);

revoke all on app_private.billing_plan_mappings from anon, authenticated;
grant all on app_private.billing_plan_mappings to service_role;

create table if not exists public.billing_sync_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null default 'stripe',
  external_event_id text,
  event_type text not null,
  status text not null check (status in ('received','processed','failed','ignored_duplicate')),
  idempotency_key text not null,
  entitlement_snapshot jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, idempotency_key),
  unique (provider, external_event_id)
);
create index if not exists billing_sync_tenant_idx on public.billing_sync_events(tenant_id, created_at desc);

alter table public.billing_sync_events enable row level security;
create policy billing_sync_read on public.billing_sync_events
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

grant select on public.billing_sync_events to authenticated;
grant all on public.billing_sync_events to service_role;
