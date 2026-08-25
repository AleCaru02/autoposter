-- Post Automatici - cross-profile diversification for profiles owned by the same user.
-- Profiles remain isolated. Only server-side derived memory is compared and owner-only context can be read.
-- Exact and near-identical social variants are blocked across sibling profiles in the same industry.

create extension if not exists pg_trgm;

create table if not exists app_private.cross_profile_content_registry(
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null unique references public.post_variants(id) on delete cascade,
  platform text not null,
  brand_name text,
  industry_key text not null default '',
  topic text,
  angle text,
  hook text,
  cta text,
  normalized_text text not null,
  content_hash text not null,
  visual_key text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cross_profile_registry_owner_industry_idx
  on app_private.cross_profile_content_registry(owner_user_id,industry_key,platform,created_at desc);
create index if not exists cross_profile_registry_hash_idx
  on app_private.cross_profile_content_registry(owner_user_id,industry_key,platform,content_hash);
create index if not exists cross_profile_registry_text_trgm_idx
  on app_private.cross_profile_content_registry using gin(normalized_text gin_trgm_ops);
revoke all on app_private.cross_profile_content_registry from public,anonymous,authenticated;

create or replace function app_private.tenant_primary_owner(p_tenant_id uuid)
returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select tm.user_id
  from public.tenant_members tm
  where tm.tenant_id=p_tenant_id and tm.role='owner' and tm.status='active'
  order by tm.created_at asc
  limit 1
$$;
revoke all on function app_private.tenant_primary_owner(uuid) from public,anonymous,authenticated;

create or replace function app_private.tenant_industry_key(p_tenant_id uuid)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select lower(regexp_replace(coalesce(bp.industry,'')||' '||coalesce(bp.sub_industry,''),'[^[:alnum:]]+',' ','g'))
  from public.brand_profiles bp where bp.tenant_id=p_tenant_id limit 1
$$;
revoke all on function app_private.tenant_industry_key(uuid) from public,anonymous,authenticated;

create or replace function app_private.variant_normalized_text(
  p_hook text,p_caption text,p_cta text,p_hashtags text[]
) returns text language sql immutable as $$
  select public.normalize_social_content_for_dedupe(
    concat_ws(E'\n',coalesce(p_hook,''),coalesce(p_caption,''),coalesce(p_cta,''),array_to_string(coalesce(p_hashtags,'{}'::text[]),' '))
  )
$$;
revoke all on function app_private.variant_normalized_text(text,text,text,text[]) from public,anonymous,authenticated;

create or replace function app_private.enforce_cross_profile_diversity()
returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare
  v_owner uuid;
  v_industry text;
  v_text text;
  v_hash text;
  v_similarity numeric;
  v_conflict_tenant uuid;
begin
  if new.platform_decision='skip' then return new; end if;
  v_owner:=app_private.tenant_primary_owner(new.tenant_id);
  if v_owner is null then return new; end if;
  v_industry:=coalesce(app_private.tenant_industry_key(new.tenant_id),'');
  v_text:=app_private.variant_normalized_text(new.hook,new.caption,new.cta,new.hashtags);
  if length(v_text)<40 then return new; end if;
  v_hash:=encode(digest(v_text,'sha256'),'hex');

  select greatest(
      case when r.content_hash=v_hash then 1 else 0 end,
      similarity(r.normalized_text,v_text)
    ),r.tenant_id
  into v_similarity,v_conflict_tenant
  from app_private.cross_profile_content_registry r
  where r.owner_user_id=v_owner
    and r.tenant_id<>new.tenant_id
    and r.platform=new.platform
    and r.industry_key=v_industry
    and r.created_at>now()-interval '365 days'
  order by greatest(case when r.content_hash=v_hash then 1 else 0 end,similarity(r.normalized_text,v_text)) desc
  limit 1;

  if coalesce(v_similarity,0)>=0.82 then
    raise exception 'CROSS_PROFILE_CONTENT_TOO_SIMILAR:%',round(v_similarity,3)
      using errcode='23514',hint='Regenerate with a different angle, hook, CTA, structure and visual concept for this profile.';
  end if;
  return new;
end $$;
revoke all on function app_private.enforce_cross_profile_diversity() from public,anonymous,authenticated;

drop trigger if exists post_variants_cross_profile_diversity on public.post_variants;
create trigger post_variants_cross_profile_diversity
before insert or update of hook,caption,cta,hashtags,platform,platform_decision
on public.post_variants for each row execute function app_private.enforce_cross_profile_diversity();

create or replace function app_private.sync_cross_profile_registry()
returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare
  v_owner uuid;
  v_industry text;
  v_text text;
  v_topic text;
  v_angle text;
  v_brand text;
  v_visual text;
begin
  if tg_op='DELETE' then
    delete from app_private.cross_profile_content_registry where post_variant_id=old.id;
    return old;
  end if;
  if new.platform_decision='skip' then
    delete from app_private.cross_profile_content_registry where post_variant_id=new.id;
    return new;
  end if;
  v_owner:=app_private.tenant_primary_owner(new.tenant_id);
  if v_owner is null then return new; end if;
  v_industry:=coalesce(app_private.tenant_industry_key(new.tenant_id),'');
  v_text:=app_private.variant_normalized_text(new.hook,new.caption,new.cta,new.hashtags);
  select p.topic,coalesce(p.core_concept->>'angle',p.objective,''),bp.brand_name
    into v_topic,v_angle,v_brand
  from public.posts p
  left join public.brand_profiles bp on bp.tenant_id=p.tenant_id
  where p.id=new.post_id and p.tenant_id=new.tenant_id;
  v_visual:=coalesce(new.visual_brief->>'visualKey',new.visual_brief->>'prompt',new.visual_brief->>'subject',new.visual_brief::text);

  insert into app_private.cross_profile_content_registry(
    owner_user_id,tenant_id,post_variant_id,platform,brand_name,industry_key,topic,angle,hook,cta,normalized_text,content_hash,visual_key,updated_at
  ) values(
    v_owner,new.tenant_id,new.id,new.platform,v_brand,v_industry,v_topic,v_angle,new.hook,new.cta,v_text,encode(digest(v_text,'sha256'),'hex'),v_visual,now()
  )
  on conflict(post_variant_id) do update set
    owner_user_id=excluded.owner_user_id,platform=excluded.platform,brand_name=excluded.brand_name,industry_key=excluded.industry_key,
    topic=excluded.topic,angle=excluded.angle,hook=excluded.hook,cta=excluded.cta,normalized_text=excluded.normalized_text,
    content_hash=excluded.content_hash,visual_key=excluded.visual_key,updated_at=now();
  return new;
end $$;
revoke all on function app_private.sync_cross_profile_registry() from public,anonymous,authenticated;

drop trigger if exists post_variants_sync_cross_profile_registry on public.post_variants;
create trigger post_variants_sync_cross_profile_registry
after insert or update of hook,caption,cta,hashtags,visual_brief,platform,platform_decision
on public.post_variants for each row execute function app_private.sync_cross_profile_registry();
drop trigger if exists post_variants_delete_cross_profile_registry on public.post_variants;
create trigger post_variants_delete_cross_profile_registry
after delete on public.post_variants for each row execute function app_private.sync_cross_profile_registry();

create or replace function app_private.mark_cross_profile_published()
returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$
begin
  update app_private.cross_profile_content_registry
  set published_at=new.published_at,updated_at=now()
  where post_variant_id=new.post_variant_id;
  return new;
end $$;
revoke all on function app_private.mark_cross_profile_published() from public,anonymous,authenticated;
drop trigger if exists published_posts_mark_cross_profile_registry on public.published_posts;
create trigger published_posts_mark_cross_profile_registry
after insert or update of published_at on public.published_posts
for each row execute function app_private.mark_cross_profile_published();

create or replace function public.cross_profile_diversification_context(p_tenant_id uuid,p_limit integer default 40)
returns jsonb language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
declare
  v_user uuid:=public.current_user_id();
  v_owner uuid;
  v_industry text;
  v_result jsonb;
begin
  if v_user is null or not public.has_tenant_role(p_tenant_id,array['owner']) then
    raise exception 'OWNER_REQUIRED' using errcode='42501';
  end if;
  v_owner:=app_private.tenant_primary_owner(p_tenant_id);
  if v_owner is distinct from v_user then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  v_industry:=coalesce(app_private.tenant_industry_key(p_tenant_id),'');

  select coalesce(jsonb_agg(jsonb_build_object(
    'brandName',x.brand_name,'platform',x.platform,'topic',x.topic,'angle',x.angle,'hook',x.hook,'cta',x.cta,
    'visualKey',left(coalesce(x.visual_key,''),500),'publishedAt',x.published_at,'createdAt',x.created_at
  ) order by x.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select r.* from app_private.cross_profile_content_registry r
    where r.owner_user_id=v_owner and r.tenant_id<>p_tenant_id and r.industry_key=v_industry
    order by r.created_at desc limit greatest(1,least(coalesce(p_limit,40),100))
  ) x;
  return v_result;
end $$;
revoke all on function public.cross_profile_diversification_context(uuid,integer) from public,anonymous;
grant execute on function public.cross_profile_diversification_context(uuid,integer) to authenticated;

-- Backfill existing generated variants so future profiles immediately have memory.
insert into app_private.cross_profile_content_registry(
  owner_user_id,tenant_id,post_variant_id,platform,brand_name,industry_key,topic,angle,hook,cta,normalized_text,content_hash,visual_key,created_at,updated_at
)
select
  app_private.tenant_primary_owner(pv.tenant_id),pv.tenant_id,pv.id,pv.platform,bp.brand_name,
  coalesce(app_private.tenant_industry_key(pv.tenant_id),''),p.topic,coalesce(p.core_concept->>'angle',p.objective,''),pv.hook,pv.cta,
  app_private.variant_normalized_text(pv.hook,pv.caption,pv.cta,pv.hashtags),
  encode(digest(app_private.variant_normalized_text(pv.hook,pv.caption,pv.cta,pv.hashtags),'sha256'),'hex'),
  coalesce(pv.visual_brief->>'visualKey',pv.visual_brief->>'prompt',pv.visual_brief->>'subject',pv.visual_brief::text),pv.created_at,pv.updated_at
from public.post_variants pv
join public.posts p on p.id=pv.post_id and p.tenant_id=pv.tenant_id
left join public.brand_profiles bp on bp.tenant_id=pv.tenant_id
where pv.platform_decision<>'skip' and app_private.tenant_primary_owner(pv.tenant_id) is not null
on conflict(post_variant_id) do nothing;
