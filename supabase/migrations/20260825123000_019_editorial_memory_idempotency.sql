-- Post Automatici: one durable editorial-memory row per tenant/post.
-- Publication already records memory via the published_posts trigger; analytics enrichment may
-- write the same post again moments later. Make that second write an idempotent merge instead
-- of a unique-constraint failure.

create or replace function public.merge_duplicate_editorial_memory_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_id uuid;
begin
  if new.post_id is null then
    return new;
  end if;

  select em.id into v_existing_id
  from public.editorial_memory em
  where em.tenant_id = new.tenant_id
    and em.post_id = new.post_id
  limit 1;

  if v_existing_id is null then
    return new;
  end if;

  update public.editorial_memory em
  set topic = coalesce(nullif(new.topic, ''), em.topic),
      angle = coalesce(nullif(new.angle, ''), em.angle),
      hook = coalesce(nullif(new.hook, ''), em.hook),
      cta = coalesce(nullif(new.cta, ''), em.cta),
      pillar_id = coalesce(new.pillar_id, em.pillar_id),
      visual_concept = coalesce(nullif(new.visual_concept, ''), em.visual_concept),
      published_at = case
        when em.published_at is null then new.published_at
        when new.published_at is null then em.published_at
        else greatest(em.published_at, new.published_at)
      end,
      performance_summary = case
        when new.performance_summary is null or new.performance_summary = '{}'::jsonb then em.performance_summary
        else coalesce(em.performance_summary, '{}'::jsonb) || new.performance_summary
      end
  where em.id = v_existing_id;

  -- Returning NULL from a BEFORE INSERT trigger intentionally suppresses the duplicate row.
  return null;
end;
$$;

revoke all on function public.merge_duplicate_editorial_memory_insert() from public, anon, authenticated;
grant execute on function public.merge_duplicate_editorial_memory_insert() to service_role;

drop trigger if exists editorial_memory_merge_duplicate_insert on public.editorial_memory;
create trigger editorial_memory_merge_duplicate_insert
before insert on public.editorial_memory
for each row execute function public.merge_duplicate_editorial_memory_insert();
