# FASE 5B — onboarding completion integrity

The completion flag is a server-owned state transition. Customer RLS still
allows ordinary profile edits, but a database trigger rejects direct changes to
`onboarding_completed` from the authenticated role.

`complete_onboarding_profile` locks and validates the owned profile, rejects
banned or cross-tenant actors, and supports two explicit modes:

- `NO_WEBSITE`: allowed only while the profile has no website;
- `BRAND_ANALYZED`: allowed only after a persisted brand profile exists.

The no-website UI calls an authenticated server endpoint. Brand analysis commits
its logical metering event before completion. A cached idempotent replay also
runs the completion transition, repairing the narrow case where metering was
committed but the final state transition failed. Repeated completion is a no-op
and produces only one audit event.
