-- Personal-first package for a real CUSTOMER tenant.
-- This is a normal finite entitlement package: no identity special-case, no RLS
-- bypass, no usage bypass, and the provider-cost hard cap remains enforced.

BEGIN;

INSERT INTO public.entitlement_packages(
  package_key, version, lifecycle, hard_monthly_provider_cost_cap_usd, metadata
) VALUES (
  'personal_operator', 1, 'ACTIVE', 5,
  '{"purpose":"PERSONAL_FIRST_REAL_TENANT","commercialSale":false,"finiteLimits":true}'::jsonb
)
ON CONFLICT (package_key, version) DO UPDATE SET
  lifecycle='ACTIVE',
  hard_monthly_provider_cost_cap_usd=EXCLUDED.hard_monthly_provider_cost_cap_usd,
  metadata=EXCLUDED.metadata;

WITH personal_capabilities(
  capability_key, enabled, limit_type, limit_value, period_type, provider_attempt_reserve_usd
) AS (
  VALUES
    ('workspace.profile.manage',true,'CONCURRENT',100::numeric,'MONTH',0.01::numeric),
    ('website.scan',true,'COUNT_PER_MONTH',50,'MONTH',0.01),
    ('website.pages.persist',true,'STORAGE',5000,'MONTH',0.01),
    ('brand.analyze',true,'COUNT_PER_MONTH',20,'MONTH',0.25),
    ('ai.content.generate_text',true,'COUNT_PER_MONTH',200,'MONTH',0.10),
    ('ai.research.web',true,'COUNT_PER_MONTH',100,'MONTH',0.05),
    ('ai.research.factcheck',true,'COUNT_PER_MONTH',100,'MONTH',0.05),
    ('ai.strategy.generate',true,'COUNT_PER_MONTH',50,'MONTH',0.10),
    ('ai.image.generate',true,'COUNT_PER_MONTH',100,'MONTH',0.25),
    ('media.image.persist',true,'STORAGE',2000,'MONTH',0.01),
    ('content.approval.auto',true,'BOOLEAN',1,'MONTH',0.01),
    ('autopilot.manage',true,'BOOLEAN',1,'MONTH',0.01),
    ('autopilot.hourly',true,'COUNT_PER_DAY',24,'DAY',0.01),
    ('schedule.job.create',true,'COUNT_PER_MONTH',1000,'MONTH',0.01),
    ('social.facebook.connect',true,'MAX_CONNECTED_ACCOUNTS',5,'MONTH',0.01),
    ('social.instagram.connect',true,'MAX_CONNECTED_ACCOUNTS',5,'MONTH',0.01),
    ('social.linkedin.connect',true,'MAX_CONNECTED_ACCOUNTS',5,'MONTH',0.01),
    ('social.gbp.connect',true,'MAX_CONNECTED_ACCOUNTS',5,'MONTH',0.01),
    ('social.facebook.publish',true,'COUNT_PER_MONTH',1000,'MONTH',0.01),
    ('social.instagram.publish',true,'COUNT_PER_MONTH',1000,'MONTH',0.01),
    ('social.linkedin.publish',true,'COUNT_PER_MONTH',1000,'MONTH',0.01),
    ('social.gbp.publish',true,'COUNT_PER_MONTH',1000,'MONTH',0.01),
    ('social.publish.scheduled',true,'BOOLEAN',1,'MONTH',0.01)
)
INSERT INTO public.entitlement_package_capabilities(
  package_key, package_version, capability_key, enabled, limit_type, limit_value,
  period_type, provider_attempt_reserve_usd, metadata
)
SELECT
  'personal_operator', 1, capability_key, enabled, limit_type, limit_value,
  period_type, provider_attempt_reserve_usd,
  '{"personalFirst":true,"finiteLimits":true}'::jsonb
FROM personal_capabilities
ON CONFLICT (package_key, package_version, capability_key) DO UPDATE SET
  enabled=EXCLUDED.enabled,
  limit_type=EXCLUDED.limit_type,
  limit_value=EXCLUDED.limit_value,
  period_type=EXCLUDED.period_type,
  provider_attempt_reserve_usd=EXCLUDED.provider_attempt_reserve_usd,
  metadata=EXCLUDED.metadata;

COMMIT;
