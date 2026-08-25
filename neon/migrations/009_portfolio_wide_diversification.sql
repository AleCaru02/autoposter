-- Post Automatici - portfolio-wide differentiation for an unlimited number of owner profiles.
-- Same/similar industries use a strict threshold; unrelated industries still cannot receive copied templates.

create or replace function app_private.enforce_cross_profile_diversity()
returns trigger language plpgsql security definer set search_path=public,app_private,pg_temp as $$
declare
  v_owner uuid;
  v_industry text;
  v_text text;
  v_hash text;
  v_similarity numeric:=0;
  v_industry_similarity numeric:=0;
  v_effective_threshold numeric:=0.90;
begin
  if new.platform_decision='skip' then return new; end if;
  v_owner:=app_private.tenant_primary_owner(new.tenant_id);
  if v_owner is null then return new; end if;
  v_industry:=coalesce(app_private.tenant_industry_key(new.tenant_id),'');
  v_text:=app_private.variant_normalized_text(new.hook,new.caption,new.cta,new.hashtags);
  if length(v_text)<40 then return new; end if;
  v_hash:=encode(digest(v_text,'sha256'),'hex');

  select
    greatest(case when r.content_hash=v_hash then 1 else 0 end,similarity(r.normalized_text,v_text)),
    case
      when r.industry_key=v_industry and v_industry<>'' then 1
      when r.industry_key<>'' and v_industry<>'' then similarity(r.industry_key,v_industry)
      else 0
    end
  into v_similarity,v_industry_similarity
  from app_private.cross_profile_content_registry r
  where r.owner_user_id=v_owner
    and r.tenant_id<>new.tenant_id
    and r.created_at>now()-interval '365 days'
  order by greatest(case when r.content_hash=v_hash then 1 else 0 end,similarity(r.normalized_text,v_text)) desc
  limit 1;

  -- Profiles in the same or a closely related sector must be materially different.
  -- Across unrelated sectors we still reject near-copies/template recycling.
  if coalesce(v_industry_similarity,0)>=0.50 then v_effective_threshold:=0.65; end if;
  if coalesce(v_similarity,0)>=v_effective_threshold then
    raise exception 'PORTFOLIO_CONTENT_TOO_SIMILAR:%',round(v_similarity,3)
      using errcode='23514',hint='Use a different brand position, angle, hook, narrative structure, CTA and visual concept.';
  end if;
  return new;
end $$;

-- Owner-only context now includes the whole portfolio. Industry similarity is included so the AI
-- knows which sibling profiles require the strongest differentiation, without using their facts.
create or replace function public.cross_profile_diversification_context(p_tenant_id uuid,p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
declare
  v_user uuid:=public.current_user_id();
  v_owner uuid;
  v_industry text;
  v_result jsonb;
begin
  if v_user is null or not public.has_tenant_role(p_tenant_id,array['owner']) then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  v_owner:=app_private.tenant_primary_owner(p_tenant_id);
  if v_owner is distinct from v_user then raise exception 'OWNER_REQUIRED' using errcode='42501'; end if;
  v_industry:=coalesce(app_private.tenant_industry_key(p_tenant_id),'');

  select coalesce(jsonb_agg(jsonb_build_object(
    'brandName',x.brand_name,'platform',x.platform,'topic',x.topic,'angle',x.angle,'hook',x.hook,'cta',x.cta,
    'normalizedText',left(x.normalized_text,1800),'visualKey',left(coalesce(x.visual_key,''),500),
    'industrySimilarity',case when x.industry_key=v_industry and v_industry<>'' then 1 when x.industry_key<>'' and v_industry<>'' then similarity(x.industry_key,v_industry) else 0 end,
    'publishedAt',x.published_at,'createdAt',x.created_at
  ) order by
    case when x.industry_key=v_industry and v_industry<>'' then 1 when x.industry_key<>'' and v_industry<>'' then similarity(x.industry_key,v_industry) else 0 end desc,
    x.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select r.* from app_private.cross_profile_content_registry r
    where r.owner_user_id=v_owner and r.tenant_id<>p_tenant_id
    order by r.created_at desc
    limit greatest(1,least(coalesce(p_limit,60),120))
  ) x;
  return v_result;
end $$;
revoke all on function public.cross_profile_diversification_context(uuid,integer) from public,anonymous;
grant execute on function public.cross_profile_diversification_context(uuid,integer) to authenticated;
