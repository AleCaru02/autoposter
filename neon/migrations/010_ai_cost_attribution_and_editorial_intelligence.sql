-- Post Automatici - per-post AI cost attribution + editorial intelligence.
-- Distinguish real publish format from creative/narrative mode.

alter table public.posts
  add column if not exists content_mode text,
  add column if not exists format_reason text,
  add column if not exists format_confidence numeric(5,4);

alter table public.posts drop constraint if exists posts_content_mode_check;
alter table public.posts add constraint posts_content_mode_check check(content_mode is null or content_mode in ('educational','storytelling','promotional','social_proof','behind_scenes','faq','comparison','listicle','local','community','newsjacking'));
alter table public.posts drop constraint if exists posts_format_confidence_check;
alter table public.posts add constraint posts_format_confidence_check check(format_confidence is null or format_confidence between 0 and 1);

alter table public.post_variants
  add column if not exists content_mode text,
  add column if not exists format_reason text,
  add column if not exists hashtag_strategy jsonb not null default '{}'::jsonb;

alter table public.post_variants drop constraint if exists post_variants_content_mode_check;
alter table public.post_variants add constraint post_variants_content_mode_check check(content_mode is null or content_mode in ('educational','storytelling','promotional','social_proof','behind_scenes','faq','comparison','listicle','local','community','newsjacking'));

alter table app_private.ai_spend_reservations
  add column if not exists post_id uuid references public.posts(id) on delete set null,
  add column if not exists post_variant_id uuid references public.post_variants(id) on delete set null;

alter table public.ai_usage_events
  add column if not exists post_id uuid references public.posts(id) on delete set null,
  add column if not exists post_variant_id uuid references public.post_variants(id) on delete set null;

create index if not exists ai_usage_tenant_created_idx on public.ai_usage_events(tenant_id,created_at desc);
create index if not exists ai_usage_post_created_idx on public.ai_usage_events(post_id,created_at desc) where post_id is not null;
create index if not exists ai_usage_variant_created_idx on public.ai_usage_events(post_variant_id,created_at desc) where post_variant_id is not null;
create index if not exists ai_spend_post_idx on app_private.ai_spend_reservations(post_id,created_at desc) where post_id is not null;
create index if not exists ai_spend_variant_idx on app_private.ai_spend_reservations(post_variant_id,created_at desc) where post_variant_id is not null;

alter table public.learning_insights drop constraint if exists learning_insights_insight_type_check;
alter table public.learning_insights add constraint learning_insights_insight_type_check check(insight_type in ('pillar','cta','style','format','platform','approval','general','schedule','topic','hashtag'));

-- Owner-only report. A report can target the active profile or the entire owner portfolio.
create or replace function public.ai_cost_report(
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_scope text default 'tenant',
  p_timezone text default 'Europe/Rome'
) returns jsonb
language plpgsql stable security definer set search_path=public,app_private,pg_temp as $$
declare
  v_user uuid:=public.current_user_id();
  v_result jsonb;
  v_from timestamptz;
  v_to timestamptz;
