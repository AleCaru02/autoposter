-- Social connections are written only by the server (OAuth callback, account selection, verify,
-- disconnect, token refresh) through the database owner role.
-- Browsers keep read access to safe metadata, but:
--   * can never read token_reference (encrypted provider tokens stay server-side);
--   * can never insert/update/delete rows, so a client cannot forge status='ACTIVE' or a fresh
--     last_validated_at and make an unverified provider look "connected".
-- RLS policies are unchanged; this only narrows table/column privileges. Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.social_connections FROM authenticated;
    REVOKE SELECT ON public.social_connections FROM authenticated;
    GRANT SELECT (id, profile_id, provider, status, provider_account_id, account_name, permissions, expires_at, metadata, last_validated_at, created_at, updated_at)
      ON public.social_connections TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anonymous') THEN
    REVOKE ALL ON public.social_connections FROM anonymous;
  END IF;
  -- Same integrity rule for server-owned ledgers: the browser only reads them. Without this a
  -- client could delete ai_usage_events to bypass AI budget caps, rewrite publication outcomes
  -- or tamper with the audit log. All writers are server code using the owner role or
  -- SECURITY DEFINER functions, which are unaffected.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.publication_jobs, public.publication_attempts, public.ai_usage_events, public.audit_log FROM authenticated;
  END IF;
END
$$;
