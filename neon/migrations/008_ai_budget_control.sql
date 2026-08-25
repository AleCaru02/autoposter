-- Post Automatici - portfolio-wide AI budget control.
-- Fail closed: a new owner starts with monthly_limit_usd_micros = 0, therefore no paid AI call is allowed
-- until the owner explicitly sets a budget. 1 USD = 1,000,000 micros.

create table if not exists public.ai_budget_policies(
  owner_user_id uuid primary key,
  currency text not null default 'USD' check(currency='USD'),
  monthly_limit_usd_micros bigint not null default 0 check(monthly_limit_usd_micros>=0),
  daily_limit_usd_micros bigint check(daily_limit_usd_micros is null or daily_limit_usd_micros>=0),
  per_tenant_monthly_limit_usd_micros bigint check(per_tenant_monthly_limit_usd_micros is null or per_tenant_monthly_limit_usd_micros>=0),
  image_monthly_limit_usd_micros bigint check(image_monthly_limit_usd_micros is null or image_monthly_limit_usd_micros>=0),
  premium_monthly_limit_usd_micros bigint check(premium_monthly_limit_usd_micros is null or premium_monthly_limit_usd_micros>=0),
  max_single_request_usd_micros bigint check(max_single_request_usd_micros is null or max_single_request_usd_micros>=0),
  warning_threshold numeric(5,4) not null default 0.80 check(warning_threshold between 0.10 and 1),
  optimization_mode text not null default 'balanced' check(optimization_mode in ('economy','balanced','quality')),
  allow_premium_models boolean not null default false,
  pause_all_ai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ai_budget_policies is 'Owner-controlled hard caps for paid AI usage across every activity/profile.';

create table if not exists public.ai_tenant_budget_overrides(
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  owner_user_id uuid not null,
  monthly_limit_usd_micros bigint check(monthly_limit_usd_micros is null or monthly_limit_usd_micros>=0),
  image_monthly_limit_usd_micros bigint check(image_monthly_limit_usd_micros is null or image_monthly_limit_usd_micros>=0),
  priority_weight numeric(8,4) not null default 1 check(priority_weight>0),
  pause_ai boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_private.ai_spend_reservations(
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  task text not null,
  model text not null,
  model_tier text not null check(model_tier in ('economy','standard','premium','image')),
  spend_kind text not null check(spend_kind in ('text','image','web_search','other')),
  estimated_usd_micros bigint not null check(estimated_usd_micros>=0),
  actual_usd_micros bigint check(actual_usd_micros is null or actual_usd_micros>=0),
  status text not null default 'reserved' check(status in ('reserved','settled','released','failed')),
  idempotency_key text not null unique,
  pricing_version text not null,
  expires_at timestamptz not null default(now()+interval '15 minutes'),
  settled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_spend_owner_created_idx on app_private.ai_spend_reservations(owner_user_id,created_at desc);
create index if not exists ai_spend_tenant_created_idx on app_private.ai_spend_reservations(tenant_id,created_at desc);
create index if not exists ai_spend_active_idx on app_private.ai_spend_reservations(owner_user_id,status,expires_at);
revoke all on app_private.ai_spend_reservations from public,anonymous,authenticated;

alter table public.ai_usage_events
  add column if not exists owner_user_id uuid,
  add column if not exists model_tier text,
  add column if not exists spend_kind text,
  add column if not exists budget_reservation_id uuid,
  add column if not exists pricing_version text;

create or replace function app_private.ensure_ai_budget_for_owner()
returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$
begin
  if new.role='owner' and new.status='active' then
    insert into public.ai_budget_policies(owner_user_id) values(new.user_id)
    on conflict(owner_user_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function app_private.ensure_ai_budget_for_owner() from public,anonymous,authenticated;
drop trigger if exists tenant_members_ensure_ai_budget on public.tenant_members;
create trigger tenant_members_ensure_ai_budget
after insert or update of role,status on public.tenant_members
for each row execute function app_private.ensure_ai_budget_for_owner();

-- Backfill current owners with a zero-spend policy.
insert into public.ai_budget_policies(owner_user_id)
select distinct tm.user_id from public.tenant_members tm where tm.role='owner' and tm.status='active'
on conflict(owner_user_id) do nothing;

create or replace function app_private.enforce_ai_spend_budget()
returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare
  v_policy public.ai_budget_policies%rowtype;
  v_override public.ai_tenant_budget_overrides%rowtype;
  v_owner uuid;
  v_month_start timestamptz:=date_trunc('month',now());
  v_day_start timestamptz:=date_trunc('day',now());
  v_month_total bigint:=0;
  v_day_total bigint:=0;
  v_tenant_total bigint:=0;
  v_image_total bigint:=0;
  v_tenant_image_total bigint:=0;
  v_premium_total bigint:=0;
  v_effective_tenant_cap bigint;
begin
  select tm.user_id into v_owner
  from public.tenant_members tm
  where tm.tenant_id=new.tenant_id and tm.role='owner' and tm.status='active'
  order by tm.created_at asc limit 1;
  if v_owner is null then raise exception 'AI_BUDGET_OWNER_NOT_FOUND' using errcode='42501'; end if;
  new.owner_user_id:=v_owner;

  select * into v_policy from public.ai_budget_policies p where p.owner_user_id=v_owner for update;
  if not found then raise exception 'AI_BUDGET_NOT_CONFIGURED' using errcode='42501'; end if;
  if v_policy.pause_all_ai then raise exception 'AI_BUDGET_PAUSED' using errcode='42501'; end if;
  if v_policy.monthly_limit_usd_micros<=0 then raise exception 'AI_BUDGET_ZERO' using errcode='42501'; end if;
  if new.model_tier='premium' and not v_policy.allow_premium_models then raise exception 'AI_PREMIUM_MODEL_NOT_ALLOWED' using errcode='42501'; end if;
  if v_policy.max_single_request_usd_micros is not null and new.estimated_usd_micros>v_policy.max_single_request_usd_micros then
    raise exception 'AI_SINGLE_REQUEST_BUDGET_EXCEEDED' using errcode='23514';
  end if;

  select * into v_override from public.ai_tenant_budget_overrides o where o.tenant_id=new.tenant_id;
  if found and v_override.pause_ai then raise exception 'AI_TENANT_BUDGET_PAUSED' using errcode='42501'; end if;
  v_effective_tenant_cap:=coalesce(v_override.monthly_limit_usd_micros,v_policy.per_tenant_monthly_limit_usd_micros);

  -- Expired reservations no longer count against the budget.
  update app_private.ai_spend_reservations
  set status='released',updated_at=now()
  where status='reserved' and expires_at<now();

  select coalesce(sum(coalesce(r.actual_usd_micros,r.estimated_usd_micros)),0) into v_month_total
  from app_private.ai_spend_reservations r
  where r.owner_user_id=v_owner and r.created_at>=v_month_start and r.status in ('reserved','settled');
  if v_month_total+new.estimated_usd_micros>v_policy.monthly_limit_usd_micros then raise exception 'AI_MONTHLY_BUDGET_EXCEEDED' using errcode='23514'; end if;

  if v_policy.daily_limit_usd_micros is not null then
    select coalesce(sum(coalesce(r.actual_usd_micros,r.estimated_usd_micros)),0) into v_day_total
    from app_private.ai_spend_reservations r
    where r.owner_user_id=v_owner and r.created_at>=v_day_start and r.status in ('reserved','settled');
    if v_day_total+new.estimated_usd_micros>v_policy.daily_limit_usd_micros then raise exception 'AI_DAILY_BUDGET_EXCEEDED' using errcode='23514'; end if;
  end if;

  if v_effective_tenant_cap is not null then
    select coalesce(sum(coalesce(r.actual_usd_micros,r.estimated_usd_micros)),0) into v_tenant_total
    from app_private.ai_spend_reservations r
    where r.tenant_id=new.tenant_id and r.created_at>=v_month_start and r.status in ('reserved','settled');
    if v_tenant_total+new.estimated_usd_micros>v_effective_tenant_cap then raise exception 'AI_TENANT_MONTHLY_BUDGET_EXCEEDED' using errcode='23514'; end if;
  end if;

  if new.spend_kind='image' and v_policy.image_monthly_limit_usd_micros is not null then
    select coalesce(sum(coalesce(r.actual_usd_micros,r.estimated_usd_micros)),0) into v_image_total
    from app_private.ai_spend_reservations r
    where r.owner_user_id=v_owner and r.created_at>=v_month_start and r.status in ('reserved','settled') and r.spend_kind='image';
    if v_image_total+new.estimated_usd_micros>v_policy.image_monthly_limit_usd_micros then raise exception 'AI_IMAGE_BUDGET_EXCEEDED' using errcode='23514'; end if;
  end if;
  if new.spend_kind='image' and found and v_override.image_monthly_limit_usd_micros is not null then
    select coalesce(sum(coalesce(r.actual_usd_micros,r.estimated_usd_micros)),0) into v_tenant_image_total
    from app_private.ai_spend_reservations r
    where r.tenant_id=new.tenant_id and r.created_at>=v_month_start and r.status in ('reserved','settled') and r.spend_kind='image';
    if v_tenant_image_total+new.estimated_usd_micros>v_override.image_monthly_limit_usd_micros then raise exception 'AI_TENANT_IMAGE_BUDGET_EXCEEDED' using errcode='23514'; end if;
  end if;

  if new.model_tier='premium' and v_policy.premium_monthly_limit_usd_micros is not null then
    select coalesce(sum(coalesce(r.actual_usd_micros,r.estimated_usd_micros)),0) into v_premium_total
    from app_private.ai_spend_reservations r
    where r.owner_user_id=v_owner and r.created_at>=v_month_start and r.status in ('reserved','settled') and r.model_tier='premium';
    if v_premium_total+new.estimated_usd_micros>v_policy.premium_monthly_limit_usd_micros then raise exception 'AI_PREMIUM_BUDGET_EXCEEDED' using errcode='23514'; end if;
  end if;

  return new;
end $$;
revoke all on function app_private.enforce_ai_spend_budget() from public,anonymous,authenticated;
drop trigger if exists ai_spend_budget_guard on app_private.ai_spend_reservations;
create trigger ai_spend_budget_guard
before insert on app_private.ai_spend_reservations
for each row execute function app_private.enforce_ai_spend_budget();

alter table public.ai_budget_policies enable row level security;
alter table public.ai_tenant_budget_overrides enable row level security;
create policy ai_budget_owner_read on public.ai_budget_policies for select to authenticated using(owner_user_id=public.current_user_id());
create policy ai_budget_owner_update on public.ai_budget_policies for update to authenticated using(owner_user_id=public.current_user_id()) with check(owner_user_id=public.current_user_id());
create policy ai_tenant_budget_owner_read on public.ai_tenant_budget_overrides for select to authenticated using(owner_user_id=public.current_user_id() and public.has_tenant_role(tenant_id,array['owner']));
create policy ai_tenant_budget_owner_insert on public.ai_tenant_budget_overrides for insert to authenticated with check(owner_user_id=public.current_user_id() and public.has_tenant_role(tenant_id,array['owner']));
create policy ai_tenant_budget_owner_update on public.ai_tenant_budget_overrides for update to authenticated using(owner_user_id=public.current_user_id() and public.has_tenant_role(tenant_id,array['owner'])) with check(owner_user_id=public.current_user_id() and public.has_tenant_role(tenant_id,array['owner']));
create policy ai_tenant_budget_owner_delete on public.ai_tenant_budget_overrides for delete to authenticated using(owner_user_id=public.current_user_id() and public.has_tenant_role(tenant_id,array['owner']));

grant select,update on public.ai_budget_policies to authenticated;
grant select,insert,update,delete on public.ai_tenant_budget_overrides to authenticated;
create trigger ai_budget_policies_set_updated_at before update on public.ai_budget_policies for each row execute function public.set_updated_at();
create trigger ai_tenant_budget_overrides_set_updated_at before update on public.ai_tenant_budget_overrides for each row execute function public.set_updated_at();
