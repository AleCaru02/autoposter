begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select has_table('app_private','billing_plan_mappings','Stripe plan mapping is server-only');
select has_table('public','billing_sync_events','billing entitlement sync ledger exists');
select ok(not has_table_privilege('authenticated','app_private.billing_plan_mappings','SELECT'),'authenticated cannot read Stripe product/price mappings');
select ok((select relrowsecurity from pg_class where oid='public.billing_sync_events'::regclass),'billing sync events have RLS');
select ok(exists(select 1 from pg_constraint where conrelid='public.subscriptions'::regclass and contype='c'),'subscription state constraint remains enforced');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='subscriptions_provider_sub_uidx'),'external subscription identity remains unique');

select * from finish();
rollback;
