-- Human approval is mandatory before any social publication.
-- DEMO/REAL controls data/provider mode only; it must never bypass the preview gate.

-- Disable the legacy trigger that could queue AUTO variants immediately after QA.
drop trigger if exists post_variants_enqueue_auto_publication on public.post_variants;

comment on column public.social_connections.approval_mode is
  'Post-approval delivery preference. AUTO must never bypass human preview/approval.';

create table if not exists public.telegram_approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null references public.post_variants(id) on delete cascade,
  telegram_connection_id uuid references public.telegram_connections(id) on delete set null,
  callback_token_hash text not null unique,
  telegram_chat_id text,
  telegram_message_id text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','regenerate_text','regenerate_visual','regenerate_all','skipped','expired','failed')),
  last_action text check (last_action is null or last_action in ('publish','regenerate_text','regenerate_visual','regenerate_all','skip','reject')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  acted_at timestamptz,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_approval_requests_tenant_status_idx
  on public.telegram_approval_requests(tenant_id, status, created_at desc);
create index if not exists telegram_approval_requests_variant_idx
  on public.telegram_approval_requests(post_variant_id, created_at desc);

create or replace trigger telegram_approval_requests_set_updated_at
before update on public.telegram_approval_requests
for each row execute function public.set_updated_at();

alter table public.telegram_approval_requests enable row level security;

create policy telegram_approval_requests_select_member
on public.telegram_approval_requests
for select to authenticated
using (public.is_tenant_member(tenant_id) or public.is_platform_admin());

create policy telegram_approval_requests_write_editor
on public.telegram_approval_requests
for all to authenticated
using (public.has_tenant_role(tenant_id, array['owner','admin','editor']) or public.is_platform_admin())
with check (public.has_tenant_role(tenant_id, array['owner','admin','editor']) or public.is_platform_admin());

grant select, insert, update on public.telegram_approval_requests to authenticated;

-- A variant may become approved/scheduled/publishing/published only after an explicit
-- post_approvals row exists. This protects every caller, including future provider code.
create or replace function public.enforce_human_variant_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_approval boolean;
begin
  if new.platform_decision = 'skip' then
    return new;
  end if;

  select exists (
    select 1 from public.post_approvals pa
    where pa.post_variant_id = new.id
      and pa.tenant_id = new.tenant_id
  ) into v_has_approval;

  if not v_has_approval then
    if new.approval_status = 'approved' then
      new.approval_status := 'pending';
    end if;

    if new.status in ('approved','scheduled','publishing','published') then
      new.status := 'awaiting_approval';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_human_variant_approval() from public, anon, authenticated;
grant execute on function public.enforce_human_variant_approval() to service_role;

drop trigger if exists post_variants_require_human_approval on public.post_variants;
create trigger post_variants_require_human_approval
before insert or update of approval_status, status, approval_mode
on public.post_variants
for each row
execute function public.enforce_human_variant_approval();

-- Publication jobs are silently suppressed until a real approval event exists.
-- This prevents legacy/internal AUTO code from bypassing preview without breaking generation.
create or replace function public.guard_publication_job_human_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.post_approvals pa
    where pa.post_variant_id = new.post_variant_id
      and pa.tenant_id = new.tenant_id
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_publication_job_human_approval() from public, anon, authenticated;
grant execute on function public.guard_publication_job_human_approval() to service_role;

drop trigger if exists publication_jobs_require_human_approval on public.publication_jobs;
create trigger publication_jobs_require_human_approval
before insert or update of status, scheduled_at
on public.publication_jobs
for each row
execute function public.guard_publication_job_human_approval();

-- Normalize existing non-published AUTO rows that have no explicit approval event.
update public.post_variants pv
set approval_status = 'pending',
    status = 'awaiting_approval'
where pv.platform_decision <> 'skip'
  and pv.status not in ('published','failed','rejected')
  and not exists (
    select 1 from public.post_approvals pa
    where pa.post_variant_id = pv.id
      and pa.tenant_id = pv.tenant_id
  );

delete from public.publication_jobs pj
where pj.status in ('queued','retry')
  and not exists (
    select 1 from public.post_approvals pa
    where pa.post_variant_id = pj.post_variant_id
      and pa.tenant_id = pj.tenant_id
  );
