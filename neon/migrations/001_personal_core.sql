-- Post Automatici - Neon personal production core.
-- Personal-first: no billing, external customers or SaaS plans.
-- Neon Auth + Neon Data API provide authentication/JWT/RLS; server-only jobs use the DB owner connection.

create extension if not exists pgcrypto;
create schema if not exists app_private;
revoke all on schema app_private from public, anonymous, authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin new.updated_at=now(); return new; end $$;

create or replace function public.current_user_id()
returns uuid language sql stable set search_path=public,pg_temp as $$
  select nullif(auth.user_id()::text,'')::uuid
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable as $$ select false $$;

create table if not exists public.profiles(
  user_id uuid primary key,
  display_name text,
  avatar_url text,
  locale text not null default 'it',
  timezone text not null default 'Europe/Rome',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenants(
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(name) between 2 and 160),
  slug text not null unique check(slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check(status in ('active','suspended','closed')),
  onboarding_status text not null default 'not_started' check(onboarding_status in ('not_started','in_progress','completed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_members(
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'viewer' check(role in ('owner','admin','editor','viewer')),
  status text not null default 'active' check(status in ('active','invited','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(tenant_id,user_id)
);
create index if not exists tenant_members_user_idx on public.tenant_members(user_id,status);

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=public.current_user_id() and tm.status='active')
$$;
create or replace function public.has_tenant_role(p_tenant_id uuid,p_roles text[])
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.tenant_members tm where tm.tenant_id=p_tenant_id and tm.user_id=public.current_user_id() and tm.status='active' and tm.role=any(p_roles))
$$;

create or replace function public.create_tenant(p_name text,p_slug text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=public.current_user_id(); v_tenant uuid; v_slug text;
begin
 if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 v_slug:=trim(both '-' from lower(regexp_replace(trim(p_slug),'[^a-zA-Z0-9-]+','-','g')));
 if char_length(trim(p_name))<2 or char_length(v_slug)<2 or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'INVALID_TENANT_DATA'; end if;
 insert into public.tenants(name,slug,created_by,onboarding_status) values(trim(p_name),v_slug,v_user,'in_progress') returning id into v_tenant;
 insert into public.tenant_members(tenant_id,user_id,role,status) values(v_tenant,v_user,'owner','active');
 insert into public.onboarding_sessions(tenant_id,current_step) values(v_tenant,'business');
 return v_tenant;
end $$;

create or replace function public.handle_neon_auth_user()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.profiles(user_id,display_name,avatar_url) values(new.id,new.name,new.image)
 on conflict(user_id) do update set display_name=excluded.display_name,avatar_url=excluded.avatar_url,updated_at=now();
 return new;
end $$;
drop trigger if exists post_automatici_auth_user_profile on neon_auth."user";
create trigger post_automatici_auth_user_profile after insert or update of name,image on neon_auth."user" for each row execute function public.handle_neon_auth_user();

create table if not exists public.onboarding_sessions(
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  current_step text not null default 'business' check(current_step in ('business','goals','target','brand','social','frequency','publishing','summary','completed')),
  business jsonb not null default '{}'::jsonb,
  goals jsonb not null default '[]'::jsonb,
  target jsonb not null default '{}'::jsonb,
  social jsonb not null default '[]'::jsonb,
  frequency jsonb not null default '{}'::jsonb,
  publishing_modes jsonb not null default '{}'::jsonb,
  scan_summary jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.websites(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,
  url text not null,normalized_origin text,status text not null default 'pending' check(status in ('pending','active','error','disabled')),
  robots_policy jsonb not null default '{}'::jsonb,last_scan_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,url),unique(tenant_id,id)
);
create table if not exists public.website_scans(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,website_id uuid not null references public.websites(id) on delete cascade,
  status text not null default 'queued' check(status in ('queued','running','completed','partial','failed','canceled')),page_limit integer not null check(page_limit>0),discovered_count integer not null default 0,relevant_count integer not null default 0,analyzed_count integer not null default 0,skipped_count integer not null default 0,coverage_note text,content_hash text,started_at timestamptz,completed_at timestamptz,error_code text,correlation_id uuid not null default gen_random_uuid(),created_at timestamptz not null default now()
);
create table if not exists public.website_pages(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,website_id uuid not null,scan_id uuid references public.website_scans(id) on delete set null,
  url text not null,canonical_url text,page_type text,title text,meta_description text,headings jsonb not null default '[]'::jsonb,content_text text,content_hash text,discovered_via text,http_status integer,is_relevant boolean not null default true,skip_reason text,metadata jsonb not null default '{}'::jsonb,fetched_at timestamptz,created_at timestamptz not null default now(),
  unique(tenant_id,website_id,url),foreign key(tenant_id,website_id) references public.websites(tenant_id,id) on delete cascade
);
create table if not exists public.website_resources(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,website_id uuid not null references public.websites(id) on delete cascade,scan_id uuid references public.website_scans(id) on delete cascade,page_url text,
  resource_type text not null check(resource_type in ('robots','sitemap','sitemap_index','stylesheet','favicon','logo_candidate','image_candidate','raw_page')),url text not null,content_text text,content_hash text,metadata jsonb not null default '{}'::jsonb,fetched_at timestamptz not null default now(),unique(tenant_id,scan_id,resource_type,url)
);

create table if not exists public.brand_profiles(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  status text not null default 'draft' check(status in ('draft','review','confirmed')),brand_name text,description text,industry text,sub_industry text,business_model text,location jsonb,target jsonb not null default '[]'::jsonb,personas jsonb not null default '[]'::jsonb,services jsonb not null default '[]'::jsonb,products jsonb not null default '[]'::jsonb,differentiators jsonb not null default '[]'::jsonb,usp text,value_propositions jsonb not null default '[]'::jsonb,brand_colors jsonb not null default '[]'::jsonb,secondary_colors jsonb not null default '[]'::jsonb,fonts jsonb not null default '[]'::jsonb,visual_style jsonb not null default '{}'::jsonb,photo_style jsonb not null default '{}'::jsonb,tone_of_voice jsonb not null default '{}'::jsonb,vocabulary jsonb not null default '[]'::jsonb,banned_words jsonb not null default '[]'::jsonb,cta_preferences jsonb not null default '[]'::jsonb,claims_allowed jsonb not null default '[]'::jsonb,claims_forbidden jsonb not null default '[]'::jsonb,topics jsonb not null default '[]'::jsonb,urls jsonb not null default '[]'::jsonb,social_links jsonb not null default '[]'::jsonb,competitors jsonb not null default '[]'::jsonb,goals jsonb not null default '[]'::jsonb,source_summary jsonb not null default '{}'::jsonb,version integer not null default 1,confirmed_at timestamptz,primary_logo_asset_id uuid,alternate_logo_asset_id uuid,preferred_visual_style jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,id)
);
create table if not exists public.brand_profile_locks(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,brand_profile_id uuid not null,field_path text not null,locked_value jsonb,locked_by uuid,locked_at timestamptz not null default now(),unique(brand_profile_id,field_path),foreign key(tenant_id,brand_profile_id) references public.brand_profiles(tenant_id,id) on delete cascade
);
create table if not exists public.brand_profile_versions(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,brand_profile_id uuid not null,version integer not null,status text not null default 'draft' check(status in ('draft','review','confirmed','superseded')),snapshot jsonb not null,source_summary jsonb not null default '{}'::jsonb,created_by uuid,reviewed_at timestamptz,confirmed_at timestamptz,created_at timestamptz not null default now(),unique(brand_profile_id,version),foreign key(tenant_id,brand_profile_id) references public.brand_profiles(tenant_id,id) on delete cascade
);

create table if not exists public.content_strategies(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,version integer not null default 1,status text not null default 'draft' check(status in ('draft','confirmed','superseded')),objectives jsonb not null default '[]'::jsonb,audience jsonb not null default '{}'::jsonb,content_mix jsonb not null default '{}'::jsonb,platform_strategy jsonb not null default '{}'::jsonb,scheduling_preferences jsonb not null default '{}'::jsonb,minimum_analytics_sample integer not null default 10,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,version)
);
create table if not exists public.content_pillars(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,strategy_id uuid not null references public.content_strategies(id) on delete cascade,name text not null,description text,target_share numeric(5,4),is_active boolean not null default true,sort_order integer not null default 0,created_at timestamptz not null default now()
);
create table if not exists public.content_ideas(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,pillar_id uuid references public.content_pillars(id) on delete set null,topic text not null,angle text,objective text,source_mode text not null default 'evergreen' check(source_mode in ('evergreen','brand_knowledge','web_research','analytics')),source_refs jsonb not null default '[]'::jsonb,status text not null default 'idea' check(status in ('idea','selected','used','rejected')),created_at timestamptz not null default now()
);
create table if not exists public.posts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,campaign text,pillar_id uuid references public.content_pillars(id) on delete set null,idea_id uuid references public.content_ideas(id) on delete set null,topic text not null,objective text,core_concept jsonb not null default '{}'::jsonb,status text not null default 'idea' check(status in ('idea','generating','draft','qa','ready','awaiting_approval','approved','scheduled','publishing','published','failed','rejected','needs_review')),fact_confidence text not null default 'unknown' check(fact_confidence in ('confirmed','inferred','unknown')),quality_score jsonb not null default '{}'::jsonb,prompt_version text,generation_version integer not null default 1,created_by uuid,planned_at timestamptz,primary_platform text check(primary_platform is null or primary_platform in ('facebook','instagram','linkedin','google_business_profile')),format text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,id)
);
create table if not exists public.post_variants(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_id uuid not null,platform text not null check(platform in ('facebook','instagram','linkedin','google_business_profile')),platform_decision text not null default 'native_variant' check(platform_decision in ('native_variant','separate_concept','skip')),format text,hook text,caption text,cta text,hashtags text[] not null default '{}',alt_text text,visual_brief jsonb not null default '{}'::jsonb,scheduled_at timestamptz,approval_mode text not null default 'manual' check(approval_mode in ('auto','manual')),approval_status text not null default 'pending' check(approval_status in ('not_required','pending','approved','rejected')),status text not null default 'awaiting_approval',external_post_id text,generation_metadata jsonb not null default '{}'::jsonb,content_fingerprint text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(post_id,platform),unique(tenant_id,id),foreign key(tenant_id,post_id) references public.posts(tenant_id,id) on delete cascade
);