begin
  if v_user is null or not public.has_tenant_role(p_tenant_id,array['owner']) then
    raise exception 'OWNER_REQUIRED' using errcode='42501';
  end if;
  if p_scope not in ('tenant','portfolio') then raise exception 'AI_COST_SCOPE_INVALID'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'AI_COST_DATE_RANGE_INVALID'; end if;
  begin perform now() at time zone p_timezone; exception when others then raise exception 'AI_COST_TIMEZONE_INVALID'; end;
  v_from:=(p_from::timestamp at time zone p_timezone);
  v_to:=((p_to+1)::timestamp at time zone p_timezone);

  with eligible as (
    select tm.tenant_id
    from public.tenant_members tm
    where tm.user_id=v_user and tm.role='owner' and tm.status='active'
  ), base as (
    select ue.id,ue.tenant_id,t.name as tenant_name,ue.post_id,ue.post_variant_id,ue.task,ue.model,ue.model_tier,ue.spend_kind,
      coalesce(ue.actual_cost_microunits,ue.estimated_cost_microunits,0)::bigint as cost_micros,
      ue.created_at,(ue.created_at at time zone p_timezone) as local_created,
      p.topic,coalesce(pv.format,p.format,'unknown') as format,coalesce(pv.content_mode,p.content_mode,'unknown') as content_mode,
      pv.platform
    from public.ai_usage_events ue
    join eligible e on e.tenant_id=ue.tenant_id
    join public.tenants t on t.id=ue.tenant_id
    left join public.posts p on p.id=ue.post_id and p.tenant_id=ue.tenant_id
    left join public.post_variants pv on pv.id=ue.post_variant_id and pv.tenant_id=ue.tenant_id
    where ue.created_at>=v_from and ue.created_at<v_to
      and (p_scope='portfolio' or ue.tenant_id=p_tenant_id)
  ), daily as (
    select local_created::date as bucket,sum(cost_micros)::bigint cost,count(*)::int calls from base group by 1 order by 1
  ), weekly as (
    select date_trunc('week',local_created)::date as bucket,sum(cost_micros)::bigint cost,count(*)::int calls from base group by 1 order by 1
  ), monthly as (
    select date_trunc('month',local_created)::date as bucket,sum(cost_micros)::bigint cost,count(*)::int calls from base group by 1 order by 1
  ), by_tenant as (
    select tenant_id,tenant_name,sum(cost_micros)::bigint cost,count(*)::int calls from base group by 1,2 order by cost desc
  ), by_post as (
    select post_id,tenant_id,tenant_name,max(topic) topic,max(format) format,max(content_mode) content_mode,
      sum(cost_micros)::bigint cost,count(*)::int calls,
      sum(case when spend_kind='image' then cost_micros else 0 end)::bigint image_cost,
      sum(case when spend_kind='text' then cost_micros else 0 end)::bigint text_cost
    from base where post_id is not null group by 1,2,3 order by cost desc
  ), by_format as (
    select format,sum(cost_micros)::bigint cost,count(*)::int calls from base group by 1 order by cost desc
  ), by_mode as (
    select content_mode,sum(cost_micros)::bigint cost,count(*)::int calls from base group by 1 order by cost desc
  ), by_task as (
    select task,sum(cost_micros)::bigint cost,count(*)::int calls from base group by 1 order by cost desc
  ), by_model as (
    select model,coalesce(model_tier,'unknown') model_tier,sum(cost_micros)::bigint cost,count(*)::int calls from base group by 1,2 order by cost desc
  ), reserved as (
    select coalesce(sum(r.estimated_usd_micros),0)::bigint cost
    from app_private.ai_spend_reservations r
    join eligible e on e.tenant_id=r.tenant_id
    where r.status='reserved' and r.created_at>=v_from and r.created_at<v_to and (p_scope='portfolio' or r.tenant_id=p_tenant_id)
  )
  select jsonb_build_object(
    'scope',p_scope,'from',p_from,'to',p_to,'timezone',p_timezone,
    'totalSpentMicros',coalesce((select sum(cost_micros) from base),0),
    'reservedMicros',(select cost from reserved),
    'calls',coalesce((select count(*) from base),0),
    'daily',coalesce((select jsonb_agg(jsonb_build_object('date',bucket,'costMicros',cost,'calls',calls) order by bucket) from daily),'[]'::jsonb),
    'weekly',coalesce((select jsonb_agg(jsonb_build_object('weekStart',bucket,'costMicros',cost,'calls',calls) order by bucket) from weekly),'[]'::jsonb),
    'monthly',coalesce((select jsonb_agg(jsonb_build_object('monthStart',bucket,'costMicros',cost,'calls',calls) order by bucket) from monthly),'[]'::jsonb),
    'byTenant',coalesce((select jsonb_agg(jsonb_build_object('tenantId',tenant_id,'tenantName',tenant_name,'costMicros',cost,'calls',calls) order by cost desc) from by_tenant),'[]'::jsonb),
    'byPost',coalesce((select jsonb_agg(jsonb_build_object('postId',post_id,'tenantId',tenant_id,'tenantName',tenant_name,'topic',topic,'format',format,'contentMode',content_mode,'costMicros',cost,'textCostMicros',text_cost,'imageCostMicros',image_cost,'calls',calls) order by cost desc) from by_post),'[]'::jsonb),
    'byFormat',coalesce((select jsonb_agg(jsonb_build_object('format',format,'costMicros',cost,'calls',calls) order by cost desc) from by_format),'[]'::jsonb),
    'byContentMode',coalesce((select jsonb_agg(jsonb_build_object('contentMode',content_mode,'costMicros',cost,'calls',calls) order by cost desc) from by_mode),'[]'::jsonb),
    'byTask',coalesce((select jsonb_agg(jsonb_build_object('task',task,'costMicros',cost,'calls',calls) order by cost desc) from by_task),'[]'::jsonb),
    'byModel',coalesce((select jsonb_agg(jsonb_build_object('model',model,'modelTier',model_tier,'costMicros',cost,'calls',calls) order by cost desc) from by_model),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.ai_cost_report(uuid,date,date,text,text) from public,anonymous;
grant execute on function public.ai_cost_report(uuid,date,date,text,text) to authenticated;
