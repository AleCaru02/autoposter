begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_column('public','post_variants','content_fingerprint','variants persist a normalized content fingerprint');
select has_trigger('public','post_variants','post_variants_set_content_fingerprint','variant fingerprint trigger exists');
select has_trigger('public','publication_jobs','publication_jobs_block_republish','republish guard exists');
select has_trigger('public','published_posts','published_posts_remember_content','published content memory trigger exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='post_variants_tenant_platform_content_fingerprint_uidx'),'same-platform content fingerprint has a unique index');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='published_posts_tenant_variant_uidx'),'one published record per variant is enforced');

insert into public.tenants(id,name,slug,status,onboarding_status)
values ('00000000-0000-0000-0000-000000000971','Dedupe Test','dedupe-test','active','completed');

insert into public.posts(id,tenant_id,topic,status)
values
  ('00000000-0000-0000-0000-000000000972','00000000-0000-0000-0000-000000000971','Primo contenuto','awaiting_approval'),
  ('00000000-0000-0000-0000-000000000973','00000000-0000-0000-0000-000000000971','Secondo contenuto','awaiting_approval');

insert into public.post_variants(id,tenant_id,post_id,platform,platform_decision,hook,caption,cta,hashtags,approval_mode,approval_status,status,scheduled_at)
values ('00000000-0000-0000-0000-000000000974','00000000-0000-0000-0000-000000000971','00000000-0000-0000-0000-000000000972','instagram','native_variant','Scopri il servizio','Contenuto unico da ricordare.','Scrivici',array['PostAutomatici'],'manual','pending','awaiting_approval',now());

insert into public.post_variants(id,tenant_id,post_id,platform,platform_decision,hook,caption,cta,hashtags,approval_mode,approval_status,status,scheduled_at)
values ('00000000-0000-0000-0000-000000000975','00000000-0000-0000-0000-000000000971','00000000-0000-0000-0000-000000000973','instagram','native_variant','SCOPRI IL SERVIZIO','Contenuto   unico da ricordare!','Scrivici',array['postautomatici'],'manual','pending','awaiting_approval',now())
on conflict do nothing;

select is(
  (select count(*) from public.post_variants where tenant_id='00000000-0000-0000-0000-000000000971' and platform='instagram'),
  1::bigint,
  'normalized duplicate copy on the same tenant/platform is rejected'
);

insert into public.post_variants(id,tenant_id,post_id,platform,platform_decision,hook,caption,cta,hashtags,approval_mode,approval_status,status,scheduled_at)
values ('00000000-0000-0000-0000-000000000976','00000000-0000-0000-0000-000000000971','00000000-0000-0000-0000-000000000973','facebook','native_variant','Scopri il servizio','Contenuto unico da ricordare.','Scrivici',array['PostAutomatici'],'manual','pending','awaiting_approval',now());

select is(
  (select count(*) from public.post_variants where tenant_id='00000000-0000-0000-0000-000000000971'),
  2::bigint,
  'the same concept may still have a platform-specific variant on a different platform'
);

insert into public.published_posts(id,tenant_id,post_variant_id,platform,external_post_id,published_at)
values ('00000000-0000-0000-0000-000000000977','00000000-0000-0000-0000-000000000971','00000000-0000-0000-0000-000000000974','instagram','external-dedupe-1',now());

insert into public.published_posts(id,tenant_id,post_variant_id,platform,external_post_id,published_at)
values ('00000000-0000-0000-0000-000000000978','00000000-0000-0000-0000-000000000971','00000000-0000-0000-0000-000000000974','instagram','external-dedupe-2',now())
on conflict do nothing;

select is(
  (select count(*) from public.published_posts where tenant_id='00000000-0000-0000-0000-000000000971' and post_variant_id='00000000-0000-0000-0000-000000000974'),
  1::bigint,
  'a variant can be persisted as published only once even if a provider retry returns a new external id'
);

select is(
  (select count(*) from public.editorial_memory where tenant_id='00000000-0000-0000-0000-000000000971' and post_id='00000000-0000-0000-0000-000000000972'),
  1::bigint,
  'publishing automatically writes one durable editorial memory record'
);

select * from finish();
rollback;