create table if not exists public.post_approvals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_variant_id uuid not null references public.post_variants(id) on delete cascade,approved_by uuid,source text not null check(source in ('web','telegram')),created_at timestamptz not null default now()
);
create table if not exists public.post_rejections(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_variant_id uuid not null references public.post_variants(id) on delete cascade,rejected_by uuid,reason text,source text not null check(source in ('web','telegram')),created_at timestamptz not null default now()
);
create table if not exists public.publication_jobs(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_variant_id uuid not null references public.post_variants(id) on delete cascade,platform text not null,scheduled_at timestamptz not null,idempotency_key text not null,status text not null default 'queued' check(status in ('queued','locked','publishing','succeeded','retry_wait','failed','canceled')),attempts integer not null default 0,max_attempts integer not null default 5,next_attempt_at timestamptz,locked_at timestamptz,locked_by text,correlation_id uuid not null default gen_random_uuid(),external_post_id text,provider_request_id text,reconciliation_state text not null default 'not_started' check(reconciliation_state in ('not_started','pending','confirmed','not_found','failed')),reconciled_at timestamptz,last_error_class text,last_error_code text,last_error_message text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(tenant_id,idempotency_key)
);
create table if not exists public.publication_attempts(
 id bigint generated always as identity primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,publication_job_id uuid not null references public.publication_jobs(id) on delete cascade,attempt_no integer not null,provider_request_id text,external_post_id text,outcome text not null check(outcome in ('success','retryable_error','non_retryable_error','auth_error','rate_limit','validation_error','platform_rejection','unknown')),http_status integer,provider_code text,duration_ms integer,response_metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(publication_job_id,attempt_no)
);
create table if not exists public.published_posts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_variant_id uuid not null references public.post_variants(id) on delete cascade,publication_job_id uuid references public.publication_jobs(id) on delete set null,platform text not null,external_account_id text,external_post_id text not null,external_url text,published_at timestamptz not null,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(platform,external_post_id),unique(tenant_id,post_variant_id)
);
create table if not exists public.analytics_snapshots(
 id bigint generated always as identity primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,published_post_id uuid not null references public.published_posts(id) on delete cascade,platform text not null,snapshot_at timestamptz not null,metrics jsonb not null,raw_metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(published_post_id,snapshot_at)
);
create table if not exists public.learning_insights(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,insight_type text not null check(insight_type in ('pillar','cta','style','format','platform','approval','general','schedule','topic')),title text not null,body text not null,evidence jsonb not null default '{}'::jsonb,sample_size integer not null default 0,confidence numeric(5,4) not null default 0 check(confidence between 0 and 1),status text not null default 'suggested' check(status in ('suggested','applied','dismissed')),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.editorial_memory(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_id uuid references public.posts(id) on delete set null,topic text,angle text,hook text,cta text,pillar_id uuid references public.content_pillars(id) on delete set null,visual_concept text,published_at timestamptz,performance_summary jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique(tenant_id,post_id)
);
create table if not exists public.content_fingerprints(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_id uuid references public.posts(id) on delete cascade,post_variant_id uuid references public.post_variants(id) on delete cascade,text_sha256 text,normalized_sha256 text,topic_key text,hook_key text,visual_key text,embedding_model text,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create unique index if not exists content_fingerprints_variant_normalized_uidx on public.content_fingerprints(tenant_id,post_variant_id,normalized_sha256) where post_variant_id is not null and normalized_sha256 is not null;
create table if not exists public.ai_usage_events(
 id bigint generated always as identity primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,task text not null,provider text not null default 'openai',model text not null,prompt_version text,input_tokens bigint,cached_input_tokens bigint,output_tokens bigint,image_count integer not null default 0,web_search_calls integer not null default 0,estimated_cost_microunits bigint,actual_cost_microunits bigint,correlation_id uuid,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);

create index if not exists posts_tenant_status_idx on public.posts(tenant_id,status,created_at desc);
create index if not exists posts_tenant_planned_idx on public.posts(tenant_id,planned_at) where planned_at is not null;
create index if not exists post_variants_schedule_idx on public.post_variants(tenant_id,scheduled_at) where scheduled_at is not null;
create index if not exists publication_jobs_due_idx on public.publication_jobs(status,coalesce(next_attempt_at,scheduled_at));
create index if not exists editorial_memory_recent_idx on public.editorial_memory(tenant_id,created_at desc);
create index if not exists content_fingerprints_recent_idx on public.content_fingerprints(tenant_id,created_at desc);

create or replace function public.normalize_social_content_for_dedupe(p_value text)
returns text language sql immutable as $$
 select trim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p_value,'')),'https?://[^[:space:]]+','<url>','g'),'[@#]','','g'),'[^[:alnum:]<>]+',' ','g'))
