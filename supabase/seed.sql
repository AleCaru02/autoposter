insert into public.plans (code,name,description,price_amount,currency,billing_interval,posts_per_week,monthly_post_limit,platforms,analytics_level,auto_publish_allowed,website_page_limit,ai_budget_cents,storage_mb,team_members,status,config)
values ('local-dev','Local Development','Local and CI test fixture.',0,'EUR','manual',3,10,array['facebook','instagram','linkedin','google_business_profile'],'basic',true,50,1000,1024,5,'active','{"test_fixture":true}'::jsonb)
on conflict (code) do update set
  name=excluded.name,
  posts_per_week=excluded.posts_per_week,
  monthly_post_limit=excluded.monthly_post_limit,
  platforms=excluded.platforms,
  ai_budget_cents=excluded.ai_budget_cents,
  status=excluded.status,
  config=excluded.config,
  updated_at=now();

insert into public.product_knowledge_articles (slug,title,content,category,is_public,content_hash,published_at)
values ('local-test-knowledge','Local test knowledge','Fixture used to validate the public knowledge read path locally.','testing',true,encode(digest('local-test-knowledge-v1','sha256'),'hex'),now())
on conflict (slug) do update set
  title=excluded.title,
  content=excluded.content,
  category=excluded.category,
  is_public=excluded.is_public,
  content_hash=excluded.content_hash,
  published_at=excluded.published_at,
  updated_at=now();
