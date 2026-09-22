-- Persistent, isolated demo tenant infrastructure.
-- This migration prepares the model and privileged bootstrap/reset functions;
-- it does not create a Managed Auth user and does not touch existing profiles.

BEGIN;

CREATE TABLE IF NOT EXISTS public.profile_tenant_modes (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  tenant_type text NOT NULL DEFAULT 'CUSTOMER_REAL',
  external_publishing_enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_tenant_modes_type_check CHECK (
    tenant_type IN ('CUSTOMER_REAL','QA_EPHEMERAL','DEMO_PERSISTENT')
  ),
  CONSTRAINT profile_tenant_modes_demo_publish_check CHECK (
    tenant_type <> 'DEMO_PERSISTENT' OR external_publishing_enabled IS FALSE
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS one_persistent_demo_tenant
  ON public.profile_tenant_modes (tenant_type)
  WHERE tenant_type='DEMO_PERSISTENT';

ALTER TABLE public.profile_tenant_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_tenant_modes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profile_tenant_modes_customer_read ON public.profile_tenant_modes;
CREATE POLICY profile_tenant_modes_customer_read ON public.profile_tenant_modes
  FOR SELECT TO authenticated USING (public.owns_profile(profile_id));
REVOKE ALL ON TABLE public.profile_tenant_modes FROM PUBLIC, authenticated;
GRANT SELECT ON TABLE public.profile_tenant_modes TO authenticated;

ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'CUSTOMER_REAL';
ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'CUSTOMER_REAL';
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'CUSTOMER_REAL';
ALTER TABLE public.website_scans
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'CUSTOMER_REAL';
ALTER TABLE public.website_pages
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'CUSTOMER_REAL';
ALTER TABLE public.publication_jobs
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'REAL_EXTERNAL';
ALTER TABLE public.metric_snapshots
  ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'PROVIDER_REAL';
ALTER TABLE public.learning_insights
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'PROVIDER_API';

DO $$ BEGIN
  ALTER TABLE public.content_items ADD CONSTRAINT content_items_data_origin_check
    CHECK (data_origin IN ('CUSTOMER_REAL','DEMO_SAMPLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.content_variants ADD CONSTRAINT content_variants_data_origin_check
    CHECK (data_origin IN ('CUSTOMER_REAL','DEMO_SAMPLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.schedules ADD CONSTRAINT schedules_data_origin_check
    CHECK (data_origin IN ('CUSTOMER_REAL','DEMO_SAMPLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.website_scans ADD CONSTRAINT website_scans_data_origin_check
    CHECK (data_origin IN ('CUSTOMER_REAL','DEMO_SAMPLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.website_pages ADD CONSTRAINT website_pages_data_origin_check
    CHECK (data_origin IN ('CUSTOMER_REAL','DEMO_SAMPLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.publication_jobs ADD CONSTRAINT publication_jobs_execution_mode_check
    CHECK (execution_mode IN ('REAL_EXTERNAL','DEMO_SIMULATION'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.metric_snapshots ADD CONSTRAINT metric_snapshots_data_origin_check
    CHECK (data_origin IN ('PROVIDER_REAL','DEMO_SAMPLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.learning_insights ADD CONSTRAINT learning_insights_source_type_check
    CHECK (source_type IN ('PROVIDER_API','DEMO_SAMPLE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.entitlement_packages(
  package_key,version,lifecycle,hard_monthly_provider_cost_cap_usd,metadata
) VALUES (
  'demo_persistent',1,'ACTIVE',5,
  '{"purpose":"PERSISTENT_PRODUCT_DEMO","externalPublishing":false}'::jsonb
) ON CONFLICT (package_key,version) DO UPDATE SET
  lifecycle='ACTIVE',
  hard_monthly_provider_cost_cap_usd=EXCLUDED.hard_monthly_provider_cost_cap_usd,
  metadata=EXCLUDED.metadata;

WITH demo_capabilities(capability_key,enabled,limit_type,limit_value,period_type,provider_attempt_reserve_usd) AS (
  VALUES
    ('workspace.profile.manage',true,'CONCURRENT',1::numeric,'MONTH',0.01::numeric),
    ('website.scan',true,'COUNT_PER_MONTH',5,'MONTH',0.25),
    ('website.pages.persist',true,'STORAGE',100,'MONTH',0.01),
    ('brand.analyze',true,'COUNT_PER_MONTH',5,'MONTH',0.50),
    ('ai.content.generate_text',true,'COUNT_PER_MONTH',50,'MONTH',0.50),
    ('ai.research.web',true,'COUNT_PER_MONTH',10,'MONTH',0.25),
    ('ai.research.factcheck',true,'COUNT_PER_MONTH',10,'MONTH',0.25),
    ('ai.strategy.generate',true,'COUNT_PER_MONTH',10,'MONTH',0.50),
    ('ai.image.generate',true,'COUNT_PER_MONTH',20,'MONTH',0.50),
    ('media.image.persist',true,'STORAGE',100,'MONTH',0.01),
    ('content.approval.auto',true,'BOOLEAN',1,'MONTH',0.01),
    ('autopilot.manage',true,'BOOLEAN',1,'MONTH',0.01),
    ('autopilot.hourly',true,'COUNT_PER_DAY',6,'DAY',0.50),
    ('schedule.job.create',true,'COUNT_PER_MONTH',100,'MONTH',0.01),
    ('social.facebook.connect',false,'MAX_CONNECTED_ACCOUNTS',NULL,'NONE',NULL),
    ('social.instagram.connect',false,'MAX_CONNECTED_ACCOUNTS',NULL,'NONE',NULL),
    ('social.linkedin.connect',false,'MAX_CONNECTED_ACCOUNTS',NULL,'NONE',NULL),
    ('social.gbp.connect',false,'MAX_CONNECTED_ACCOUNTS',NULL,'NONE',NULL),
    ('social.facebook.publish',false,'COUNT_PER_MONTH',NULL,'NONE',NULL),
    ('social.instagram.publish',false,'COUNT_PER_MONTH',NULL,'NONE',NULL),
    ('social.linkedin.publish',false,'COUNT_PER_MONTH',NULL,'NONE',NULL),
    ('social.gbp.publish',false,'COUNT_PER_MONTH',NULL,'NONE',NULL),
    ('social.publish.scheduled',false,'BOOLEAN',NULL,'NONE',NULL)
)
INSERT INTO public.entitlement_package_capabilities(
  package_key,package_version,capability_key,enabled,limit_type,limit_value,
  period_type,provider_attempt_reserve_usd,metadata
)
SELECT 'demo_persistent',1,capability_key,enabled,limit_type,limit_value,
  period_type,provider_attempt_reserve_usd,
  jsonb_build_object('demo',true,'externalPublishing',false)
FROM demo_capabilities
ON CONFLICT (package_key,package_version,capability_key) DO UPDATE SET
  enabled=EXCLUDED.enabled,limit_type=EXCLUDED.limit_type,
  limit_value=EXCLUDED.limit_value,period_type=EXCLUDED.period_type,
  provider_attempt_reserve_usd=EXCLUDED.provider_attempt_reserve_usd,
  metadata=EXCLUDED.metadata;

CREATE OR REPLACE FUNCTION public.is_demo_persistent_profile(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profile_tenant_modes mode
    WHERE mode.profile_id=p_profile_id
      AND mode.tenant_type='DEMO_PERSISTENT'
      AND mode.external_publishing_enabled=false
  );
$$;
REVOKE ALL ON FUNCTION public.is_demo_persistent_profile(uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.guard_demo_social_connection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
  IF public.is_demo_persistent_profile(NEW.profile_id) THEN
    RAISE EXCEPTION 'DEMO_EXTERNAL_CONNECTION_DISABLED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS demo_social_connection_guard ON public.social_connections;
CREATE TRIGGER demo_social_connection_guard BEFORE INSERT OR UPDATE ON public.social_connections
FOR EACH ROW EXECUTE FUNCTION public.guard_demo_social_connection();

CREATE OR REPLACE FUNCTION public.enforce_demo_publication_mode()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
BEGIN
  IF public.is_demo_persistent_profile(NEW.profile_id) THEN
    NEW.execution_mode:='DEMO_SIMULATION';
    NEW.remote_post_id:=NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS demo_publication_mode_guard ON public.publication_jobs;
CREATE TRIGGER demo_publication_mode_guard BEFORE INSERT OR UPDATE ON public.publication_jobs
FOR EACH ROW EXECUTE FUNCTION public.enforce_demo_publication_mode();

CREATE OR REPLACE FUNCTION public.seed_demo_tenant(p_profile_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  v_now timestamptz:=date_trunc('hour',clock_timestamp());
  v_period_start timestamptz:=date_trunc('month',clock_timestamp());
  v_period_end timestamptz:=date_trunc('month',clock_timestamp())+interval '1 month';
BEGIN
  IF NOT public.is_demo_persistent_profile(p_profile_id) THEN
    RAISE EXCEPTION 'DEMO_PROFILE_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('demo-seed:'||p_profile_id::text,0));

  INSERT INTO public.brand_profiles(
    profile_id,description,business_model,location,service_area,target_audience,
    tone_of_voice,visual_identity,services,differentiators,value_propositions,goals,updated_at
  ) VALUES (
    p_profile_id,
    'Attività dimostrativa di consulenza e gestione social per piccole imprese locali.',
    'Servizio in abbonamento con consulenza e produzione di contenuti.',
    'Milano','Milano e provincia',
    '{"summary":"Titolari di piccole attività locali","segments":["Ristoratori","Professionisti","Negozi locali"]}'::jsonb,
    '{"summary":"Chiaro, competente e concreto","traits":["Professionale","Diretto","Affidabile"]}'::jsonb,
    '{"observedColors":["#173F35","#F2B84B","#F7F4EC"],"summary":"Identità calda e professionale — DEMO"}'::jsonb,
    '["Piano editoriale","Creazione contenuti","Analisi risultati"]'::jsonb,
    '["Approccio pratico","Conoscenza del territorio"]'::jsonb,
    '["Comunicazione costante senza perdere tempo"]'::jsonb,
    '["Più richieste","Notorietà locale","Fiducia nel brand"]'::jsonb,v_now
  ) ON CONFLICT (profile_id) DO UPDATE SET
    description=EXCLUDED.description,business_model=EXCLUDED.business_model,
    location=EXCLUDED.location,service_area=EXCLUDED.service_area,
    target_audience=EXCLUDED.target_audience,tone_of_voice=EXCLUDED.tone_of_voice,
    visual_identity=EXCLUDED.visual_identity,services=EXCLUDED.services,
    differentiators=EXCLUDED.differentiators,value_propositions=EXCLUDED.value_propositions,
    goals=EXCLUDED.goals,updated_at=EXCLUDED.updated_at;

  INSERT INTO public.content_strategies(profile_id,objectives,platform_strategy,updated_at)
  VALUES (p_profile_id,'["Lead","Notorietà locale","Fiducia"]'::jsonb,
    '{"autopilotEnabled":false,"approvalMode":"MANUAL_REVIEW","researchMode":"BALANCED","demo":true}'::jsonb,v_now)
  ON CONFLICT (profile_id) DO UPDATE SET objectives=EXCLUDED.objectives,
    platform_strategy=EXCLUDED.platform_strategy,updated_at=EXCLUDED.updated_at;

  INSERT INTO public.website_scans(
    id,profile_id,root_url,state,page_limit,max_depth,discovered_pages,
    analyzed_pages,skipped_pages,failed_pages,started_at,last_progress_at,
    finished_at,error,data_origin
  ) VALUES (
    'd3500000-0000-4000-8000-000000000001',p_profile_id,
    'https://demo.post-automatici.invalid/','COMPLETE',8,12,3,3,0,0,
    v_now-interval '1 day',v_now-interval '1 day',v_now-interval '1 day',NULL,'DEMO_SAMPLE'
  ) ON CONFLICT (id) DO UPDATE SET profile_id=EXCLUDED.profile_id,
    state='COMPLETE',discovered_pages=3,analyzed_pages=3,skipped_pages=0,
    failed_pages=0,finished_at=EXCLUDED.finished_at,error=NULL,data_origin='DEMO_SAMPLE';

  INSERT INTO public.website_pages(
    id,scan_id,profile_id,url,normalized_url,status,depth,title,meta_description,
    content_text,content_hash,discovered_from,skip_reason,error,scanned_at,data_origin
  ) VALUES
    ('d3510000-0000-4000-8000-000000000001','d3500000-0000-4000-8000-000000000001',p_profile_id,
      'https://demo.post-automatici.invalid/','https://demo.post-automatici.invalid/','ANALYZED',0,
      'Demo Post Automatici','Sito dimostrativo — nessun dominio reale',
      'SAMPLE DATA — consulenza social per piccole attività locali. Piano editoriale, contenuti e analisi risultati.',
      'demo-home-v1',NULL,NULL,NULL,v_now-interval '1 day','DEMO_SAMPLE'),
    ('d3510000-0000-4000-8000-000000000002','d3500000-0000-4000-8000-000000000001',p_profile_id,
      'https://demo.post-automatici.invalid/servizi','https://demo.post-automatici.invalid/servizi','ANALYZED',1,
      'Servizi demo','Servizi dimostrativi',
      'SAMPLE DATA — piano editoriale, creazione contenuti e analisi dei risultati per attività locali.',
      'demo-services-v1','https://demo.post-automatici.invalid/',NULL,NULL,v_now-interval '1 day','DEMO_SAMPLE'),
    ('d3510000-0000-4000-8000-000000000003','d3500000-0000-4000-8000-000000000001',p_profile_id,
      'https://demo.post-automatici.invalid/chi-siamo','https://demo.post-automatici.invalid/chi-siamo','ANALYZED',1,
      'Chi siamo — demo','Identità dimostrativa',
      'SAMPLE DATA — tono chiaro, competente e concreto. Identità calda e professionale.',
      'demo-about-v1','https://demo.post-automatici.invalid/',NULL,NULL,v_now-interval '1 day','DEMO_SAMPLE')
  ON CONFLICT (id) DO UPDATE SET profile_id=EXCLUDED.profile_id,scan_id=EXCLUDED.scan_id,
    title=EXCLUDED.title,content_text=EXCLUDED.content_text,status='ANALYZED',
    data_origin='DEMO_SAMPLE',scanned_at=EXCLUDED.scanned_at;

  INSERT INTO public.content_items(id,profile_id,topic,objective,title,status,data_origin,updated_at) VALUES
    ('d3000000-0000-4000-8000-000000000001',p_profile_id,'Consiglio della settimana','Educare','Tre errori da evitare sui social','DRAFT','DEMO_SAMPLE',v_now),
    ('d3000000-0000-4000-8000-000000000002',p_profile_id,'Dietro le quinte','Fiducia','Come nasce un piano editoriale','IN_REVIEW','DEMO_SAMPLE',v_now),
    ('d3000000-0000-4000-8000-000000000003',p_profile_id,'Caso cliente','Lead','Da pagina ferma a comunicazione costante','APPROVED','DEMO_SAMPLE',v_now),
    ('d3000000-0000-4000-8000-000000000004',p_profile_id,'Servizio in evidenza','Conversione','Il piano social pensato per le attività locali','APPROVED','DEMO_SAMPLE',v_now),
    ('d3000000-0000-4000-8000-000000000005',p_profile_id,'Risultato del mese','Fiducia','Cosa abbiamo imparato questo mese','APPROVED','DEMO_SAMPLE',v_now)
  ON CONFLICT (id) DO UPDATE SET profile_id=EXCLUDED.profile_id,topic=EXCLUDED.topic,
    objective=EXCLUDED.objective,title=EXCLUDED.title,status=EXCLUDED.status,
    data_origin='DEMO_SAMPLE',updated_at=EXCLUDED.updated_at;

  INSERT INTO public.content_variants(
    id,content_id,profile_id,provider,format,eligible,hook,caption,cta,hashtags,
    visual_brief,alt_text,approval_status,data_origin,updated_at
  ) VALUES
    ('d3100000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000002',p_profile_id,'INSTAGRAM','POST',true,'Dietro ogni contenuto c’è un metodo.','Dal brief alla revisione: ecco come costruiamo un piano editoriale demo.','Scopri il processo','["demo","socialmedia"]'::jsonb,'Scrivania con calendario editoriale','Calendario editoriale dimostrativo','PENDING','DEMO_SAMPLE',v_now),
    ('d3100000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000003',p_profile_id,'FACEBOOK','POST',true,'La costanza batte l’improvvisazione.','Un esempio dimostrativo di strategia semplice e sostenibile.','Richiedi informazioni','["demo","attivitalocali"]'::jsonb,'Grafico di crescita demo','Grafico dimostrativo','APPROVED','DEMO_SAMPLE',v_now),
    ('d3100000-0000-4000-8000-000000000004','d3000000-0000-4000-8000-000000000004',p_profile_id,'INSTAGRAM','POST',true,'Meno improvvisazione, più risultati leggibili.','Contenuto dimostrativo programmato nel calendario.','Guarda il servizio','["demo","pianoeditoriale"]'::jsonb,'Telefono con calendario demo','Anteprima demo','APPROVED','DEMO_SAMPLE',v_now),
    ('d3100000-0000-4000-8000-000000000005','d3000000-0000-4000-8000-000000000005',p_profile_id,'FACEBOOK','POST',true,'I dati aiutano a scegliere meglio.','Pubblicazione dimostrativa: nessun contenuto è stato inviato a un social reale.','Vedi i dati','["demo","analytics"]'::jsonb,'Dashboard analytics demo','Dashboard dimostrativa','APPROVED','DEMO_SAMPLE',v_now)
  ON CONFLICT (id) DO UPDATE SET caption=EXCLUDED.caption,approval_status=EXCLUDED.approval_status,
    data_origin='DEMO_SAMPLE',updated_at=EXCLUDED.updated_at;

  INSERT INTO public.schedules(profile_id,provider,timezone,posts_per_week,preferred_slots,auto_choose,enabled,data_origin,updated_at)
  SELECT p_profile_id,provider,'Europe/Rome',posts,'[]'::jsonb,true,true,'DEMO_SAMPLE',v_now
  FROM (VALUES ('INSTAGRAM',3),('FACEBOOK',2)) AS seed(provider,posts)
  ON CONFLICT (profile_id,provider) DO UPDATE SET timezone=EXCLUDED.timezone,
    posts_per_week=EXCLUDED.posts_per_week,preferred_slots=EXCLUDED.preferred_slots,
    auto_choose=EXCLUDED.auto_choose,enabled=EXCLUDED.enabled,
    data_origin='DEMO_SAMPLE',updated_at=EXCLUDED.updated_at;

  INSERT INTO public.publication_jobs(
    id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,
    execution_mode,published_at,remote_post_id,updated_at
  ) VALUES
    ('d3200000-0000-4000-8000-000000000004',p_profile_id,'d3100000-0000-4000-8000-000000000004','INSTAGRAM','SCHEDULED',v_now+interval '3 days','demo:scheduled:v1',0,'DEMO_SIMULATION',NULL,NULL,v_now),
    ('d3200000-0000-4000-8000-000000000005',p_profile_id,'d3100000-0000-4000-8000-000000000005','FACEBOOK','PUBLISHED',v_now-interval '7 days','demo:published:v1',0,'DEMO_SIMULATION',v_now-interval '7 days',NULL,v_now)
  ON CONFLICT (id) DO UPDATE SET state=EXCLUDED.state,scheduled_at=EXCLUDED.scheduled_at,
    execution_mode='DEMO_SIMULATION',published_at=EXCLUDED.published_at,
    remote_post_id=NULL,updated_at=EXCLUDED.updated_at;

  INSERT INTO public.metric_snapshots(
    id,profile_id,provider,content_id,variant_id,job_id,external_post_id,format,topic,
    published_at,captured_at,metrics,source,data_origin
  ) VALUES
    ('d3300000-0000-4000-8000-000000000001',p_profile_id,'FACEBOOK','d3000000-0000-4000-8000-000000000005','d3100000-0000-4000-8000-000000000005','d3200000-0000-4000-8000-000000000005','DEMO_SAMPLE_FB_001','POST','Risultato del mese',v_now-interval '7 days',v_now,'{"impressions":2480,"reach":1930,"likes":124,"comments":18,"shares":21,"clicks":67}'::jsonb,'DEMO_SAMPLE','DEMO_SAMPLE'),
    ('d3300000-0000-4000-8000-000000000002',p_profile_id,'INSTAGRAM','d3000000-0000-4000-8000-000000000003','d3100000-0000-4000-8000-000000000003',NULL,'DEMO_SAMPLE_IG_001','POST','Caso cliente',v_now-interval '12 days',v_now,'{"impressions":3260,"reach":2510,"likes":208,"comments":24,"shares":31,"saves":54,"clicks":89}'::jsonb,'DEMO_SAMPLE','DEMO_SAMPLE')
  ON CONFLICT (id) DO UPDATE SET metrics=EXCLUDED.metrics,captured_at=EXCLUDED.captured_at,
    source='DEMO_SAMPLE',data_origin='DEMO_SAMPLE';

  INSERT INTO public.learning_insights(
    id,scope,insight,evidence,recommended_action,applied_at,created_at,profile_id,
    dimension,dimension_value,sample_size,total_scorable_samples,baseline_score,
    segment_score,uplift_pct,confidence,recommendation,metric_basis,observed_from,
    observed_to,generated_at,active,source_type
  ) VALUES
    ('d3400000-0000-4000-8000-000000000001','FORMAT','I post educativi ottengono più salvataggi nei dati dimostrativi.','{"demo":true}'::jsonb,'{"demo":true,"action":"Usa più contenuti educativi"}'::jsonb,NULL,v_now,p_profile_id,'FORMAT','POST',6,12,1.0,1.3,30,'MEDIUM','Alterna consigli pratici e casi dimostrativi.','DEMO_SAMPLE',v_now-interval '30 days',v_now,v_now,true,'DEMO_SAMPLE'),
    ('d3400000-0000-4000-8000-000000000002','TOPIC','I casi cliente attirano più clic nei dati dimostrativi.','{"demo":true}'::jsonb,'{"demo":true,"action":"Mostra il processo"}'::jsonb,NULL,v_now,p_profile_id,'TOPIC','Caso cliente',5,12,1.0,1.25,25,'MEDIUM','Mostra il processo con esempi chiaramente demo.','DEMO_SAMPLE',v_now-interval '30 days',v_now,v_now,true,'DEMO_SAMPLE')
  ON CONFLICT (profile_id,dimension,dimension_value)
    WHERE dimension IS NOT NULL AND dimension_value IS NOT NULL
  DO UPDATE SET insight=EXCLUDED.insight,evidence=EXCLUDED.evidence,
    recommended_action=EXCLUDED.recommended_action,recommendation=EXCLUDED.recommendation,
    source_type='DEMO_SAMPLE',generated_at=EXCLUDED.generated_at,active=true;

  INSERT INTO public.capability_usage_buckets(
    profile_id,capability_key,period_start,period_end,reserved_quantity,committed_quantity,updated_at
  ) VALUES
    (p_profile_id,'ai.content.generate_text',v_period_start,v_period_end,0,12,v_now),
    (p_profile_id,'ai.image.generate',v_period_start,v_period_end,0,4,v_now),
    (p_profile_id,'ai.strategy.generate',v_period_start,v_period_end,0,2,v_now)
  ON CONFLICT (profile_id,capability_key,period_start,period_end) DO UPDATE SET
    reserved_quantity=0,committed_quantity=EXCLUDED.committed_quantity,updated_at=EXCLUDED.updated_at;

  RETURN jsonb_build_object('profileId',p_profile_id,'seeded',true,'source','DEMO_SAMPLE');
END;
$$;
REVOKE ALL ON FUNCTION public.seed_demo_tenant(uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.complete_demo_publication_job(
  p_job_id uuid,p_claim_token uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE v_job public.publication_jobs%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
  SELECT job.* INTO v_job FROM public.publication_jobs job
  WHERE job.id=p_job_id AND job.state='PROCESSING' AND job.claim_token=p_claim_token
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT public.is_demo_persistent_profile(v_job.profile_id) THEN
    RAISE EXCEPTION 'DEMO_PROFILE_REQUIRED' USING ERRCODE='42501';
  END IF;
  UPDATE public.publication_attempts
  SET state='SUCCESS',response_metadata='{"demo":true,"externalRequest":false}'::jsonb,
      finished_at=v_now
  WHERE job_id=v_job.id AND attempt_no=v_job.attempt_count AND claim_token=p_claim_token
    AND state='CLAIMED';
  UPDATE public.publication_jobs
  SET state='PUBLISHED',execution_mode='DEMO_SIMULATION',published_at=v_now,remote_post_id=NULL,
      claim_token=NULL,lease_expires_at=NULL,locked_at=NULL,next_attempt_at=NULL,
      failure_code=NULL,outcome_unknown=false,last_error=NULL,updated_at=v_now
  WHERE id=v_job.id;
  UPDATE public.content_variants SET published_at=v_now,external_post_id=NULL,updated_at=v_now
  WHERE id=v_job.variant_id AND profile_id=v_job.profile_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_demo_publication_job(uuid,uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.provision_demo_tenant(
  p_owner_auth_user_id text,p_actor_auth_user_id text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  v_profile_id uuid;
  v_owner_user_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM neon_auth.user actor
    WHERE actor.id::text=p_actor_auth_user_id
      AND lower(coalesce(actor.role::text,''))='admin'
      AND coalesce(actor.banned,false)=false
  ) THEN RAISE EXCEPTION 'DEMO_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM neon_auth.user owner_user WHERE owner_user.id::text=p_owner_auth_user_id) THEN
    RAISE EXCEPTION 'DEMO_OWNER_UNKNOWN' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.app_users(auth_user_id) VALUES (p_owner_auth_user_id)
  ON CONFLICT (auth_user_id) DO NOTHING;
  SELECT app_user.id INTO v_owner_user_id FROM public.app_users app_user
  WHERE app_user.auth_user_id=p_owner_auth_user_id;
  IF v_owner_user_id IS NULL THEN RAISE EXCEPTION 'DEMO_OWNER_APP_USER_MISSING'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('persistent-demo-tenant',0));
  SELECT mode.profile_id INTO v_profile_id FROM public.profile_tenant_modes mode
  WHERE mode.tenant_type='DEMO_PERSISTENT' FOR UPDATE;
  IF v_profile_id IS NULL THEN
    INSERT INTO public.profiles(owner_auth_user_id,name,slug,website_url,industry,onboarding_completed)
    VALUES (p_owner_auth_user_id,'Demo Post Automatici','demo-post-automatici',
      'https://demo.post-automatici.invalid','Marketing digitale — DEMO',true)
    RETURNING id INTO v_profile_id;
    INSERT INTO public.profile_tenant_modes(profile_id,tenant_type,external_publishing_enabled,metadata)
    VALUES (v_profile_id,'DEMO_PERSISTENT',false,'{"label":"DEMO / SAMPLE DATA"}'::jsonb);
  ELSE
    UPDATE public.profiles SET owner_auth_user_id=p_owner_auth_user_id,owner_user_id=v_owner_user_id,
      name='Demo Post Automatici',
      website_url='https://demo.post-automatici.invalid',industry='Marketing digitale — DEMO',
      onboarding_completed=true,archived_at=NULL,updated_at=now() WHERE id=v_profile_id;
  END IF;
  DELETE FROM public.profile_members membership
  WHERE membership.profile_id=v_profile_id AND upper(membership.role)='OWNER'
    AND membership.user_id<>v_owner_user_id;
  INSERT INTO public.profile_members(profile_id,user_id,role)
  VALUES (v_profile_id,v_owner_user_id,'OWNER')
  ON CONFLICT (profile_id,user_id) DO UPDATE SET role='OWNER';
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_entitlement_package_assignments assignment
    WHERE assignment.profile_id=v_profile_id AND assignment.package_key='demo_persistent'
      AND assignment.package_version=1 AND assignment.revoked_at IS NULL
  ) THEN
    PERFORM public.apply_entitlement_package(v_profile_id,'demo_persistent',1,p_actor_auth_user_id,
      'DEMO_SERVER',jsonb_build_object('tenantType','DEMO_PERSISTENT'));
  END IF;
  PERFORM public.seed_demo_tenant(v_profile_id);
  RETURN v_profile_id;
END;
$$;
REVOKE ALL ON FUNCTION public.provision_demo_tenant(text,text) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.reset_demo_tenant(
  p_profile_id uuid,p_actor_auth_user_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM neon_auth.user actor
    WHERE actor.id::text=p_actor_auth_user_id
      AND lower(coalesce(actor.role::text,''))='admin'
      AND coalesce(actor.banned,false)=false
  ) THEN RAISE EXCEPTION 'DEMO_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT public.is_demo_persistent_profile(p_profile_id) THEN
    RAISE EXCEPTION 'DEMO_PROFILE_REQUIRED' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('demo-reset:'||p_profile_id::text,0));
  DELETE FROM public.metric_snapshots WHERE profile_id=p_profile_id AND data_origin='DEMO_SAMPLE';
  DELETE FROM public.learning_insights WHERE profile_id=p_profile_id AND source_type='DEMO_SAMPLE';
  DELETE FROM public.publication_jobs WHERE profile_id=p_profile_id AND execution_mode='DEMO_SIMULATION';
  DELETE FROM public.schedules WHERE profile_id=p_profile_id AND data_origin='DEMO_SAMPLE';
  DELETE FROM public.website_pages WHERE profile_id=p_profile_id AND data_origin='DEMO_SAMPLE';
  DELETE FROM public.website_scans WHERE profile_id=p_profile_id AND data_origin='DEMO_SAMPLE';
  DELETE FROM public.content_items WHERE profile_id=p_profile_id AND data_origin='DEMO_SAMPLE';
  DELETE FROM public.capability_usage_buckets WHERE profile_id=p_profile_id;
  SELECT public.seed_demo_tenant(p_profile_id) INTO v_result;
  INSERT INTO public.platform_admin_audit(actor_auth_user_id,action,target_type,target_id,metadata)
  VALUES (p_actor_auth_user_id,'DEMO_TENANT_RESET','profile',p_profile_id::text,
    '{"tenantType":"DEMO_PERSISTENT"}'::jsonb);
  RETURN v_result||jsonb_build_object('reset',true);
END;
$$;
REVOKE ALL ON FUNCTION public.reset_demo_tenant(uuid,text) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.guard_persistent_demo_profile_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.profile_tenant_modes mode
    WHERE mode.profile_id=OLD.id AND mode.tenant_type='DEMO_PERSISTENT'
  ) THEN RAISE EXCEPTION 'DEMO_PERSISTENT_DELETE_DENIED' USING ERRCODE='42501'; END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS persistent_demo_profile_delete_guard ON public.profiles;
CREATE TRIGGER persistent_demo_profile_delete_guard BEFORE DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_persistent_demo_profile_delete();

COMMIT;