$$;
create or replace function public.set_post_variant_content_fingerprint()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v text;
begin
 if new.platform_decision='skip' then new.content_fingerprint=null; return new; end if;
 v:=public.normalize_social_content_for_dedupe(concat_ws(E'\n',new.hook,new.caption,new.cta,array_to_string(coalesce(new.hashtags,'{}'::text[]),' ')));
 new.content_fingerprint:=case when v='' then null else encode(digest(v,'sha256'),'hex') end;
 return new;
end $$;
create unique index if not exists post_variants_tenant_platform_content_uidx on public.post_variants(tenant_id,platform,content_fingerprint) where content_fingerprint is not null and platform_decision<>'skip';

drop trigger if exists post_variants_set_content_fingerprint on public.post_variants;
create trigger post_variants_set_content_fingerprint before insert or update of hook,caption,cta,hashtags,platform_decision on public.post_variants for each row execute function public.set_post_variant_content_fingerprint();

create or replace function public.enforce_human_variant_approval()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare ok boolean;
begin
 if new.platform_decision='skip' then return new; end if;
 select exists(select 1 from public.post_approvals pa where pa.tenant_id=new.tenant_id and pa.post_variant_id=new.id and pa.source in ('web','telegram')) into ok;
 if not ok then
   if new.approval_status='approved' then new.approval_status='pending'; end if;
   if new.status in ('approved','scheduled','publishing','published') then new.status='awaiting_approval'; end if;
 end if;
 return new;
