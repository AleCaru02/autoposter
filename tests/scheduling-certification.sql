\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';

CREATE TEMP TABLE scheduling_cert_refs (
  key text PRIMARY KEY,
  id uuid NOT NULL
);

DO $setup$
DECLARE
  v_profile constant uuid := '11111111-1111-4111-8111-111111111100';
  v_content constant uuid := '11111111-1111-4111-8111-111111111200';
  v_future_variant constant uuid := '11111111-1111-4111-8111-111111111201';
  v_due_variant constant uuid := '11111111-1111-4111-8111-111111111202';
  v_exact_variant constant uuid := '11111111-1111-4111-8111-111111111203';
  v_past_variant constant uuid := '11111111-1111-4111-8111-111111111204';
  v_pending_variant constant uuid := '11111111-1111-4111-8111-111111111205';
  v_rejected_variant constant uuid := '11111111-1111-4111-8111-111111111206';
  v_completed_variant constant uuid := '11111111-1111-4111-8111-111111111207';
  v_processing_variant constant uuid := '11111111-1111-4111-8111-111111111208';
  v_cancelled_variant constant uuid := '11111111-1111-4111-8111-111111111209';
  v_invalidated_variant constant uuid := '11111111-1111-4111-8111-111111111210';
  v_now timestamptz := clock_timestamp();
  v_operation text := 'schedulingCertFuture01';
  v_key text := 'calendar-create:v1:' || v_profile::text || ':' || v_operation;
  v_event uuid;
  v_created uuid;
  v_replayed uuid;
  v_cancel_updated timestamptz;
  v_removed boolean;
