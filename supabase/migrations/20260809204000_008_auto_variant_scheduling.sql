-- Per-platform AUTO/MANUALE scheduling.
-- AUTO variants that already passed QA become queued independently from MANUAL siblings.

create or replace function public.enqueue_auto_publication_variant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.platform_decision <> 'skip'
     and new.approval_mode = 'auto'
     and new.approval_status = 'approved'
     and new.status in ('approved','scheduled') then
    insert into public.publication_jobs (
      tenant_id,
      post_variant_id,
      platform,
      scheduled_at,
      idempotency_key,
      status,
      max_attempts
    ) values (
      new.tenant_id,
      new.id,
      new.platform,
      coalesce(new.scheduled_at, now()),
      new.tenant_id::text || ':' || new.id::text || ':v1',
      'queued',
      3
    )
    on conflict (tenant_id, idempotency_key) do nothing;

    if new.status = 'approved' then
      update public.post_variants
      set status = 'scheduled'
      where id = new.id and status = 'approved';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enqueue_auto_publication_variant() from public, anon, authenticated;
grant execute on function public.enqueue_auto_publication_variant() to service_role;

drop trigger if exists post_variants_enqueue_auto_publication on public.post_variants;
create trigger post_variants_enqueue_auto_publication
after insert or update of approval_mode, approval_status, status, scheduled_at
on public.post_variants
for each row
when (new.platform_decision <> 'skip')
execute function public.enqueue_auto_publication_variant();
