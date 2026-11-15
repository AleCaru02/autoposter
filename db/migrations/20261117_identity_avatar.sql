-- Post Automatici — personal-brand avatar foundation (additive, backward compatible).
-- * identity_consents: explicit, revocable consent of the person whose face/voice is used.
-- * identity_assets: private photo/video/voice materials, one set per profile, with retention.
-- * avatar_setups: provider choice and face/voice configuration state per profile.
-- * Capabilities avatar.identity.setup and video.avatar.render, metered like the Reel engine.
-- Biometric files live ONLY in a private object store; rows hold the private pathname, never
-- a public URL. Browser clients can read their own rows; every write goes through server code.

BEGIN;

CREATE TABLE IF NOT EXISTS public.identity_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject_name text NOT NULL,
  scopes text[] NOT NULL,
  provider text NULL,
  consent_version text NOT NULL,
  consent_text_sha256 text NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL,
  revoked_by text NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT identity_consents_scopes_check CHECK (scopes <@ ARRAY['FACE','VOICE']::text[] AND cardinality(scopes) BETWEEN 1 AND 2),
  CONSTRAINT identity_consents_subject_check CHECK (length(trim(subject_name)) BETWEEN 2 AND 120),
  CONSTRAINT identity_consents_provider_check CHECK (provider IS NULL OR provider IN ('HEYGEN','HIGGSFIELD_INTONE'))
);
-- At most one active consent per profile (a new consent requires revoking the previous one).
CREATE UNIQUE INDEX IF NOT EXISTS identity_consents_one_active ON public.identity_consents(profile_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.identity_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  consent_id uuid NOT NULL REFERENCES public.identity_consents(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  pathname text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NULL,
  duration_seconds numeric(10,2) NULL,
  media jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING_UPLOAD',
  rejection_reason text NULL,
  retention_until timestamptz NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CONSTRAINT identity_assets_kind_check CHECK (kind IN ('PHOTO','VIDEO','VOICE')),
  CONSTRAINT identity_assets_status_check CHECK (status IN ('PENDING_UPLOAD','READY','REJECTED','DELETED')),
  CONSTRAINT identity_assets_pathname_unique UNIQUE (pathname),
  CONSTRAINT identity_assets_pathname_scope CHECK (pathname LIKE 'identity/' || profile_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS identity_assets_profile_idx ON public.identity_assets(profile_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS public.avatar_setups (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'HEYGEN',
  face_status text NOT NULL DEFAULT 'NOT_STARTED',
  voice_status text NOT NULL DEFAULT 'NOT_STARTED',
  provider_avatar_id text NULL,
  provider_voice_id text NULL,
  last_error_code text NULL,
  last_preview_job_id uuid NULL REFERENCES public.render_jobs(id) ON DELETE SET NULL,
  cost_usd numeric(12,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT avatar_setups_provider_check CHECK (provider IN ('HEYGEN','HIGGSFIELD_INTONE')),
  CONSTRAINT avatar_setups_face_check CHECK (face_status IN ('NOT_STARTED','MATERIALS_READY','SUBMITTED','TRAINING','READY','FAILED','REVOKED')),
  CONSTRAINT avatar_setups_voice_check CHECK (voice_status IN ('NOT_STARTED','MATERIALS_READY','SUBMITTED','TRAINING','READY','FAILED','REVOKED')),
  CONSTRAINT avatar_setups_cost_check CHECK (cost_usd >= 0)
);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['identity_consents','identity_assets','avatar_setups'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS require_authenticated_identity ON public.%I', t);
    EXECUTE format('CREATE POLICY require_authenticated_identity ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (((select auth.user_id()) IS NOT NULL)) WITH CHECK (((select auth.user_id()) IS NOT NULL))', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_owner_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.owns_profile(profile_id))', t || '_owner_read', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, authenticated', t);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
  END LOOP;
END
$rls$;

-- Avatar Reels use the existing render pipeline with their own kind.
ALTER TABLE public.render_jobs DROP CONSTRAINT IF EXISTS render_jobs_step_check;
ALTER TABLE public.render_jobs ADD CONSTRAINT render_jobs_step_check CHECK (step IN ('SCRIPT','VISUALS','VOICE','AVATAR','RENDER','QA','DONE'));

-- Metered capabilities (personal package enabled, commercial disabled).
INSERT INTO public.entitlement_package_capabilities(
  package_key,package_version,capability_key,enabled,limit_type,limit_value,period_type,provider_attempt_reserve_usd,metadata
) VALUES
  ('personal_operator',1,'avatar.identity.setup',true,'COUNT_PER_MONTH',4,'MONTH',0.01,'{"block":"AVATAR","personalFirst":true}'::jsonb),
  ('personal_operator',1,'video.avatar.render',true,'COUNT_PER_MONTH',60,'MONTH',3.50,'{"block":"AVATAR","personalFirst":true}'::jsonb),
  ('commercial_guarded',1,'avatar.identity.setup',false,'COUNT_PER_MONTH',NULL,'NONE',NULL,'{"block":"AVATAR","commercialNotReady":true}'::jsonb),
  ('commercial_guarded',1,'video.avatar.render',false,'COUNT_PER_MONTH',NULL,'NONE',NULL,'{"block":"AVATAR","commercialNotReady":true}'::jsonb)
ON CONFLICT (package_key,package_version,capability_key) DO UPDATE SET
  enabled=EXCLUDED.enabled, limit_type=EXCLUDED.limit_type, limit_value=EXCLUDED.limit_value,
  period_type=EXCLUDED.period_type, provider_attempt_reserve_usd=EXCLUDED.provider_attempt_reserve_usd, metadata=EXCLUDED.metadata;

INSERT INTO public.profile_entitlements(profile_id,capability_key,enabled,limit_type,limit_value,period_type,source,metadata)
SELECT assignment.profile_id,cap.capability_key,cap.enabled,cap.limit_type,cap.limit_value,cap.period_type,
       'PACKAGE:'||assignment.package_key||':v'||assignment.package_version::text,
       jsonb_build_object('package_key',assignment.package_key,'package_version',assignment.package_version,
                          'package_assignment_id',assignment.id,'provider_attempt_reserve_usd',cap.provider_attempt_reserve_usd)
FROM public.profile_entitlement_package_assignments assignment
JOIN public.entitlement_package_capabilities cap
  ON cap.package_key=assignment.package_key AND cap.package_version=assignment.package_version
 AND cap.capability_key IN ('avatar.identity.setup','video.avatar.render')
WHERE assignment.revoked_at IS NULL
ON CONFLICT (profile_id,capability_key) DO UPDATE SET
  enabled=EXCLUDED.enabled, limit_type=EXCLUDED.limit_type, limit_value=EXCLUDED.limit_value,
  period_type=EXCLUDED.period_type, source=EXCLUDED.source, metadata=EXCLUDED.metadata, updated_at=now();

COMMIT;