end $$;
drop trigger if exists post_variants_require_human_approval on public.post_variants;
create trigger post_variants_require_human_approval before insert or update of approval_status,status,approval_mode on public.post_variants for each row execute function public.enforce_human_variant_approval();

create or replace function public.guard_publication_job_human_approval()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.post_approvals pa where pa.tenant_id=new.tenant_id and pa.post_variant_id=new.post_variant_id and pa.source in ('web','telegram')) then return null; end if;
 if exists(select 1 from public.published_posts pp where pp.tenant_id=new.tenant_id and pp.post_variant_id=new.post_variant_id) then raise exception 'VARIANT_ALREADY_PUBLISHED' using errcode='23505'; end if;
 return new;
end $$;
drop trigger if exists publication_jobs_require_human_approval on public.publication_jobs;
create trigger publication_jobs_require_human_approval before insert or update of status,scheduled_at on public.publication_jobs for each row execute function public.guard_publication_job_human_approval();

create or replace function public.enforce_post_decision_completion()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status in ('approved','scheduled','publishing','published') and exists(select 1 from public.post_variants pv where pv.tenant_id=new.tenant_id and pv.post_id=new.id and pv.platform_decision<>'skip' and pv.approval_status not in ('approved','rejected')) then new.status='awaiting_approval'; end if;
 return new;
