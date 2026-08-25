-- Only a decision made by the user from the web app or Telegram can unlock publishing.
-- Internal/system events must never count as publication approval.

-- Remove any legacy system approvals before tightening the contract.
delete from public.post_approvals where source = 'system';

alter table public.post_approvals
  drop constraint if exists post_approvals_source_check;

alter table public.post_approvals
  add constraint post_approvals_source_check
  check (source in ('web','telegram'));

create or replace function public.enforce_human_variant_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_human_approval boolean;
begin
  if new.platform_decision = 'skip' then
    return new;
  end if;

  select exists (
    select 1
    from public.post_approvals pa
    where pa.post_variant_id = new.id
      and pa.tenant_id = new.tenant_id
      and pa.source in ('web','telegram')
  ) into v_has_human_approval;

  if not v_has_human_approval then
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
      and pa.source in ('web','telegram')
  ) then
    return null;
  end if;
  return new;
end;
$$;

-- Keep the aggregate post state coherent: it cannot claim approval while any
-- non-skipped platform variant is still awaiting the user's decision.
create or replace function public.enforce_post_decision_completion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_has_undecided boolean;
begin
  if new.status in ('approved','scheduled','publishing','published') then
    select exists (
      select 1
      from public.post_variants pv
      where pv.post_id = new.id
        and pv.tenant_id = new.tenant_id
        and pv.platform_decision <> 'skip'
        and pv.approval_status not in ('approved','rejected')
    ) into v_has_undecided;

    if v_has_undecided then
      new.status := 'awaiting_approval';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_post_decision_completion() from public, anon, authenticated;
grant execute on function public.enforce_post_decision_completion() to service_role;

drop trigger if exists posts_require_all_platform_decisions on public.posts;
create trigger posts_require_all_platform_decisions
before update of status on public.posts
for each row
execute function public.enforce_post_decision_completion();

-- Re-normalize legacy rows after removing system approvals.
update public.post_variants pv
set approval_status = 'pending',
    status = 'awaiting_approval'
where pv.platform_decision <> 'skip'
  and pv.status not in ('failed','rejected')
  and not exists (
    select 1
    from public.post_approvals pa
    where pa.post_variant_id = pv.id
      and pa.tenant_id = pv.tenant_id
      and pa.source in ('web','telegram')
  );

delete from public.publication_jobs pj
where pj.status in ('queued','retry')
  and not exists (
    select 1
    from public.post_approvals pa
    where pa.post_variant_id = pj.post_variant_id
      and pa.tenant_id = pj.tenant_id
      and pa.source in ('web','telegram')
  );
