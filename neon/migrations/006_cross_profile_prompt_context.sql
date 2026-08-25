-- Owner-only prompt context for proactive cross-profile diversification.
-- It contains only content from profiles owned by the same current user and same industry.

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
    'brandName',x.brand_name,
    'platform',x.platform,
    'topic',x.topic,
    'angle',x.angle,
    'hook',x.hook,
    'cta',x.cta,
    'normalizedText',left(x.normalized_text,1800),
    'visualKey',left(coalesce(x.visual_key,''),500),
    'publishedAt',x.published_at,
    'createdAt',x.created_at
  ) order by x.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select r.*
    from app_private.cross_profile_content_registry r
    where r.owner_user_id=v_owner
      and r.tenant_id<>p_tenant_id
      and r.industry_key=v_industry
    order by r.created_at desc
    limit greatest(1,least(coalesce(p_limit,40),100))
  ) x;
  return v_result;
end $$;
revoke all on function public.cross_profile_diversification_context(uuid,integer) from public,anonymous;
grant execute on function public.cross_profile_diversification_context(uuid,integer) to authenticated;