end $$;
drop trigger if exists posts_require_all_platform_decisions on public.posts;
create trigger posts_require_all_platform_decisions before update of status on public.posts for each row execute function public.enforce_post_decision_completion();

create or replace function public.remember_published_content()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.posts%rowtype; v public.post_variants%rowtype;
begin
 select * into v from public.post_variants where id=new.post_variant_id and tenant_id=new.tenant_id;
 if v.id is null then return new; end if;
 select * into p from public.posts where id=v.post_id and tenant_id=new.tenant_id;
 insert into public.editorial_memory(tenant_id,post_id,topic,angle,hook,cta,pillar_id,visual_concept,published_at)
 values(new.tenant_id,p.id,p.topic,coalesce(p.core_concept->>'angle',p.objective,''),v.hook,v.cta,p.pillar_id,coalesce(v.visual_brief->>'subject',v.visual_brief->>'prompt',v.visual_brief::text),new.published_at)
 on conflict(tenant_id,post_id) do update set topic=excluded.topic,angle=excluded.angle,hook=excluded.hook,cta=excluded.cta,pillar_id=excluded.pillar_id,visual_concept=excluded.visual_concept,published_at=excluded.published_at;
 return new;
end $$;
drop trigger if exists published_posts_remember_content on public.published_posts;
create trigger published_posts_remember_content after insert or update of published_at on public.published_posts for each row execute function public.remember_published_content();

create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger tenants_set_updated_at before update on public.tenants for each row execute function public.set_updated_at();
create trigger tenant_members_set_updated_at before update on public.tenant_members for each row execute function public.set_updated_at();
create trigger onboarding_sessions_set_updated_at before update on public.onboarding_sessions for each row execute function public.set_updated_at();
create trigger websites_set_updated_at before update on public.websites for each row execute function public.set_updated_at();
create trigger brand_profiles_set_updated_at before update on public.brand_profiles for each row execute function public.set_updated_at();
create trigger content_strategies_set_updated_at before update on public.content_strategies for each row execute function public.set_updated_at();
create trigger posts_set_updated_at before update on public.posts for each row execute function public.set_updated_at();
create trigger post_variants_set_updated_at before update on public.post_variants for each row execute function public.set_updated_at();
create trigger publication_jobs_set_updated_at before update on public.publication_jobs for each row execute function public.set_updated_at();
create trigger learning_insights_set_updated_at before update on public.learning_insights for each row execute function public.set_updated_at();

