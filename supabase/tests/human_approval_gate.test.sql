begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select has_table('public','telegram_approval_requests','Telegram approval requests persist');
select has_trigger('public','post_variants','post_variants_require_human_approval','variant human approval trigger exists');
select has_trigger('public','publication_jobs','publication_jobs_require_human_approval','publication job approval trigger exists');
select has_trigger('public','posts','posts_require_all_platform_decisions','post aggregate decision trigger exists');
select ok((select relrowsecurity from pg_class where oid='public.telegram_approval_requests'::regclass),'Telegram approval requests have RLS');
select has_function('public','enforce_human_variant_approval',array[]::text[],'human approval enforcement function exists');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname='post_approvals_source_check' and conrelid='public.post_approvals'::regclass) like '%web%' and (select pg_get_constraintdef(oid) from pg_constraint where conname='post_approvals_source_check' and conrelid='public.post_approvals'::regclass) like '%telegram%','web and Telegram are valid approval sources');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname='post_approvals_source_check' and conrelid='public.post_approvals'::regclass) not like '%system%','system cannot approve publication');

select * from finish();
rollback;
