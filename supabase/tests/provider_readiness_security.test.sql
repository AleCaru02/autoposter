begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table('app_private','oauth_states','OAuth state is stored server-side');
select has_table('public','provider_permission_grants','permission grants table exists');
select has_table('public','provider_webhook_events','provider webhook event ledger exists');
select has_table('public','provider_audit_events','provider audit log exists');
select has_table('public','document_ingestions','document ingestion state exists');
select has_table('public','document_chunks','document chunks exist');
select has_table('public','knowledge_sources','knowledge provenance sources exist');
select has_table('public','knowledge_facts','knowledge facts exist');
select has_column('public','brand_assets','thumbnail_small_path','small thumbnail path exists');
select has_column('public','brand_assets','thumbnail_medium_path','medium thumbnail path exists');
select has_column('public','social_accounts','health_status','account health status exists');
select has_column('public','social_accounts','missing_permissions','missing permissions are explicit');
select ok((select relrowsecurity from pg_class where oid='public.provider_webhook_events'::regclass),'provider webhook events have RLS');
select ok((select relrowsecurity from pg_class where oid='public.provider_audit_events'::regclass),'provider audit events have RLS');
select ok((select relrowsecurity from pg_class where oid='public.document_ingestions'::regclass),'document ingestions have RLS');
select ok((select relrowsecurity from pg_class where oid='public.knowledge_sources'::regclass),'knowledge sources have RLS');
select ok(not has_table_privilege('authenticated','app_private.oauth_states','SELECT'),'authenticated cannot read OAuth state records');
select ok(not has_table_privilege('authenticated','app_private.integration_credentials','SELECT'),'authenticated cannot read provider credentials');
select ok(not has_function_privilege('authenticated','app_private.get_integration_credential(uuid)','EXECUTE'),'authenticated cannot execute credential getter');
select ok(has_function_privilege('service_role','app_private.assert_tenant_feature(uuid,text,text)','EXECUTE'),'service role can enforce tenant entitlements');

select * from finish();
rollback;
