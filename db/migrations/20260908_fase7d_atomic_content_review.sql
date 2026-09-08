-- FASE 7D — atomic, server-owned content review transition.
-- The function locks one profile-scoped variant, rejects stale edits, updates
-- its parent aggregate status in the same transaction and lets the existing
-- calendar trigger synchronize blocked/scheduled jobs.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_customer_content_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND NEW.approval_status IS DISTINCT FROM OLD.approval_status
     AND NEW.approval_status IN ('APPROVED', 'CHANGES_REQUESTED') THEN
    RAISE EXCEPTION 'CONTENT_APPROVAL_SERVER_ONLY' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_variants_approval_guard ON public.content_variants;
CREATE TRIGGER content_variants_approval_guard
BEFORE UPDATE OF approval_status ON public.content_variants
FOR EACH ROW
EXECUTE FUNCTION public.guard_customer_content_approval();

CREATE OR REPLACE FUNCTION public.review_content_variant(
  p_actor_auth_user_id text,
  p_profile_id uuid,
  p_content_id uuid,
  p_variant_id uuid,
  p_expected_updated_at timestamptz,
  p_hook text,
  p_caption text,
  p_cta text,
  p_hashtags jsonb,
  p_visual_brief text,
  p_alt_text text,
  p_approval_status text
)
RETURNS TABLE(variant_id uuid, approval_status text, content_status text, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_variant public.content_variants%ROWTYPE;
  v_content_status text;
  v_updated_at timestamptz := clock_timestamp();
BEGIN
  IF p_actor_auth_user_id IS NULL OR btrim(p_actor_auth_user_id) = '' THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_approval_status NOT IN ('PENDING', 'APPROVED', 'CHANGES_REQUESTED')
     OR coalesce(btrim(p_caption), '') = ''
     OR jsonb_typeof(coalesce(p_hashtags, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    JOIN neon_auth.user auth_user
      ON auth_user.id::text = p_actor_auth_user_id
     AND coalesce(auth_user.banned, false) IS FALSE
    WHERE profile.id = p_profile_id
      AND profile.owner_auth_user_id = p_actor_auth_user_id
      AND profile.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT variant.* INTO v_variant
  FROM public.content_variants variant
  WHERE variant.id = p_variant_id
    AND variant.content_id = p_content_id
    AND variant.profile_id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_variant.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_STALE' USING ERRCODE = '40001';
  END IF;

  UPDATE public.content_variants variant
  SET hook = nullif(btrim(p_hook), ''),
      caption = btrim(p_caption),
      cta = nullif(btrim(p_cta), ''),
      hashtags = p_hashtags,
      visual_brief = nullif(btrim(p_visual_brief), ''),
      alt_text = nullif(btrim(p_alt_text), ''),
      approval_status = p_approval_status,
      updated_at = v_updated_at
  WHERE variant.id = p_variant_id;

  SELECT CASE
    WHEN bool_and(variant.approval_status = 'APPROVED') THEN 'APPROVED'
    WHEN bool_or(variant.approval_status = 'CHANGES_REQUESTED') THEN 'CHANGES_REQUESTED'
    ELSE 'IN_REVIEW'
  END INTO v_content_status
  FROM public.content_variants variant
  WHERE variant.content_id = p_content_id
    AND variant.profile_id = p_profile_id;

  UPDATE public.content_items item
  SET status = v_content_status, updated_at = v_updated_at
  WHERE item.id = p_content_id
    AND item.profile_id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTENT_REVIEW_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY SELECT p_variant_id, p_approval_status, v_content_status, v_updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.review_content_variant(text,uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text,text)
  FROM PUBLIC, authenticated;

COMMIT;
