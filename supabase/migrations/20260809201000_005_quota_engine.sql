-- Server-side quota engine with idempotent reservations.
-- Clients can read entitlements/usage but cannot reserve or commit quota directly.

create table if not exists public.quota_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  metric text not null,
  amount bigint not null check (amount > 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  idempotency_key text not null,
  status text not null default 'reserved' check (status in ('reserved','committed','released')),
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  unique (tenant_id, idempotency_key),
  check (period_end > period_start)
);
create index if not exists quota_reservations_lookup_idx
  on public.quota_reservations(tenant_id, metric, period_end desc, status);

alter table public.quota_reservations enable row level security;
create policy quota_reservations_tenant_select on public.quota_reservations
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());
grant select on public.quota_reservations to authenticated;

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
  order by s.created_at desc
  limit 1;

  if v_plan.id is null then
    return jsonb_build_object(
      'has_plan', false,
      'posts_per_week', 0,
      'monthly_post_limit', 0,
      'platforms', '[]'::jsonb,
      'auto_publish_allowed', false,
      'website_page_limit', 0,
      'ai_budget_cents', 0,
      'storage_mb', 0,
      'team_members', 1,
      'overrides', '{}'::jsonb
    );
  end if;

  select coalesce(tpo.overrides, '{}'::jsonb) into v_overrides
  from public.tenant_plan_overrides tpo
  where tpo.tenant_id = p_tenant_id
    and (tpo.expires_at is null or tpo.expires_at > now());

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
    'overrides', v_overrides
  );
end;
$$;
revoke all on function app_private.resolve_tenant_entitlements(uuid) from anon, authenticated;

create or replace function public.get_tenant_entitlements(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_tenant_member(p_tenant_id) or public.is_platform_admin()) then
    raise exception 'TENANT_ACCESS_DENIED' using errcode = '42501';
  end if;
  return app_private.resolve_tenant_entitlements(p_tenant_id);
end;
$$;
revoke all on function public.get_tenant_entitlements(uuid) from public;
grant execute on function public.get_tenant_entitlements(uuid) to authenticated;

create or replace function public.reserve_tenant_usage(
  p_tenant_id uuid,
  p_metric text,
  p_amount bigint,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlements jsonb;
  v_limit bigint;
  v_counter public.tenant_usage_counters%rowtype;
  v_existing public.quota_reservations%rowtype;
  v_reservation_id uuid;
begin
  if p_amount <= 0 or p_period_end <= p_period_start or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'INVALID_QUOTA_RESERVATION' using errcode = '22023';
  end if;

  select * into v_existing
  from public.quota_reservations
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'reservation_id', v_existing.id,
      'status', v_existing.status,
      'metric', v_existing.metric,
      'amount', v_existing.amount,
      'idempotent_replay', true
    );
  end if;

  v_entitlements := app_private.resolve_tenant_entitlements(p_tenant_id);
  if coalesce((v_entitlements ->> 'has_plan')::boolean, false) is false then
    raise exception 'NO_ACTIVE_PLAN' using errcode = '42501';
  end if;

  v_limit := case p_metric
    when 'posts_week' then nullif((v_entitlements ->> 'posts_per_week')::bigint, 0)
    when 'posts_month' then (v_entitlements ->> 'monthly_post_limit')::bigint
    when 'ai_budget_cents' then (v_entitlements ->> 'ai_budget_cents')::bigint
    when 'storage_mb' then (v_entitlements ->> 'storage_mb')::bigint
    else null
  end;

  if p_metric = 'posts_week' and coalesce((v_entitlements ->> 'posts_per_week')::bigint, 0) = 0 then
    raise exception 'QUOTA_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.tenant_usage_counters(tenant_id, metric, period_start, period_end, used, reserved)
  values (p_tenant_id, p_metric, p_period_start, p_period_end, 0, 0)
  on conflict (tenant_id, metric, period_start, period_end) do nothing;

  select * into v_counter
  from public.tenant_usage_counters
  where tenant_id = p_tenant_id
    and metric = p_metric
    and period_start = p_period_start
    and period_end = p_period_end
  for update;

  if v_limit is not null and (v_counter.used + v_counter.reserved + p_amount) > v_limit then
    raise exception 'QUOTA_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.quota_reservations(
    tenant_id, metric, amount, period_start, period_end, idempotency_key, status
  ) values (
    p_tenant_id, p_metric, p_amount, p_period_start, p_period_end, p_idempotency_key, 'reserved'
  ) returning id into v_reservation_id;

  update public.tenant_usage_counters
  set reserved = reserved + p_amount, updated_at = now()
  where id = v_counter.id;

  return jsonb_build_object(
    'reservation_id', v_reservation_id,
    'status', 'reserved',
    'metric', p_metric,
    'amount', p_amount,
    'limit', v_limit,
    'used', v_counter.used,
    'reserved_after', v_counter.reserved + p_amount,
    'idempotent_replay', false
  );
end;
$$;

create or replace function public.commit_tenant_usage(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res public.quota_reservations%rowtype;
begin
  select * into v_res from public.quota_reservations where id = p_reservation_id for update;
  if v_res.id is null then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = '22023';
  end if;
  if v_res.status = 'committed' then
    return jsonb_build_object('reservation_id', v_res.id, 'status', 'committed', 'idempotent_replay', true);
  end if;
  if v_res.status = 'released' then
    raise exception 'RESERVATION_ALREADY_RELEASED' using errcode = 'P0001';
  end if;

  update public.tenant_usage_counters
  set reserved = greatest(0, reserved - v_res.amount), used = used + v_res.amount, updated_at = now()
  where tenant_id = v_res.tenant_id
    and metric = v_res.metric
    and period_start = v_res.period_start
    and period_end = v_res.period_end;

  update public.quota_reservations
  set status = 'committed', committed_at = now()
  where id = v_res.id;

  return jsonb_build_object('reservation_id', v_res.id, 'status', 'committed', 'idempotent_replay', false);
end;
$$;

create or replace function public.release_tenant_usage(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res public.quota_reservations%rowtype;
begin
  select * into v_res from public.quota_reservations where id = p_reservation_id for update;
  if v_res.id is null then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = '22023';
  end if;
  if v_res.status = 'released' then
    return jsonb_build_object('reservation_id', v_res.id, 'status', 'released', 'idempotent_replay', true);
  end if;
  if v_res.status = 'committed' then
    raise exception 'RESERVATION_ALREADY_COMMITTED' using errcode = 'P0001';
  end if;

  update public.tenant_usage_counters
  set reserved = greatest(0, reserved - v_res.amount), updated_at = now()
  where tenant_id = v_res.tenant_id
    and metric = v_res.metric
    and period_start = v_res.period_start
    and period_end = v_res.period_end;

  update public.quota_reservations
  set status = 'released', released_at = now()
  where id = v_res.id;

  return jsonb_build_object('reservation_id', v_res.id, 'status', 'released', 'idempotent_replay', false);
end;
$$;

-- Only privileged server code can mutate quota. Authenticated users cannot call these RPCs.
revoke all on function public.reserve_tenant_usage(uuid, text, bigint, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.commit_tenant_usage(uuid) from public, anon, authenticated;
revoke all on function public.release_tenant_usage(uuid) from public, anon, authenticated;
grant execute on function public.reserve_tenant_usage(uuid, text, bigint, timestamptz, timestamptz, text) to service_role;
grant execute on function public.commit_tenant_usage(uuid) to service_role;
grant execute on function public.release_tenant_usage(uuid) to service_role;