-- RLS and Data API grants.
do $$ declare t text; begin
 foreach t in array array['profiles','tenants','tenant_members','onboarding_sessions','websites','website_scans','website_pages','website_resources','brand_profiles','brand_profile_locks','brand_profile_versions','content_strategies','content_pillars','content_ideas','posts','post_variants','post_approvals','post_rejections','publication_jobs','publication_attempts','published_posts','analytics_snapshots','learning_insights','editorial_memory','content_fingerprints','ai_usage_events'] loop
   execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;

create policy profiles_self_read on public.profiles for select to authenticated using(user_id=public.current_user_id());
create policy profiles_self_update on public.profiles for update to authenticated using(user_id=public.current_user_id()) with check(user_id=public.current_user_id());
create policy tenants_member_read on public.tenants for select to authenticated using(public.is_tenant_member(id));
create policy tenants_admin_update on public.tenants for update to authenticated using(public.has_tenant_role(id,array['owner','admin'])) with check(public.has_tenant_role(id,array['owner','admin']));
create policy tenant_members_member_read on public.tenant_members for select to authenticated using(public.is_tenant_member(tenant_id));

-- Member-readable tenant data.
do $$ declare t text; begin
 foreach t in array array['onboarding_sessions','websites','website_scans','website_pages','website_resources','brand_profiles','brand_profile_locks','brand_profile_versions','content_strategies','content_pillars','content_ideas','posts','post_variants','post_approvals','post_rejections','publication_jobs','publication_attempts','published_posts','analytics_snapshots','learning_insights','editorial_memory','content_fingerprints','ai_usage_events'] loop
   execute format('create policy %I on public.%I for select to authenticated using(public.is_tenant_member(tenant_id))',t||'_member_read',t);
 end loop;
end $$;

-- User-editable tenant data. Publication/analytics/learning remain server-write only.
do $$ declare t text; begin
 foreach t in array array['onboarding_sessions','websites','brand_profiles','brand_profile_locks','brand_profile_versions','content_strategies','content_pillars','content_ideas','posts','post_variants','post_approvals','post_rejections'] loop
   execute format('create policy %I on public.%I for insert to authenticated with check(public.has_tenant_role(tenant_id,array[''owner'',''admin'',''editor'']))',t||'_editor_insert',t);
   execute format('create policy %I on public.%I for update to authenticated using(public.has_tenant_role(tenant_id,array[''owner'',''admin'',''editor''])) with check(public.has_tenant_role(tenant_id,array[''owner'',''admin'',''editor'']))',t||'_editor_update',t);
   execute format('create policy %I on public.%I for delete to authenticated using(public.has_tenant_role(tenant_id,array[''owner'',''admin'',''editor'']))',t||'_editor_delete',t);
 end loop;
end $$;

revoke all on all tables in schema public from anonymous;
grant usage on schema public to authenticated;
grant select,update on public.profiles,public.tenants to authenticated;
grant select on public.tenant_members to authenticated;
grant select,insert,update,delete on public.onboarding_sessions,public.websites,public.brand_profiles,public.brand_profile_locks,public.brand_profile_versions,public.content_strategies,public.content_pillars,public.content_ideas,public.posts,public.post_variants,public.post_approvals,public.post_rejections to authenticated;
grant select on public.website_scans,public.website_pages,public.website_resources,public.publication_jobs,public.publication_attempts,public.published_posts,public.analytics_snapshots,public.learning_insights,public.editorial_memory,public.content_fingerprints,public.ai_usage_events to authenticated;
grant execute on function public.current_user_id(),public.is_tenant_member(uuid),public.has_tenant_role(uuid,text[]),public.create_tenant(text,text) to authenticated;
