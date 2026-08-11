begin;
select plan(16);

select has_column('public','tenants','data_mode','tenant has explicit data mode');
select col_default_is('public','tenants','data_mode','DEMO','data mode defaults to explicit demo');
select has_table('public','website_resources','website raw knowledge persists');
select has_table('public','tenant_ai_budgets','tenant AI budgets persist');
select has_table('public','ai_cost_reservations','AI cost reservations persist');
select has_table('app_private','global_ai_budget','global AI budget is private');
select has_column('public','ai_usage_events','actual_cost_microunits','actual AI cost can be finalized');
select has_column('public','ai_usage_events','cost_reservation_id','usage links to cost reservation');
select has_column('public','publication_jobs','reconciliation_state','scheduler reconciliation persists');
select has_column('public','publication_jobs','provider_request_id','provider request id persists');
select has_table('public','account_deletion_requests','account deletion requests persist');
select has_table('app_private','account_lifecycle_audit','destructive lifecycle audit survives tenant deletion');
select has_table('app_private','rate_limit_windows','shared rate limit state is prepared');
select isnt_empty($$select 1 from pg_policies where schemaname='public' and tablename='website_resources'$$,'website resources protected by RLS policy');
select isnt_empty($$select 1 from pg_policies where schemaname='public' and tablename='tenant_ai_budgets'$$,'tenant AI budgets protected by RLS policy');
select isnt_empty($$select 1 from pg_policies where schemaname='public' and tablename='account_deletion_requests'$$,'deletion requests protected by RLS policy');

select * from finish();
rollback;
