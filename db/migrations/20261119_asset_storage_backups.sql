-- Images stored as multi-MB data URLs in public.assets drained the Neon transfer quota.
-- They move to Vercel Blob; the ORIGINAL value is kept here until the owner approves deletion.
-- Server-only table (no browser access). Rollback of one asset:
--   update public.assets a set storage_url=b.original_storage_url, updated_at=now()
--   from public.asset_storage_backups b where a.id=b.asset_id and a.id='<asset id>';
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS public.asset_storage_backups (
  asset_id uuid PRIMARY KEY,
  profile_id uuid NOT NULL,
  original_storage_url text NOT NULL,
  original_sha256 text NOT NULL,
  blob_url text,
  blob_pathname text,
  verified_at timestamptz,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.asset_storage_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_storage_backups FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.asset_storage_backups FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anonymous') THEN
    REVOKE ALL ON public.asset_storage_backups FROM anonymous;
  END IF;
END
$$;
