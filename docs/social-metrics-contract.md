# Social metrics contract — Post Automatici

Verified on 2026-08-29 against current provider documentation.

## Rules

- Metrics are never fabricated or inferred from publishing success.
- A provider is metrics-ready only when the connection is ACTIVE, an account is selected, and analytics-specific permissions are actually granted.
- Provider payload values must be numeric before they can become metric points.
- Metrics stay scoped to the owning profile and published external post identifier when available.

## Provider requirements

### Instagram
Requires the connected professional account plus `instagram_basic`, `pages_read_engagement`, and `instagram_manage_insights` for insights. Publishing permission alone is not sufficient.

### Facebook
Uses Page/post engagement data only when the Page connection is active and `pages_read_engagement` is granted.

### LinkedIn
Personal post analytics requires `r_member_postAnalytics`. Organization reporting requires organization reporting access such as `rw_organization_admin`; publishing permissions do not imply analytics permission. Organic organization statistics exclude sponsored activity.

### Google Business Profile
Uses the Business Profile Performance API v1. The existing `business.manage` OAuth scope is necessary but the Performance API must also be enabled in the Google Cloud project. Legacy reportInsights endpoints are not treated as the current source.

## Persistence status

The runtime collector/persistence step remains blocked until the production `metric_snapshots` schema can be introspected reliably. The Neon connector currently exposes incompatible argument names between its client schema and backend validator, so no database column contract is guessed.
