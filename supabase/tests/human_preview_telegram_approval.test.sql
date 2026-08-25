begin;
select plan(9);

select has_table('public','telegram_approval_requests','telegram approval requests persist');
select has_column('public','telegram_approval_requests','callback_token_hash','telegram callback token is stored only as hash');
select has_column('public','telegram_approval_requests','last_action','telegram approval action is auditable');
select isnt_empty($$select 1 from pg_policies where schemaname='public' and tablename='telegram_approval_requests'$$,'telegram approvals are protected by RLS');
select isnt_empty($$select 1 from pg_trigger where tgname='post_variants_require_human_approval' and not tgisinternal$$,'post variants require explicit human approval');
select isnt_empty($$select 1 from pg_trigger where tgname='publication_jobs_require_human_approval' and not tgisinternal$$,'publication jobs require explicit human approval');
select is_empty($$select 1 from pg_trigger where tgname='post_variants_enqueue_auto_publication' and not tgisinternal$$,'legacy auto-publication trigger is removed');
select has_function('public','enforce_human_variant_approval',array[]::text[],'human variant approval guard exists');
select has_function('public','guard_publication_job_human_approval',array[]::text[],'publication job approval guard exists');

select * from finish();
rollback;
