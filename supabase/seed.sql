insert into public.plans (code,name,description,price_amount,currency,billing_interval,posts_per_week,monthly_post_limit,platforms,analytics_level,auto_publish_allowed,website_page_limit,ai_budget_cents,storage_mb,team_members,status,config)
values ('local-dev','Local Development','Local and CI test fixture.',0,'EUR','manual',3,10,array['facebook','instagram','linkedin','google_business_profile'],'basic',true,50,1000,1024,5,'active','{"test_fixture":true}'::jsonb)
on conflict (code) do update set name=excluded.name, posts_per_week=excluded.posts_per_week, monthly_post_limit=excluded.monthly_post_limit, platforms=excluded.platforms, ai_budget_cents=excluded.ai_budget_cents, status=excluded.status, config=excluded.config, updated_at=now();

insert into public.product_knowledge_articles (slug,title,content,category,is_public,content_hash,published_at)
values
('local-test-knowledge','Local test knowledge','Fixture used to validate the public knowledge read path locally.','testing',true,encode(digest('local-test-knowledge-v1','sha256'),'hex'),now()),
('product-flow','Come funziona il prodotto','Il sistema guida onboarding, scansione sito, Brand Profile versionato, strategia, calendario, generazione per canale, quality gate, approvazione, scheduling, publishing e analytics. Instagram, Facebook, LinkedIn e Google Business Profile possono ricevere contenuti differenti oppure essere saltati quando non adatti.','product',true,encode(digest('product-flow-v1','sha256'),'hex'),now()),
('security-tenancy','Sicurezza multi-tenant','Ogni dato applicativo è tenant-scoped. Le policy RLS verificano membership e ruolo; i confronti anti-duplicate cross-tenant restano server-side e non espongono il contenuto di un tenant a un altro. Le credenziali di integrazione vivono in app_private e non sono leggibili dal client.','security',true,encode(digest('security-tenancy-v1','sha256'),'hex'),now()),
('approvals-auto','AUTO e MANUALE','La modalità di approvazione è configurabile per piattaforma. MANUALE inserisce il contenuto nell’Approval Center; AUTO può inviarlo allo scheduler soltanto dopo il superamento del quality gate.','workflow',true,encode(digest('approvals-auto-v1','sha256'),'hex'),now()),
('local-costs','Costi durante lo sviluppo','La modalità local E2E usa Supabase CLI, Docker, provider mock e GitHub Actions. Non richiede un terzo progetto Supabase remoto né API social reali. Il cost ledger può usare prezzi teorici configurabili senza hardcodare prezzi provider.','pricing',true,encode(digest('local-costs-v1','sha256'),'hex'),now())
on conflict (slug) do update set title=excluded.title, content=excluded.content, category=excluded.category, is_public=excluded.is_public, content_hash=excluded.content_hash, published_at=excluded.published_at, updated_at=now();

-- LOCAL SEED ONLY: this helper is intentionally not defined by migrations.
-- It exists solely inside `supabase db reset --local` / CI test databases and
-- prevents exposing app_private through PostgREST just to bootstrap an admin UI test.
create or replace function public.claim_local_platform_admin()
returns boolean
language plpgsql
security definer
set search_path = app_private, public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication_required'; end if;
  if exists(select 1 from app_private.platform_admins) and not exists(select 1 from app_private.platform_admins where user_id = v_user) then
    raise exception 'local_admin_already_claimed';
  end if;
  insert into app_private.platform_admins(user_id, created_by) values(v_user, v_user) on conflict(user_id) do nothing;
  return true;
end;
$$;
revoke all on function public.claim_local_platform_admin() from public, anon;
grant execute on function public.claim_local_platform_admin() to authenticated;
