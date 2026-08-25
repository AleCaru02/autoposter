-- Post Automatici: persistent anti-duplicate and publication memory.
-- The database is the final fail-closed layer: it remembers generated copy and published variants
-- independently from model prompts, browser state, deploys, or provider retries.

alter table public.post_variants
  add column if not exists content_fingerprint text;

comment on column public.post_variants.content_fingerprint is
  'Stable normalized fingerprint of hook + caption + CTA + hashtags. Used to block duplicate copy inside the same tenant/platform.';

create or replace function public.normalize_social_content_for_dedupe(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p_value,'')), 'https?://[^[:space:]]+', '<url>', 'g'),
        '[@#]', '', 'g'
      ),
      '[^[:alnum:]<>]+', ' ', 'g'
    )
  );
$$;

revoke all on function public.normalize_social_content_for_dedupe(text) from public, anon, authenticated;
grant execute on function public.normalize_social_content_for_dedupe(text) to service_role;

create or replace function public.set_post_variant_content_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_normalized text;
begin
  if new.platform_decision = 'skip' then
    new.content_fingerprint := null;
    return new;
  end if;

  v_normalized := public.normalize_social_content_for_dedupe(
    concat_ws(E'\n', new.hook, new.caption, new.cta, array_to_string(coalesce(new.hashtags,'{}'::text[]), ' '))
  );

  if v_normalized = '' then
    new.content_fingerprint := null;
  else
    new.content_fingerprint := md5(v_normalized);
  end if;
  return new;
end;
$$;

revoke all on function public.set_post_variant_content_fingerprint() from public, anon, authenticated;
grant execute on function public.set_post_variant_content_fingerprint() to service_role;

drop trigger if exists post_variants_set_content_fingerprint on public.post_variants;
create trigger post_variants_set_content_fingerprint
before insert or update of hook, caption, cta, hashtags, platform_decision
on public.post_variants
for each row execute function public.set_post_variant_content_fingerprint();

-- Backfill existing variants before enforcing uniqueness.
update public.post_variants
set content_fingerprint = md5(public.normalize_social_content_for_dedupe(
  concat_ws(E'\n', hook, caption, cta, array_to_string(coalesce(hashtags,'{}'::text[]), ' '))
))
where platform_decision <> 'skip'
  and public.normalize_social_content_for_dedupe(
    concat_ws(E'\n', hook, caption, cta, array_to_string(coalesce(hashtags,'{}'::text[]), ' '))
  ) <> '';

-- If historical fixture data contains exact duplicates, keep the newest row valid and
-- clear the older fingerprint. Runtime inserts can no longer create a new duplicate.
with ranked as (
  select id,
         row_number() over (
           partition by tenant_id, platform, content_fingerprint
           order by updated_at desc, created_at desc, id desc
         ) as rn
  from public.post_variants
  where content_fingerprint is not null
    and platform_decision <> 'skip'
)
update public.post_variants pv
set content_fingerprint = null
from ranked r
where pv.id = r.id and r.rn > 1;

create unique index if not exists post_variants_tenant_platform_content_fingerprint_uidx
  on public.post_variants(tenant_id, platform, content_fingerprint)
  where content_fingerprint is not null and platform_decision <> 'skip';

-- A variant is a single publication unit. Provider retries must reconcile the same job/result,
-- never create a second published record for the same variant.
with ranked_published as (
  select id,
         row_number() over (
           partition by tenant_id, post_variant_id
           order by published_at asc, created_at asc, id asc
         ) as rn
  from public.published_posts
)
delete from public.published_posts pp
using ranked_published r
where pp.id = r.id and r.rn > 1;

create unique index if not exists published_posts_tenant_variant_uidx
  on public.published_posts(tenant_id, post_variant_id);

create or replace function public.guard_publication_job_against_republish()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.published_posts pp
    where pp.tenant_id = new.tenant_id
      and pp.post_variant_id = new.post_variant_id
  ) then
    raise exception 'VARIANT_ALREADY_PUBLISHED' using errcode = '23505';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_publication_job_against_republish() from public, anon, authenticated;
grant execute on function public.guard_publication_job_against_republish() to service_role;

drop trigger if exists publication_jobs_block_republish on public.publication_jobs;
create trigger publication_jobs_block_republish
before insert on public.publication_jobs
for each row execute function public.guard_publication_job_against_republish();

-- One durable memory record per post. This is what future generation can consult to avoid
-- repeating already-published topics/hooks/visual concepts while still allowing fresh angles.
with ranked_memory as (
  select id,
         row_number() over (
           partition by tenant_id, post_id
           order by published_at desc nulls last, created_at desc, id desc
         ) as rn
  from public.editorial_memory
  where post_id is not null
)
delete from public.editorial_memory em
using ranked_memory r
where em.id = r.id and r.rn > 1;

alter table public.editorial_memory
  drop constraint if exists editorial_memory_tenant_post_unique;
alter table public.editorial_memory
  add constraint editorial_memory_tenant_post_unique unique (tenant_id, post_id);

create or replace function public.remember_published_content()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_post_id uuid;
  v_topic text;
  v_angle text;
  v_hook text;
  v_cta text;
  v_pillar_id uuid;
  v_visual text;
begin
  select p.id,
         p.topic,
         coalesce(p.core_concept->>'angle', p.objective, ''),
         pv.hook,
         pv.cta,
         p.pillar_id,
         coalesce(pv.visual_brief->>'subject', pv.visual_brief->>'prompt', pv.visual_brief::text)
    into v_post_id, v_topic, v_angle, v_hook, v_cta, v_pillar_id, v_visual
  from public.post_variants pv
  join public.posts p on p.id = pv.post_id and p.tenant_id = pv.tenant_id
  where pv.id = new.post_variant_id
    and pv.tenant_id = new.tenant_id;

  if v_post_id is null then
    return new;
  end if;

  insert into public.editorial_memory(
    tenant_id, post_id, topic, angle, hook, cta, pillar_id, visual_concept, published_at,
    performance_summary
  ) values (
    new.tenant_id, v_post_id, v_topic, v_angle, v_hook, v_cta, v_pillar_id, v_visual,
    new.published_at, '{}'::jsonb
  )
  on conflict (tenant_id, post_id) do update set
    topic = excluded.topic,
    angle = excluded.angle,
    hook = excluded.hook,
    cta = excluded.cta,
    pillar_id = excluded.pillar_id,
    visual_concept = excluded.visual_concept,
    published_at = greatest(public.editorial_memory.published_at, excluded.published_at);

  return new;
end;
$$;

revoke all on function public.remember_published_content() from public, anon, authenticated;
grant execute on function public.remember_published_content() to service_role;

drop trigger if exists published_posts_remember_content on public.published_posts;
create trigger published_posts_remember_content
after insert or update of published_at on public.published_posts
for each row execute function public.remember_published_content();

-- Fingerprint ledger itself should not accumulate the same normalized fingerprint more than once
-- for the same tenant/post variant. Exact content dedupe is enforced above on post_variants.
create unique index if not exists content_fingerprints_tenant_variant_normalized_uidx
  on public.content_fingerprints(tenant_id, post_variant_id, normalized_sha256)
  where post_variant_id is not null and normalized_sha256 is not null;
