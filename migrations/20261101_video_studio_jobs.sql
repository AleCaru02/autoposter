-- Video Studio: durable job ledger and per-profile monthly spend reservations.
-- Apply only after review; this migration does not enable paid providers.
create table if not exists public.video_studio_budget (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  month_utc date not null,
  cap_eur numeric(10,4) not null default 30 check (cap_eur >= 0 and cap_eur <= 30),
  reserved_eur numeric(10,4) not null default 0 check (reserved_eur >= 0),
  spent_eur numeric(10,4) not null default 0 check (spent_eur >= 0),
  primary key (profile_id, month_utc),
  constraint video_studio_budget_cap check (reserved_eur + spent_eur <= cap_eur)
);
create table if not exists public.video_studio_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  state text not null default 'QUEUED' check (state in ('QUEUED','GENERATING','RENDERING','READY','FAILED','CANCELLED')),
  plan jsonb not null,
  reserved_eur numeric(10,4) not null default 0,
  actual_eur numeric(10,4) not null default 0,
  month_utc date not null,
  output_key text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id,idempotency_key)
);
create index if not exists video_studio_jobs_profile_created_idx on public.video_studio_jobs(profile_id,created_at desc);
-- Reserve budget and enqueue atomically; the caller must verify profile ownership
-- through the authenticated backend BEFORE invoking this transaction.
create or replace function public.reserve_video_studio_job(
  p_profile_id uuid, p_idempotency_key text, p_plan jsonb, p_estimate_eur numeric
) returns uuid language plpgsql security invoker as $$
declare
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_id uuid;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 8 or length(p_idempotency_key) > 128
    or p_estimate_eur is null or p_estimate_eur <= 0 or p_estimate_eur > 30 then
    raise exception 'INVALID_JOB_REQUEST';
  end if;
  select id into v_id from public.video_studio_jobs
    where profile_id=p_profile_id and idempotency_key=p_idempotency_key;
  if v_id is not null then return v_id; end if;
  insert into public.video_studio_budget(profile_id,month_utc) values(p_profile_id,v_month)
    on conflict do nothing;
  update public.video_studio_budget
    set reserved_eur=reserved_eur+p_estimate_eur
    where profile_id=p_profile_id and month_utc=v_month
      and spent_eur+reserved_eur+p_estimate_eur<=cap_eur;
  if not found then raise exception 'VIDEO_BUDGET_EXCEEDED'; end if;
  insert into public.video_studio_jobs(profile_id,idempotency_key,plan,reserved_eur,month_utc)
    values(p_profile_id,p_idempotency_key,p_plan,p_estimate_eur,v_month)
    on conflict(profile_id,idempotency_key) do nothing
    returning id into v_id;
  if v_id is null then
    -- Concurrent identical requests must not double-reserve.
    update public.video_studio_budget set reserved_eur=reserved_eur-p_estimate_eur
      where profile_id=p_profile_id and month_utc=v_month;
    select id into v_id from public.video_studio_jobs
      where profile_id=p_profile_id and idempotency_key=p_idempotency_key;
  end if;
  return v_id;
end $$;
-- RLS: never expose budget or job rows across tenants.
alter table public.video_studio_budget enable row level security;
alter table public.video_studio_jobs enable row level security;
-- No permissive client policies: service backend must enforce ownership.
