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

## Runtime pipeline

- The hourly Cloudflare cron claims eligible published posts with `FOR UPDATE SKIP LOCKED`.
- Posts younger than seven days are refreshed at most every six hours; older posts are refreshed daily and stop after thirty days.
- Each post/hour has one snapshot. Concurrent cron executions and retries update that bucket instead of duplicating it.
- Provider 429 and temporary failures use bounded exponential backoff. Revoked/expired access and deleted remote posts enter terminal states without deleting older snapshots.
- Provider tokens stay in encrypted server storage and are sent in authorization headers, never query strings or customer responses.

## Normalized metric matrix

| Provider | Provider source | Normalized metrics |
|---|---|---|
| Instagram | Graph media fields + media insights | `likes`, `comments`, `views`, `reach`, `saves`, `shares`, `engagement` |
| Facebook | Graph post fields + post insights | `reactions`, `comments`, `shares`, `impressions`, `reach`, `engagement`, `clicks` |
| LinkedIn member | Member Creator Post Analytics; owned-post social actions as a partial fallback | `impressions`, `reach`, `clicks`, `engagement_rate`, `likes`, `comments`, `shares`, `reactions`, `saves` when returned |
| LinkedIn organization | Organizational Entity Share Statistics | `impressions`, `reach`, `clicks`, `engagement_rate`, `likes`, `comments`, `shares`, `reactions` when returned |
| Google Business Profile | Performance API v1 | Blocked externally until API access/quota is enabled |

`impressions`, `reach`, `views`, clicks and interactions remain separate fields. Unknown numeric provider metrics are preserved under their provider key instead of being coerced into a different meaning.
