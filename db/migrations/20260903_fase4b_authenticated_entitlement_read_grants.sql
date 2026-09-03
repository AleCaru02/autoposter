-- FASE 4B corrective migration: authenticated may read its own tenant-scoped entitlement/usage rows through existing RLS policies.
-- No write or function execute privileges are granted here.

GRANT SELECT ON TABLE public.profile_entitlements TO authenticated;
GRANT SELECT ON TABLE public.capability_usage_events TO authenticated;
GRANT SELECT ON TABLE public.capability_usage_buckets TO authenticated;
