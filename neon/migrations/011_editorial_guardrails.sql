-- Post Automatici - persist creative mode and enforce conservative platform editorial guardrails.

create or replace function app_private.sync_post_editorial_intelligence()
returns trigger language plpgsql set search_path=public,app_private,pg_temp as $$
declare
  v_mode text;
  v_reason text;
  v_conf numeric;
begin
  if new.core_concept is not null and jsonb_typeof(new.core_concept)='object' then
    v_mode:=nullif(new.core_concept->>'contentMode','');
    v_reason:=nullif(new.core_concept->>'formatReason','');
    begin v_conf:=(new.core_concept->>'formatConfidence')::numeric; exception when others then v_conf:=null; end;
    if v_mode in ('educational','storytelling','promotional','social_proof','behind_scenes','faq','comparison','listicle','local','community','newsjacking') then new.content_mode:=v_mode; end if;
    if v_reason is not null then new.format_reason:=left(v_reason,2000); end if;
    if v_conf between 0 and 1 then new.format_confidence:=v_conf; end if;
  end if;
  return new;
end $$;

drop trigger if exists posts_sync_editorial_intelligence on public.posts;
create trigger posts_sync_editorial_intelligence before insert or update of core_concept on public.posts for each row execute function app_private.sync_post_editorial_intelligence();

create or replace function app_private.sync_variant_editorial_intelligence()
returns trigger language plpgsql set search_path=public,app_private,pg_temp as $$
declare
  v_post public.posts%rowtype;
  v_count integer:=coalesce(array_length(new.hashtags,1),0);
begin
  select * into v_post from public.posts where id=new.post_id and tenant_id=new.tenant_id;
  if found then
    new.content_mode:=coalesce(new.content_mode,v_post.content_mode);
    new.format_reason:=coalesce(new.format_reason,v_post.format_reason);
  end if;
  new.hashtag_strategy:=coalesce(new.hashtag_strategy,'{}'::jsonb)||jsonb_build_object(
    'source','openai_contextual',
    'count',v_count,
    'antiSpam',true,
    'performanceAware',true,
    'realMetricsRequiredForPerformanceClaims',true
  );
  return new;
end $$;

drop trigger if exists post_variants_sync_editorial_intelligence on public.post_variants;
create trigger post_variants_sync_editorial_intelligence before insert or update of hashtags,post_id,content_mode,format_reason on public.post_variants for each row execute function app_private.sync_variant_editorial_intelligence();

alter table public.post_variants drop constraint if exists post_variants_platform_format_guard;
alter table public.post_variants add constraint post_variants_platform_format_guard check(
  platform_decision='skip' or
  (platform in ('instagram','facebook') and format in ('post','carousel','story')) or
  (platform='linkedin' and format in ('post','carousel')) or
  (platform='google_business_profile' and format='post')
) not valid;

alter table public.post_variants drop constraint if exists post_variants_hashtag_count_guard;
alter table public.post_variants add constraint post_variants_hashtag_count_guard check(
  platform_decision='skip' or
  (platform='instagram' and coalesce(array_length(hashtags,1),0)<=8) or
  (platform='facebook' and coalesce(array_length(hashtags,1),0)<=3) or
  (platform='linkedin' and coalesce(array_length(hashtags,1),0)<=5) or
  (platform='google_business_profile' and coalesce(array_length(hashtags,1),0)=0)
) not valid;
