begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

select has_table('public','telegram_approval_requests','Telegram approval requests persist');
select has_trigger('public','post_variants','post_variants_require_human_approval','variant human approval trigger exists');
select has_trigger('public','publication_jobs','publication_jobs_require_human_approval','publication job approval trigger exists');
select has_trigger('public','posts','posts_require_all_platform_decisions','post aggregate decision trigger exists');
select ok((select relrowsecurity from pg_class where oid='public.telegram_approval_requests'::regclass),'Telegram approval requests have RLS');
select has_function('public','enforce_human_variant_approval',array[]::text[],'human approval enforcement function exists');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname='post_approvals_source_check' and conrelid='public.post_approvals'::regclass) like '%web%' and (select pg_get_constraintdef(oid) from pg_constraint where conname='post_approvals_source_check' and conrelid='public.post_approvals'::regclass) like '%telegram%','web and Telegram are valid approval sources');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname='post_approvals_source_check' and conrelid='public.post_approvals'::regclass) not like '%system%','system cannot approve publication');

insert into public.tenants(id,name,slug,status,onboarding_status)
values ('00000000-0000-0000-0000-000000000901','Approval Gate Test','approval-gate-test','active','completed');
insert into public.posts(id,tenant_id,topic,status)
values ('00000000-0000-0000-0000-000000000902','00000000-0000-0000-0000-000000000901','Preview obbligatoria','awaiting_approval');
insert into public.post_variants(id,tenant_id,post_id,platform,platform_decision,approval_mode,approval_status,status,scheduled_at)
values ('00000000-0000-0000-0000-000000000903','00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000902','instagram','native_variant','auto','approved','approved',now());

select is((select approval_status from public.post_variants where id='00000000-0000-0000-0000-000000000903'),'pending','AUTO is normalized back to pending without a human decision');
select is((select status from public.post_variants where id='00000000-0000-0000-0000-000000000903'),'awaiting_approval','variant cannot claim approved before preview decision');

insert into public.publication_jobs(tenant_id,post_variant_id,platform,scheduled_at,idempotency_key,status,max_attempts)
values ('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000903','instagram',now(),'approval-gate-before','queued',3);
select is((select count(*) from public.publication_jobs where tenant_id='00000000-0000-0000-0000-000000000901'),0::bigint,'publication job is suppressed before human approval');

insert into public.post_approvals(tenant_id,post_variant_id,source)
values ('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000903','web');
update public.post_variants set approval_status='approved',status='approved' where id='00000000-0000-0000-0000-000000000903';
select is((select approval_status from public.post_variants where id='00000000-0000-0000-0000-000000000903'),'approved','explicit web approval unlocks the variant');

insert into public.publication_jobs(tenant_id,post_variant_id,platform,scheduled_at,idempotency_key,status,max_attempts)
values ('00000000-0000-0000-0000-000000000901','00000000-0000-0000-0000-000000000903','instagram',now(),'approval-gate-after','queued',3);
select is((select count(*) from public.publication_jobs where tenant_id='00000000-0000-0000-0000-000000000901'),1::bigint,'publication job is allowed only after explicit approval');

select * from finish();
rollback;
