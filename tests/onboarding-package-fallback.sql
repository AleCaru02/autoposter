\set ON_ERROR_STOP on
BEGIN;
DO $regression$
DECLARE
  v_actor text := 'qa-onboarding-' || gen_random_uuid()::text;
  v_override_actor text := 'qa-onboarding-override-' || gen_random_uuid()::text;
  v_operation uuid := gen_random_uuid();
  v_profile uuid;
  v_replayed uuid;
  v_override uuid;
  v_override_key text;
  v_override_version integer;
BEGIN
  INSERT INTO neon_auth."user"(id,email,name,role,banned)
  VALUES (v_actor,v_actor || '@example.invalid','Onboarding regression','user',false),
         (v_override_actor,v_override_actor || '@example.invalid','Onboarding override regression','user',false);

  SELECT id INTO v_profile FROM public.provision_onboarding_profile(
    v_actor,v_operation,repeat('a',64),'QA first profile','qa-first-' || v_operation::text,
    NULL,'QA','BUSINESS');
  IF v_profile IS NULL THEN RAISE EXCEPTION 'FIRST_PROFILE_NOT_CREATED'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_entitlement_package_assignments
    WHERE profile_id=v_profile AND package_key='commercial_guarded' AND package_version=1
      AND source='ONBOARDING_SERVER' AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'DEFAULT_PACKAGE_FALLBACK_MISSING'; END IF;

  SELECT id INTO v_replayed FROM public.provision_onboarding_profile(
    v_actor,v_operation,repeat('a',64),'QA first profile','qa-first-' || v_operation::text,
    NULL,'QA','BUSINESS');
  IF v_replayed IS DISTINCT FROM v_profile THEN RAISE EXCEPTION 'PROVISION_REPLAY_NOT_IDEMPOTENT'; END IF;
  BEGIN
    PERFORM public.provision_onboarding_profile(
      v_actor,v_operation,repeat('b',64),'QA changed request','qa-first-' || v_operation::text,
      NULL,'QA','BUSINESS');
    RAISE EXCEPTION 'PROVISION_CONFLICT_NOT_REJECTED';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF position('ONBOARDING_IDEMPOTENCY_CONFLICT' IN SQLERRM)=0 THEN RAISE; END IF;
  END;

  SELECT package_key,version INTO v_override_key,v_override_version
  FROM public.entitlement_packages
  WHERE lifecycle='ACTIVE' AND package_key<>'commercial_guarded'
  ORDER BY package_key,version DESC LIMIT 1;
  IF v_override_key IS NULL THEN RAISE EXCEPTION 'OVERRIDE_TEST_PACKAGE_MISSING'; END IF;
  INSERT INTO public.user_provisioning_package_defaults(auth_user_id,package_key,package_version)
  VALUES(v_override_actor,v_override_key,v_override_version);
  SELECT id INTO v_override FROM public.provision_onboarding_profile(
    v_override_actor,gen_random_uuid(),repeat('c',64),'QA explicit default','qa-override-' || v_operation::text,
    NULL,'QA','PERSONAL_BRAND');
  IF NOT EXISTS (
    SELECT 1 FROM public.profile_entitlement_package_assignments
    WHERE profile_id=v_override AND package_key=v_override_key AND package_version=v_override_version
      AND source='ONBOARDING_USER_DEFAULT' AND revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'USER_PACKAGE_DEFAULT_LOST'; END IF;
  IF has_function_privilege('authenticated','public.provision_onboarding_profile(text,uuid,text,text,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'PROVISION_FUNCTION_MUST_STAY_SERVER_ONLY';
  END IF;
END;
$regression$;
ROLLBACK;
SELECT 'ONBOARDING_PACKAGE_FALLBACK_PASS' AS result;
