begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

select is(
  (
    select count(*)::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and c.relrowsecurity = false
  ),
  0::bigint,
  'every public table has RLS enabled'
);

select ok(exists(select 1 from pg_namespace where nspname = 'app_private'), 'app_private schema exists');
select ok(not has_schema_privilege('anon', 'app_private', 'USAGE'), 'anon cannot use app_private schema');
select ok(not has_schema_privilege('authenticated', 'app_private', 'USAGE'), 'authenticated cannot use app_private schema');
select ok(not has_table_privilege('authenticated', 'app_private.integration_credentials', 'SELECT'), 'authenticated cannot read integration credentials');

select is(
  (
    select count(*)::bigint
    from information_schema.columns
    where table_schema = 'app_private'
      and table_name = 'integration_credentials'
      and column_name in ('token','access_token','refresh_token','client_secret','secret')
  ),
  0::bigint,
  'integration credentials has no plaintext token or secret columns'
);

select ok(exists(select 1 from pg_constraint where conname = 'brand_profile_locks_tenant_profile_fkey' and contype = 'f'), 'brand profile locks enforce tenant-consistent parent references');
select ok(exists(select 1 from pg_constraint where conname = 'website_pages_tenant_website_fkey' and contype = 'f'), 'website pages enforce tenant-consistent website references');
select ok(exists(select 1 from pg_constraint where conname = 'post_variants_tenant_post_fkey' and contype = 'f'), 'post variants enforce tenant-consistent post references');
select ok(exists(select 1 from pg_constraint where conname = 'brand_profile_versions_tenant_profile_fkey' and contype = 'f'), 'brand profile versions enforce tenant-consistent parent references');

select ok(
  not has_function_privilege('authenticated', (select oid from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reserve_tenant_usage' limit 1), 'EXECUTE'),
  'authenticated cannot reserve quota directly'
);
select ok(
  has_function_privilege('service_role', (select oid from pg_proc where pronamespace = 'public'::regnamespace and proname = 'reserve_tenant_usage' limit 1), 'EXECUTE'),
  'service_role can reserve quota'
);
select ok(has_table_privilege('service_role', 'public.plans', 'SELECT'), 'service_role can read plan data required by quota and server workflows');
select ok(not has_table_privilege('authenticated', 'public.publication_jobs', 'INSERT'), 'authenticated cannot insert publication jobs');
select ok(has_table_privilege('authenticated', 'public.websites', 'SELECT'), 'authenticated can read websites through RLS');
select ok(has_table_privilege('authenticated', 'public.websites', 'INSERT'), 'authenticated editor path can insert websites through RLS');

select is(
  (select count(*)::bigint from storage.buckets where id in ('brand-assets','post-assets','tenant-documents') and public = false),
  3::bigint,
  'all application storage buckets are private'
);

select is(
  (select count(*)::bigint from supabase_migrations.schema_migrations where version like '202608%'),
  16::bigint,
  'all sixteen application migrations are present in local migration history'
);

select is(
  (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'vector'),
  'extensions',
  'vector extension is outside the public schema'
);

select is((select count(*)::bigint from public.plans where code = 'local-dev' and status = 'active'), 1::bigint, 'local seed plan exists');
select ok(
  exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'plans' and policyname = 'plans_select_anon')
  and not exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'plans' and policyname = 'plans_select_active'),
  'plans use the corrected anonymous read policy'
);

select ok(has_table_privilege('authenticated', 'public.onboarding_sessions', 'INSERT'), 'authenticated editor path can persist onboarding through RLS');
select ok(has_table_privilege('authenticated', 'public.brand_profile_versions', 'INSERT'), 'authenticated editor path can create brand versions through RLS');
select ok(not has_table_privilege('authenticated', 'public.learning_insights', 'INSERT'), 'authenticated client cannot forge learning insights');
select ok(
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='posts' and column_name='planned_at')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='posts' and column_name='primary_platform')
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='posts' and column_name='format'),
  'posts expose local e2e scheduling fields'
);
select ok(
  exists(select 1 from pg_policies where schemaname='public' and tablename='learning_insights' and policyname='learning_insights_tenant_select'),
  'learning insights are tenant-readable through RLS'
);
select ok(
  not exists(select 1 from pg_trigger where tgname='post_variants_enqueue_auto_publication' and not tgisinternal)
  and exists(select 1 from pg_trigger where tgname='post_variants_require_human_approval' and not tgisinternal)
  and exists(select 1 from pg_trigger where tgname='publication_jobs_require_human_approval' and not tgisinternal),
  'publication is gated by explicit human approval and the legacy AUTO enqueue trigger is absent'
);

select * from finish();
rollback;