BEGIN
  INSERT INTO neon_auth."user"(id,email,name,role,banned)
  VALUES ('scheduling-cert-user','scheduling-cert@example.test','Scheduling Certification','user',false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles(id,owner_auth_user_id,name,slug,timezone,onboarding_completed)
  VALUES (v_profile,'scheduling-cert-user','Scheduling Certification','scheduling-certification','Europe/Rome',true);

  INSERT INTO public.profile_tenant_modes(profile_id,tenant_type,external_publishing_enabled,metadata)
  VALUES (v_profile,'QA_EPHEMERAL',false,'{"purpose":"SCHEDULING_CERTIFICATION","externalWrite":false}'::jsonb);

  INSERT INTO public.social_connections(profile_id,provider,status,account_name,permissions)
  VALUES (v_profile,'FACEBOOK','ACTIVE','CI scheduling fixture','[]'::jsonb);

  INSERT INTO public.content_items(id,profile_id,topic,status,data_origin)
  VALUES (v_content,v_profile,'Scheduling certification','IN_REVIEW','DEMO_SAMPLE');

  INSERT INTO public.content_variants(
    id,content_id,profile_id,provider,format,eligible,caption,approval_status,
    data_origin,qa_status,qa_fingerprint,approval_mode,workflow_status,
    approved_by,approved_at,approved_fingerprint
  ) VALUES
    (v_future_variant,v_content,v_profile,'FACEBOOK','POST',true,'future','APPROVED','DEMO_SAMPLE','PASS','fp-future','MANUAL','APPROVED','CI',v_now,'fp-future'),
    (v_due_variant,v_content,v_profile,'FACEBOOK','POST',true,'due','APPROVED','DEMO_SAMPLE','PASS','fp-due','MANUAL','APPROVED','CI',v_now,'fp-due'),
    (v_exact_variant,v_content,v_profile,'FACEBOOK','POST',true,'exact','APPROVED','DEMO_SAMPLE','PASS','fp-exact','MANUAL','APPROVED','CI',v_now,'fp-exact'),
    (v_past_variant,v_content,v_profile,'FACEBOOK','POST',true,'past','APPROVED','DEMO_SAMPLE','PASS','fp-past','MANUAL','APPROVED','CI',v_now,'fp-past'),
    (v_pending_variant,v_content,v_profile,'FACEBOOK','POST',true,'pending','PENDING','DEMO_SAMPLE','PASS','fp-pending','MANUAL','REVIEW',NULL,NULL,NULL),
    (v_rejected_variant,v_content,v_profile,'FACEBOOK','POST',true,'rejected','CHANGES_REQUESTED','DEMO_SAMPLE','PASS','fp-rejected','MANUAL','REJECTED',NULL,NULL,NULL),
    (v_completed_variant,v_content,v_profile,'FACEBOOK','POST',true,'completed','APPROVED','DEMO_SAMPLE','PASS','fp-completed','MANUAL','APPROVED','CI',v_now,'fp-completed'),
    (v_processing_variant,v_content,v_profile,'FACEBOOK','POST',true,'processing','APPROVED','DEMO_SAMPLE','PASS','fp-processing','MANUAL','APPROVED','CI',v_now,'fp-processing'),
    (v_cancelled_variant,v_content,v_profile,'FACEBOOK','POST',true,'cancelled','APPROVED','DEMO_SAMPLE','PASS','fp-cancelled','MANUAL','APPROVED','CI',v_now,'fp-cancelled'),
    (v_invalidated_variant,v_content,v_profile,'FACEBOOK','POST',true,'invalidated','APPROVED','DEMO_SAMPLE','PASS','fp-invalidated','MANUAL','APPROVED','CI',v_now,'fp-invalidated');

  PERFORM *
  FROM public.save_profile_schedule(
    'scheduling-cert-user',v_profile,'FACEBOOK','Europe/Rome',3,
    '[{"day":1,"time":"09:00"},{"day":5,"time":"18:30"}]'::jsonb,true,true
  );

  BEGIN
    PERFORM *
    FROM public.save_profile_schedule(
      'scheduling-cert-user',v_profile,'FACEBOOK','Mars/Olympus',1,'[]'::jsonb,true,true
    );
    RAISE EXCEPTION 'SCHEDULING_INVALID_TIMEZONE_ACCEPTED';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN NULL;
  END;

  SELECT event_id INTO v_event
  FROM public.reserve_capability_usage(
    v_profile,'schedule.job.create',1,NULL,
    date_trunc('month',v_now),date_trunc('month',v_now)+interval '1 month',
    v_key,'SCHEDULING_CERTIFICATION',v_future_variant::text,
    '{"fixture":"future-job"}'::jsonb
  );

  SELECT job_id INTO v_created
  FROM public.create_profile_calendar_job(
    'scheduling-cert-user',v_profile,v_future_variant,v_now+interval '1 day',v_operation,v_event
  );

  SELECT job_id INTO v_replayed
  FROM public.create_profile_calendar_job(
    'scheduling-cert-user',v_profile,v_future_variant,v_now+interval '1 day',v_operation,v_event
  );

  IF v_created IS DISTINCT FROM v_replayed THEN
    RAISE EXCEPTION 'SCHEDULING_CREATE_IDEMPOTENCY_FAILED';
  END IF;
  INSERT INTO scheduling_cert_refs(key,id) VALUES ('future',v_created);

  INSERT INTO public.publication_jobs(id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,execution_mode)
  VALUES
    ('11111111-1111-4111-8111-111111111301',v_profile,v_due_variant,'FACEBOOK','SCHEDULED',v_now-interval '1 minute','sched-cert-due',0,'DEMO_SIMULATION'),
    ('11111111-1111-4111-8111-111111111302',v_profile,v_exact_variant,'FACEBOOK','SCHEDULED',clock_timestamp(),'sched-cert-exact',0,'DEMO_SIMULATION'),
    ('11111111-1111-4111-8111-111111111303',v_profile,v_past_variant,'FACEBOOK','SCHEDULED',v_now-interval '2 seconds','sched-cert-past',0,'DEMO_SIMULATION');

  BEGIN
    INSERT INTO public.publication_jobs(id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,execution_mode)
    VALUES ('11111111-1111-4111-8111-111111111304',v_profile,v_pending_variant,'FACEBOOK','SCHEDULED',v_now-interval '1 minute','sched-cert-pending-illegal',0,'DEMO_SIMULATION');
    RAISE EXCEPTION 'SCHEDULING_PENDING_GUARD_MISSING';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM='SCHEDULING_PENDING_GUARD_MISSING' OR position('publication variant must match approved QA fingerprint' in SQLERRM)=0 THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.publication_jobs(id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,execution_mode)
    VALUES ('11111111-1111-4111-8111-111111111305',v_profile,v_rejected_variant,'FACEBOOK','SCHEDULED',v_now-interval '1 minute','sched-cert-rejected-illegal',0,'DEMO_SIMULATION');
    RAISE EXCEPTION 'SCHEDULING_REJECTED_GUARD_MISSING';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM='SCHEDULING_REJECTED_GUARD_MISSING' OR position('publication variant must match approved QA fingerprint' in SQLERRM)=0 THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.publication_jobs(id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,execution_mode)
  VALUES
    ('11111111-1111-4111-8111-111111111304',v_profile,v_pending_variant,'FACEBOOK','BLOCKED_APPROVAL',v_now-interval '1 minute','sched-cert-pending',0,'DEMO_SIMULATION'),
    ('11111111-1111-4111-8111-111111111305',v_profile,v_rejected_variant,'FACEBOOK','BLOCKED_APPROVAL',v_now-interval '1 minute','sched-cert-rejected',0,'DEMO_SIMULATION'),
    ('11111111-1111-4111-8111-111111111306',v_profile,v_completed_variant,'FACEBOOK','PUBLISHED',v_now-interval '5 minutes','sched-cert-completed',1,'DEMO_SIMULATION');

  INSERT INTO public.publication_jobs(
    id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,
    execution_mode,claim_token,locked_at,lease_expires_at
  ) VALUES (
    '11111111-1111-4111-8111-111111111307',v_profile,v_processing_variant,'FACEBOOK','PROCESSING',
    v_now-interval '1 minute','sched-cert-processing',1,'DEMO_SIMULATION',
    '22222222-2222-4222-8222-222222222222',v_now,v_now+interval '10 minutes'
  );
  INSERT INTO public.publication_attempts(job_id,attempt_no,state,claim_token,response_metadata,started_at)
  VALUES ('11111111-1111-4111-8111-111111111307',1,'CLAIMED','22222222-2222-4222-8222-222222222222','{}'::jsonb,v_now);

  INSERT INTO public.publication_jobs(id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,execution_mode)
  VALUES ('11111111-1111-4111-8111-111111111308',v_profile,v_cancelled_variant,'FACEBOOK','SCHEDULED',v_now+interval '2 days','sched-cert-cancelled',0,'DEMO_SIMULATION')
  RETURNING updated_at INTO v_cancel_updated;

  SELECT removed INTO v_removed
  FROM public.manage_profile_calendar_job(
    'scheduling-cert-user',v_profile,'11111111-1111-4111-8111-111111111308',
    v_cancel_updated,'REMOVE',NULL
  );
  IF v_removed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SCHEDULING_CANCEL_REMOVE_FAILED';
  END IF;

  INSERT INTO public.publication_jobs(id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,execution_mode)
  VALUES ('11111111-1111-4111-8111-111111111309',v_profile,v_invalidated_variant,'FACEBOOK','SCHEDULED',v_now+interval '3 days','sched-cert-invalidated',0,'DEMO_SIMULATION');

  UPDATE public.content_variants
  SET approval_status='PENDING',workflow_status='REVIEW',approved_by=NULL,approved_at=NULL,approved_fingerprint=NULL
  WHERE id=v_invalidated_variant;

  IF (SELECT state FROM public.publication_jobs WHERE id='11111111-1111-4111-8111-111111111309') <> 'BLOCKED_APPROVAL' THEN
    RAISE EXCEPTION 'SCHEDULING_APPROVAL_INVALIDATION_SYNC_FAILED';
  END IF;
END
$setup$;

CREATE TEMP TABLE scheduling_claim_first AS
SELECT * FROM public.claim_due_publication_jobs(50,600);

CREATE TEMP TABLE scheduling_claim_second AS
SELECT * FROM public.claim_due_publication_jobs(50,600);

DO $assertions$
DECLARE
  v_profile constant uuid := '11111111-1111-4111-8111-111111111100';
  v_function text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='publication_jobs'
      AND column_name='scheduled_at' AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'SCHEDULING_TIMESTAMP_TYPE_INVALID';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE profile_id=v_profile AND provider='FACEBOOK' AND timezone='Europe/Rome'
  ) THEN
    RAISE EXCEPTION 'SCHEDULING_TIMEZONE_NOT_PERSISTED';
  END IF;

  IF ('2026-07-01 10:00'::timestamp AT TIME ZONE 'Europe/Rome') <> '2026-07-01 08:00+00'::timestamptz
     OR ('2026-12-01 10:00'::timestamp AT TIME ZONE 'Europe/Rome') <> '2026-12-01 09:00+00'::timestamptz THEN
    RAISE EXCEPTION 'SCHEDULING_TIMEZONE_CONVERSION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM scheduling_claim_first
    WHERE job_id=(SELECT id FROM scheduling_cert_refs WHERE key='future')
  ) OR NOT EXISTS (
    SELECT 1 FROM public.publication_jobs
    WHERE id=(SELECT id FROM scheduling_cert_refs WHERE key='future')
      AND state='SCHEDULED' AND attempt_count=0
  ) THEN
    RAISE EXCEPTION 'FUTURE_JOB_NOT_DUE_FAILED';
  END IF;

  IF (SELECT count(*) FROM scheduling_claim_first WHERE job_id IN (
    '11111111-1111-4111-8111-111111111301',
    '11111111-1111-4111-8111-111111111302',
    '11111111-1111-4111-8111-111111111303'
  )) <> 3 THEN
    RAISE EXCEPTION 'DUE_JOB_SELECTED_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM scheduling_claim_first
    WHERE job_id IN (
      '11111111-1111-4111-8111-111111111304',
      '11111111-1111-4111-8111-111111111305',
      '11111111-1111-4111-8111-111111111306',
      '11111111-1111-4111-8111-111111111307',
      '11111111-1111-4111-8111-111111111309'
    )
  ) THEN
    RAISE EXCEPTION 'SCHEDULING_EXCLUSION_FAILED';
  END IF;

  IF (SELECT state FROM public.publication_jobs WHERE id='11111111-1111-4111-8111-111111111304') <> 'BLOCKED_APPROVAL' THEN
    RAISE EXCEPTION 'PENDING_APPROVAL_NOT_ELIGIBLE_FAILED';
  END IF;
  IF (SELECT state FROM public.publication_jobs WHERE id='11111111-1111-4111-8111-111111111305') <> 'BLOCKED_APPROVAL' THEN
    RAISE EXCEPTION 'REJECTED_JOB_NOT_ELIGIBLE_FAILED';
  END IF;
  IF EXISTS (SELECT 1 FROM public.publication_jobs WHERE id='11111111-1111-4111-8111-111111111308') THEN
    RAISE EXCEPTION 'CANCELLED_JOB_NOT_ELIGIBLE_FAILED';
  END IF;
  IF (SELECT state FROM public.publication_jobs WHERE id='11111111-1111-4111-8111-111111111306') <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'COMPLETED_JOB_NOT_RESELECTED_FAILED';
  END IF;
  IF (SELECT state FROM public.publication_jobs WHERE id='11111111-1111-4111-8111-111111111307') <> 'PROCESSING' THEN
    RAISE EXCEPTION 'ALREADY_CLAIMED_RESELECTED';
  END IF;

  IF EXISTS (SELECT 1 FROM scheduling_claim_second) THEN
    RAISE EXCEPTION 'SCHEDULER_IDEMPOTENCY_FAILED';
  END IF;

  IF EXISTS (
    SELECT job_id FROM public.publication_attempts
    WHERE job_id IN (
      '11111111-1111-4111-8111-111111111301',
      '11111111-1111-4111-8111-111111111302',
      '11111111-1111-4111-8111-111111111303'
    )
    GROUP BY job_id HAVING count(*)<>1
  ) OR (
    SELECT count(*) FROM public.publication_attempts
    WHERE job_id IN (
      '11111111-1111-4111-8111-111111111301',
      '11111111-1111-4111-8111-111111111302',
      '11111111-1111-4111-8111-111111111303'
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'SCHEDULER_ATTEMPT_DUPLICATION';
  END IF;

  SELECT pg_get_functiondef('public.claim_due_publication_jobs(integer,integer)'::regprocedure)
  INTO v_function;
  IF position('FOR UPDATE SKIP LOCKED' in upper(v_function))=0
     OR position('GEN_RANDOM_UUID()' in upper(v_function))=0
     OR position('PROCESSING' in upper(v_function))=0 THEN
    RAISE EXCEPTION 'CONCURRENT_CLAIM_PROTECTION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='publication_jobs' AND indexname='publication_jobs_due_idx'
  ) THEN
    RAISE EXCEPTION 'SCHEDULING_DUE_INDEX_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.publication_jobs
    WHERE id=(SELECT id FROM scheduling_cert_refs WHERE key='future')
      AND scheduled_at>clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'SCHEDULING_DB_PERSISTENCE_FAILED';
  END IF;
END
$assertions$;

SELECT 'FUTURE_JOB_NOT_DUE' AS test,'PASS' AS result
UNION ALL SELECT 'DUE_JOB_SELECTED','PASS'
UNION ALL SELECT 'PENDING_APPROVAL_NOT_ELIGIBLE','PASS'
UNION ALL SELECT 'REJECTED_JOB_NOT_ELIGIBLE','PASS'
UNION ALL SELECT 'CANCELLED_JOB_NOT_ELIGIBLE','PASS'
UNION ALL SELECT 'COMPLETED_JOB_NOT_RESELECTED','PASS'
UNION ALL SELECT 'SCHEDULER_IDEMPOTENCY','PASS'
UNION ALL SELECT 'CONCURRENT_CLAIM_PROTECTION','PASS'
UNION ALL SELECT 'TIMEZONE_CORRECTNESS','PASS'
UNION ALL SELECT 'DB_PERSISTENCE_RECOVERY','PASS';
