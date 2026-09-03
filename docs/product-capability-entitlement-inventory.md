# FASE 4A — Product Capability + Cost + Entitlement Inventory

Status: canonical inventory draft for Post Automatici at production commit `071a72fe7fd51d82db45879f342b7a3c1fe2ac82`.
Verified: 2026-09-03.

This document is the FASE 4 source of truth for capability status, cost drivers, usage metering, entitlement candidates, sellability, and gaps. It does **not** define pricing plans or billing. FASE 3 remains PASS and is not reopened by this inventory.

## Classification rules

Capability status is exactly one of `LIVE_VERIFIED`, `LIVE_NOT_RUNTIME_VERIFIED`, `PARTIAL`, `SCAFFOLD_ONLY`, `PLANNED`, `DEPRECATED`.

Entitlement classification is one of `CORE_ALL_PLANS`, `PLAN_GATED`, `USAGE_LIMITED`, `ADMIN_ONLY`, `INTERNAL`, `NOT_READY`.

Usage status is one of `METERED`, `DERIVABLE`, `NOT_METERED`, `N/A`.

`LIVE_VERIFIED` is intentionally conservative: it requires existing runtime evidence or an already certified production capability. A page or button alone is never treated as evidence that an external integration works.

## Product boundary and commercial unit

The current tenant/service unit is the **profile/activity** (`profiles.id`), not the login user. Brand, website, content, social connections, schedules, publication jobs, metrics, learning and AI usage are scoped by `profile_id`; ownership is represented by `profile_members`. A user can own multiple isolated profiles. Future entitlements should therefore attach to the profile/workspace service unit. A future commercial account grouping multiple profiles may be added later without moving capability enforcement to the login identity.

Evidence: `DATABASE.md`, `src/App.tsx`, `src/features/profiles/profile-context.tsx`, tenant/RLS regressions and FASE 3 runtime certification.

## Frontend route inventory

Customer/auth routes in production:

- `/login`, `/registrazione`, `/password-dimenticata`, `/reimposta-password`
- `/onboarding`
- `/app/dashboard`
- `/app/profili`
- `/app/brand`
- `/app/sito`
- `/app/contenuti`
- `/app/approvazioni`
- `/app/calendario`
- `/app/social`
- `/app/analytics`
- `/app/apprendimento`
- `/app/impostazioni`

SUPER_ADMIN is under `/admin/*` and includes customer administration, Audit Viewer, Session Management, Ban/Unban and impersonation.

Evidence: `src/App.tsx`, `src/pages/admin-pages.tsx`.

## Database inventory

Canonical application tables documented/used by production code:

`app_users`, `profiles`, `profile_members`, `brand_profiles`, `website_scans`, `website_pages`, `content_strategies`, `assets`, `content_items`, `content_variants`, `social_connections`, `schedules`, `publication_jobs`, `publication_attempts`, `metric_snapshots`, `learning_insights`, `ai_usage_events`, `audit_log`.

Important current storage fact: generated images linked to variants are persisted as a `data:` URL in `assets.storage_url` with `storage_mode = DATABASE_DATA_URL_V1`. There is currently no external object-storage provider in the production generation path. This is functional but is a scaling/cost gap.

Evidence: `DATABASE.md`, `api/generate-image.ts`.

## Scheduled/background execution

Cloudflare Worker has two cron triggers:

- `*/5 * * * *` → `processDuePublications()` for due social publication jobs.
- `0 * * * *` → `runContentAutopilotSerialized()` for automatic content generation/planning.

Manual profile-scoped autopilot can also be accepted by `POST /api/autopilot/run`.

Evidence: `wrangler.jsonc`, `cloudflare/entry.ts`.

# Capability catalog

| Capability | Key | Area | Status | Frontend / backend evidence | DB / provider / job dependency | Natural usage | Entitlement |
|---|---|---|---|---|---|---|---|
| Email signup | `auth.email.signup` | Auth | LIVE_VERIFIED | `/registrazione`; Managed Auth boundary already certified | Neon Managed Auth | accounts created | CORE_ALL_PLANS |
| Email login/logout/session | `auth.session.manage` | Auth | LIVE_VERIFIED | `/login`; same-origin Managed Auth; FASE 3 runtime | Neon Managed Auth | sessions | CORE_ALL_PLANS |
| Google sign-in | `auth.google.signin` | Auth | LIVE_NOT_RUNTIME_VERIFIED | `authClient.signIn.social({provider:"google"})` exists | Neon Auth Google provider/config | sign-ins | CORE_ALL_PLANS |
| Password reset | `auth.password.reset` | Auth | LIVE_VERIFIED | forgot/reset UI and non-enumerating behavior covered by security work | Neon Managed Auth email | reset requests | CORE_ALL_PLANS |
| Multiple isolated activities | `workspace.profile.manage` | Workspace | LIVE_VERIFIED | profile routes + tenant runtime/RLS; production baseline 20 | `profiles`, `profile_members` | active profiles | USAGE_LIMITED |
| Profile settings/timezone | `workspace.profile.settings` | Workspace | LIVE_NOT_RUNTIME_VERIFIED | settings/profile UI and calendar timezone consumers | `profiles` | profiles updated | CORE_ALL_PLANS |
| Page-by-page website crawl | `website.scan` | Website intelligence | LIVE_NOT_RUNTIME_VERIFIED | `/api/website-scan`, crawler tests, `/app/sito`; sitemap/depth/SSRF guards | `website_scans`, `website_pages`; target website | scans/pages crawled | USAGE_LIMITED |
| Website evidence persistence | `website.pages.persist` | Website intelligence | LIVE_NOT_RUNTIME_VERIFIED | scan writes analyzed/skipped/failed pages in chunks | `website_pages` | pages stored | USAGE_LIMITED |
| Brand analysis from website | `brand.analyze` | AI strategy | LIVE_NOT_RUNTIME_VERIFIED | `/api/onboarding-analyze`; OpenAI-backed brand analysis | `brand_profiles`, `ai_usage_events`; OpenAI | analyses | USAGE_LIMITED |
| Brand/tone/target persistence | `brand.manage` | Brand | LIVE_NOT_RUNTIME_VERIFIED | `/app/brand`; persisted brand profile used by AI | `brand_profiles` | profile | CORE_ALL_PLANS |
| AI social copy generation | `ai.content.generate_text` | Content AI | LIVE_NOT_RUNTIME_VERIFIED | `/api/generate-text`; model hard-lock + structured output + budget | OpenAI `gpt-5.6-terra`; `ai_usage_events` | generation/tokens/USD | USAGE_LIMITED |
| Sector web research | `ai.research.web` | Content AI | LIVE_NOT_RUNTIME_VERIFIED | BALANCED/TIPS/NEWS/EVERGREEN/WEBSITE_ONLY; Responses web search | OpenAI web search/tool calls | search calls | USAGE_LIMITED |
| Fact-check/research agents | `ai.research.factcheck` | Content AI | LIVE_NOT_RUNTIME_VERIFIED | OpenAI research/fact-check modules and regressions | OpenAI `gpt-5.6-terra` | agent runs/tokens | USAGE_LIMITED |
| Editorial strategy/planner | `ai.strategy.generate` | AI strategy | LIVE_NOT_RUNTIME_VERIFIED | editorial agents + autopilot plan modules | `content_strategies`; OpenAI | strategy refreshes | USAGE_LIMITED |
| Content deduplication | `content.dedupe` | Content | LIVE_NOT_RUNTIME_VERIFIED | recent-content similarity gate before accepting generated content | `content_items`, `content_variants` | generation checks | CORE_ALL_PLANS |
| Post variants | `content.format.post` | Content | LIVE_NOT_RUNTIME_VERIFIED | POST schema and generation pipeline | `content_variants` | variants | CORE_ALL_PLANS |
| Carousel variants | `content.format.carousel` | Content | PARTIAL | text/brief variant exists; real multi-media publish support is provider-dependent/incomplete | `content_variants`, multiple real assets required | carousel variants | NOT_READY |
| Story variants | `content.format.story` | Content | PARTIAL | generated STORY variants/image size; only Instagram publishing contract supports story | `content_variants`; Instagram only for publish | story variants | NOT_READY |
| AI image generation | `ai.image.generate` | Media AI | LIVE_NOT_RUNTIME_VERIFIED | `/api/generate-image`; hard-lock `gpt-image-2`, high quality | OpenAI; `assets`, `ai_usage_events` | images/tokens/USD | USAGE_LIMITED |
| Generated-image persistence | `media.image.persist` | Storage | LIVE_NOT_RUNTIME_VERIFIED | stores generated image as DB data URL | Neon DB `assets.storage_url` | bytes/assets | USAGE_LIMITED |
| External object storage | `media.object_storage` | Storage | PLANNED | no production object-storage provider in current generation path | future provider | GB-month/egress | NOT_READY |
| Draft/content persistence | `content.draft.persist` | Content | LIVE_NOT_RUNTIME_VERIFIED | content/autopilot + approvals operate on persisted items/variants | `content_items`, `content_variants` | drafts | CORE_ALL_PLANS |
| Manual review/approval | `content.approval.manual` | Workflow | LIVE_NOT_RUNTIME_VERIFIED | `/app/approvazioni`; DB approval guards calendar jobs | content items/variants/publication jobs | approvals | CORE_ALL_PLANS |
| Automatic approval mode | `content.approval.auto` | Workflow | LIVE_NOT_RUNTIME_VERIFIED | autopilot setting `AUTOMATIC` and editorial QA path | `content_strategies`; AI QA | approved generations | PLAN_GATED |
| Autopilot enable/pause | `autopilot.manage` | Automation | LIVE_NOT_RUNTIME_VERIFIED | `/app/contenuti`; persisted settings; `/api/autopilot/run` | `content_strategies`; hourly cron | runs | PLAN_GATED |
| Hourly content autopilot | `autopilot.hourly` | Automation | LIVE_NOT_RUNTIME_VERIFIED | Worker `0 * * * *` executes serialized autopilot | OpenAI + Neon + cron | runs/generations | USAGE_LIMITED |
| Per-provider frequency | `schedule.frequency.manage` | Calendar | LIVE_NOT_RUNTIME_VERIFIED | posts/week, preferred slots, timezone, enable/disable | `schedules` | schedule rows | CORE_ALL_PLANS |
| Calendar view | `schedule.calendar.read` | Calendar | LIVE_NOT_RUNTIME_VERIFIED | month UI, jobs by date/provider | `publication_jobs` | N/A | CORE_ALL_PLANS |
| Create scheduled job | `schedule.job.create` | Calendar | LIVE_NOT_RUNTIME_VERIFIED | requires approved eligible variant + active connection | `publication_jobs`, `social_connections` | scheduled jobs | USAGE_LIMITED |
| Reschedule/cancel job | `schedule.job.manage` | Calendar | LIVE_NOT_RUNTIME_VERIFIED | persisted reschedule/delete operations | `publication_jobs` | job changes | CORE_ALL_PLANS |
| DB publication integrity | `schedule.job.integrity` | Publishing | LIVE_NOT_RUNTIME_VERIFIED | trigger verifies profile/provider/approval; idempotency key | DB triggers + `publication_jobs` | N/A | INTERNAL |
| Meta/Facebook connect | `social.facebook.connect` | Social | LIVE_NOT_RUNTIME_VERIFIED | OAuth, Page discovery/selection, encrypted token persistence | Meta Graph; `social_connections` | connection | PLAN_GATED |
| Instagram connect | `social.instagram.connect` | Social | LIVE_NOT_RUNTIME_VERIFIED | Meta OAuth, professional account/Page selection | Meta Graph; `social_connections` | connection | PLAN_GATED |
| LinkedIn connect | `social.linkedin.connect` | Social | LIVE_NOT_RUNTIME_VERIFIED | OAuth member/org mode and account selection | LinkedIn API; `social_connections` | connection | PLAN_GATED |
| GBP connect | `social.gbp.connect` | Social | LIVE_NOT_RUNTIME_VERIFIED | Google OAuth, account/location enumeration | Google Business Profile APIs; `social_connections` | connection | PLAN_GATED |
| Social token encryption | `social.token.secure_store` | Social security | LIVE_NOT_RUNTIME_VERIFIED | AES-GCM encrypted token bundle; no browser token exposure | `SOCIAL_TOKEN_KEY`, `social_connections` | connections | INTERNAL |
| Social reconnect/revoke UX | `social.connection.lifecycle` | Social | PARTIAL | disconnect exists; token refresh for Google exists; provider-specific reconnect lifecycle not runtime-certified | provider OAuth + `social_connections` | reconnects | NOT_READY |
| Facebook manual publish | `social.facebook.publish` | Publishing | LIVE_NOT_RUNTIME_VERIFIED | provider implementation + `/api/social/publish-now` | Meta Graph + active connection | successful publishes | USAGE_LIMITED |
| Instagram manual publish | `social.instagram.publish` | Publishing | LIVE_NOT_RUNTIME_VERIFIED | provider implementation + `/api/social/publish-now` | Meta Graph + active connection | successful publishes | USAGE_LIMITED |
| LinkedIn manual publish | `social.linkedin.publish` | Publishing | LIVE_NOT_RUNTIME_VERIFIED | REST Posts + optional image upload | LinkedIn API + active connection | successful publishes | USAGE_LIMITED |
| GBP manual publish | `social.gbp.publish` | Publishing | LIVE_NOT_RUNTIME_VERIFIED | Local Posts API implementation | Google Business APIs + active connection | successful publishes | USAGE_LIMITED |
| Scheduled publishing engine | `social.publish.scheduled` | Publishing | LIVE_NOT_RUNTIME_VERIFIED | 5-minute cron, due-job locking, attempt records, retries | all social providers + `publication_jobs/attempts` | attempts/successes | USAGE_LIMITED |
| Publishing retries/status | `social.publish.retry` | Publishing | LIVE_NOT_RUNTIME_VERIFIED | max 3 attempts; 15-min retry for transient failures; terminal failure conditions | `publication_attempts`, `publication_jobs` | attempts | CORE_ALL_PLANS |
| Instagram metric normalization | `analytics.instagram.normalize` | Analytics | PARTIAL | normalizer + permission contract exist; no wired ingestion route/job found | Meta Insights | metric points | NOT_READY |
| Facebook metric normalization | `analytics.facebook.normalize` | Analytics | PARTIAL | normalizer exists; no wired ingestion route/job found | Meta Insights | metric points | NOT_READY |
| LinkedIn metric normalization | `analytics.linkedin.normalize` | Analytics | PARTIAL | normalizer exists; permissions/access are restrictive; ingestion not wired | LinkedIn analytics | metric points | NOT_READY |
| GBP metric normalization | `analytics.gbp.normalize` | Analytics | PARTIAL | normalizer exists; Performance API separately required; ingestion not wired | GBP Performance API | metric points | NOT_READY |
| Provider metric ingestion/sync | `analytics.sync` | Analytics | PLANNED | no production fetch route or scheduled ingestion job found | provider analytics APIs | sync runs | NOT_READY |
| Real analytics dashboard | `analytics.read` | Analytics | PARTIAL | UI only reads persisted `metric_snapshots` and correctly shows empty state | `metric_snapshots` | snapshots | NOT_READY |
| Learning engine | `learning.compute` | Learning | PARTIAL | scoring/recommendation engine exists but no real-metric ingestion pipeline feeds it end-to-end | `metric_snapshots`, `learning_insights` | learning runs | NOT_READY |
| Learning dashboard | `learning.read` | Learning | PARTIAL | reads real `learning_insights`, deliberately empty without enough data | `learning_insights` | insights | NOT_READY |
| AI usage/cost ledger | `usage.ai.ledger` | Usage | LIVE_NOT_RUNTIME_VERIFIED | generation/onboarding paths persist model/tokens/cost/metadata | `ai_usage_events` | events/tokens/USD | INTERNAL |
| AI monthly text budget | `usage.ai.text_budget` | Cost control | LIVE_NOT_RUNTIME_VERIFIED | rejects request before OpenAI when estimated budget exceeded | `ai_usage_events`, env budget | USD/month | USAGE_LIMITED |
| AI monthly image quota | `usage.ai.image_limit` | Cost control | LIVE_NOT_RUNTIME_VERIFIED | counts image events before OpenAI generation | `ai_usage_events`, env limit | images/month | USAGE_LIMITED |
| Per-profile AI economics policy | `usage.ai.policy` | Cost control | LIVE_NOT_RUNTIME_VERIFIED | policy parser/evaluator exists; not a commercial entitlement engine | content strategy config + usage data | budget/limits | INTERNAL |
| Customer administration | `admin.customer.manage` | Admin | LIVE_VERIFIED | FASE 3 certified Admin UI/API | admin server boundary | N/A | ADMIN_ONLY |
| Audit Viewer | `admin.audit.read` | Admin | LIVE_VERIFIED | certified runtime | `audit_log` | audit reads | ADMIN_ONLY |
| Session Management | `admin.session.manage` | Admin | LIVE_VERIFIED | certified runtime | Managed Auth sessions | actions | ADMIN_ONLY |
| Ban/Unban | `admin.customer.ban` | Admin | LIVE_VERIFIED | certified runtime + RLS barrier | Managed Auth + RLS | actions | ADMIN_ONLY |
| Customer impersonation | `admin.customer.impersonate` | Admin | LIVE_VERIFIED | Runtime #55 desktop/mobile/security certification | Managed Auth + audit | sessions | ADMIN_ONLY |
| Billing/subscriptions | `billing.subscription` | Billing | PLANNED | explicitly out of scope until after FASE 4 | none | N/A | NOT_READY |
| Pricing/upgrade UI | `billing.pricing_ui` | Billing | PLANNED | not implemented by design | future billing/entitlement adapter | N/A | NOT_READY |

## Provider inventory and cost facts

Prices below are provider facts verified 2026-09-03 where an official source provides a current rate. They are **not** the user's actual monthly bill. Actual account plan/tier and monthly usage must be read from provider billing consoles before pricing Post Automatici.

| Provider | Product use | Env/config | Unit | Pricing type | Current verified fact | Inventory status |
|---|---|---|---|---|---|---|
| OpenAI | AI text, strategy, research, QA/media manager | `OPENAI_API_KEY` | 1M tokens + tool calls | VARIABLE | GPT-5.6 Terra: $2.00/1M input, $0.20/1M cached input, $12.00/1M output | FACT |
| OpenAI | GPT-Image-2 generation | same | image tokens | VARIABLE | Current OpenAI rate card: text input $5/1M; image input $8/1M ($2 cached); image output $30/1M. Current generation path is text prompt → image output, so the code's $5/$30 estimator matches that path. | FACT |
| OpenAI | web search used by editorial research | same | tool calls | VARIABLE | Code currently budgets $0.01/search call; provider invoice reconciliation has not been implemented | ESTIMATE |
| Neon | PostgreSQL/Data API/Auth backing store | `DATABASE_URL` + managed Auth | CU-hour, GB-month, data transfer | VARIABLE/STEP | Launch compute reported by Neon at $0.106/CU-hour after Nov 2025 reduction. Storage reference remains $0.35/GB-month. Paid plans include 500 GB/month public data transfer from 2026-06-01. Actual account plan unknown. | FACT rates / UNKNOWN account plan |
| Cloudflare Workers | production Worker, assets, API, cron | Worker deployment | requests + CPU ms | FIXED/STEP | Paid plan minimum $5/month; includes 10M requests/month and 30M CPU ms, then $0.30/additional 1M requests and $0.02/additional 1M CPU ms. Static asset requests are free/unlimited. | FACT rates / UNKNOWN account plan |
| Vercel | build/alternate serverless deployment configuration and Gate build | project/account | plan + infrastructure usage | UNKNOWN | Repository retains `vercel.json`, but current certified production traffic is the Cloudflare Worker. No Vercel account billing state is encoded in repo, so actual cost is not inferred. | UNKNOWN |
| Meta | Facebook/Instagram OAuth + publish; future insights | app credentials | API calls/quota | quota/rate-limited | No monetary per-publish rate is encoded in the product; access depends on app permissions/review/rate limits. | UNKNOWN monetary cost |
| LinkedIn | OAuth + member/org publish; future analytics | client credentials/access flags | API calls/quota | quota/access-limited | Community Management/analytics access can require approval; no product-side per-call cost table exists. | UNKNOWN monetary cost |
| Google Business Profile | OAuth + Local Posts; future Performance API | Google OAuth credentials | API calls/quota | quota/access-limited | Business Profile API access/quota is a dependency; Performance API must be enabled separately for metrics. | UNKNOWN monetary cost |

Official pricing references:

- OpenAI GPT-5.6 Terra: https://developers.openai.com/api/docs/models/gpt-5.6-terra
- OpenAI GPT-Image-2: https://developers.openai.com/api/docs/models/gpt-image-2 and current OpenAI rate card/pricing.
- Neon usage pricing: https://neon.com/blog/major-compute-price-reduction-on-neon and https://neon.com/blog/more-data-transfer-on-paid-plans
- Cloudflare Workers: https://developers.cloudflare.com/workers/platform/pricing/

## Cost driver inventory

| Cost driver | Type | Natural unit | Metered in product today | Source/current state |
|---|---|---|---|---|
| OpenAI text/model inference | VARIABLE | input/cached/output tokens | YES, for instrumented AI operations | `ai_usage_events` |
| OpenAI image generation | VARIABLE | input/output image tokens; images | YES for generation count; cost when usage returned | `ai_usage_events` |
| OpenAI web research/search | VARIABLE | tool calls | PARTIAL | stored in text-event metadata; not reconciled to provider invoice |
| Neon compute | VARIABLE | CU-hour | NO | Neon billing console only |
| Neon storage | VARIABLE | GB-month | NO | DB size not metered in app |
| Neon egress | STEP | GB/month | NO | provider billing/usage only |
| Database-stored generated images | VARIABLE | bytes/GB-month | NO | data URLs in `assets.storage_url`; no byte ledger |
| Cloudflare Worker requests | STEP | requests/month | NO | Cloudflare usage console |
| Cloudflare Worker CPU | STEP | CPU ms/month | NO | Cloudflare usage console |
| Cron execution | VARIABLE/STEP | invocations + CPU | NO | Worker usage, two configured cron schedules |
| Vercel build/runtime | UNKNOWN | provider SKU | NO | current account plan/usage unknown; production runtime is Cloudflare |
| Social OAuth/publish | UNKNOWN | calls/publishes | publication attempts are derivable; provider direct cost unknown | provider APIs + `publication_attempts` |
| Analytics ingestion | UNKNOWN future variable | provider API calls/snapshots | NO | ingestion not wired |
| Email/auth delivery | UNKNOWN | email/reset action | NO | Managed Auth provider; no app cost ledger |
| Logging/monitoring | UNKNOWN | logs/events/retention | NO | provider-native logs, no cost allocation |
| Technical support operations | UNKNOWN | support activity | NO | no support-event/time meter |

## Usage inventory

`METERED` below requires a persistent, useful source of truth. Where deletion/retries/history can distort a billing-period total the metric is kept `DERIVABLE` or `NOT_METERED` rather than overstated.

| Metric | Status | Current source | Reliability | Needed for plans |
|---|---|---|---|---|
| AI text generations | METERED | `ai_usage_events.operation=GENERATE_SOCIAL_TEXT` | persistent events; write failure is logged rather than failing generation, so billing-grade atomicity still needs FASE 4B/C hardening | YES |
| AI input/output tokens | METERED | `ai_usage_events` | same atomicity caveat | YES |
| AI estimated USD cost | METERED | `ai_usage_events.cost_usd` | estimate derived from current model pricing, not provider invoice reconciliation | YES |
| Generated images | METERED | `ai_usage_events.operation=GENERATE_SOCIAL_IMAGE` | used by current monthly quota; same atomicity caveat | YES |
| Brand/onboarding AI analyses | METERED | `ai_usage_events.operation=ANALYZE_BRAND_ONBOARDING` | persistent when usage write succeeds | MAYBE |
| Profiles/workspaces | DERIVABLE | `profiles` + ownership | reliable current count; historical deletion is not an immutable usage ledger | YES |
| Connected social accounts | DERIVABLE | ACTIVE `social_connections` | current state only, not historical connection-month ledger | YES |
| Current scheduled jobs | DERIVABLE | `publication_jobs` | current queue reliable; deletes/cancels remove history | MAYBE |
| Successful social publishes | DERIVABLE | `publication_attempts.state=SUCCESS` + published variants | retries are explicit; needs billing-period/idempotency validation before METERED | YES |
| Publish attempts/retries | DERIVABLE | `publication_attempts` | good operational history, not yet commercial usage ledger | NO/ops |
| API requests | NOT_METERED | none in application DB | provider consoles only | MAYBE |
| Website scans | DERIVABLE | `website_scans` | historical rows can be counted; no immutable commercial meter guarantees | YES |
| Website pages analyzed | DERIVABLE | `website_pages` / scan aggregates | useful cost proxy; deletion/retention policy not designed for billing | YES |
| Storage bytes | NOT_METERED | no byte counter | data URL images make DB storage cost important | YES |
| Analytics syncs | NOT_METERED | no ingestion job | capability not implemented | LATER |
| Metric snapshots | DERIVABLE | `metric_snapshots` | usable only after real ingestion is wired | LATER |
| Learning runs | NOT_METERED | no end-to-end runner ledger | engine exists but ingestion/run pipeline incomplete | LATER |
| Learning insights | DERIVABLE | `learning_insights` | output count, not cost/usage ledger | LATER |
| Strategy generations/refreshes | PARTIAL / NOT_METERED | some AI calls can be reflected in AI events, but there is no canonical strategy-operation meter across all paths | incomplete | YES |
| Team/workspace members | DERIVABLE | `profile_members` | current seats only; no seat-period ledger | LATER |
| Calendar generations | NOT_METERED | schedules/jobs | no explicit generation event | MAYBE |

## Entitlement candidates and future enforcement boundaries

| Capability key | Classification | Limit type | Required enforcement boundary |
|---|---|---|---|
| `auth.email.signup` | CORE_ALL_PLANS | BOOLEAN | Managed Auth/server boundary |
| `auth.session.manage` | CORE_ALL_PLANS | BOOLEAN | Managed Auth/server boundary |
| `workspace.profile.manage` | USAGE_LIMITED | COUNT/CONCURRENT profile maximum | DB/API write boundary, never UI-only |
| `website.scan` | USAGE_LIMITED | COUNT_PER_MONTH | scan API before crawl starts |
| `brand.analyze` | USAGE_LIMITED | COUNT_PER_MONTH | onboarding/analysis API before OpenAI call |
| `ai.content.generate_text` | USAGE_LIMITED | COUNT_PER_DAY + COUNT_PER_MONTH and/or cost budget | server API/autopilot before OpenAI call |
| `ai.research.web` | PLAN_GATED / USAGE_LIMITED | BOOLEAN + COUNT_PER_MONTH | research decision/provider-call boundary |
| `ai.strategy.generate` | USAGE_LIMITED | COUNT_PER_MONTH | strategy API/autopilot before provider call |
| `ai.image.generate` | USAGE_LIMITED | COUNT_PER_MONTH | image API/autopilot before OpenAI call |
| `media.image.persist` | USAGE_LIMITED | STORAGE | asset write/storage boundary |
| `content.approval.manual` | CORE_ALL_PLANS | UNLIMITED | DB/RLS workflow boundary |
| `content.approval.auto` | PLAN_GATED | BOOLEAN | autopilot/server approval transition |
| `autopilot.manage` | PLAN_GATED | BOOLEAN | cron/autopilot runner, not just toggle visibility |
| `schedule.frequency.manage` | CORE_ALL_PLANS | UNLIMITED | DB/RLS |
| `schedule.job.create` | USAGE_LIMITED | COUNT_PER_MONTH | server/DB job creation boundary (move enforcement out of client-only store in FASE 4C) |
| `social.facebook.connect` | PLAN_GATED | MAX_CONNECTED_ACCOUNTS | social connect/select API |
| `social.instagram.connect` | PLAN_GATED | MAX_CONNECTED_ACCOUNTS | social connect/select API |
| `social.linkedin.connect` | PLAN_GATED | MAX_CONNECTED_ACCOUNTS | social connect/select API |
| `social.gbp.connect` | PLAN_GATED | MAX_CONNECTED_ACCOUNTS | social connect/select API |
| `social.facebook.publish` | USAGE_LIMITED | COUNT_PER_MONTH | publish-now + due-job worker |
| `social.instagram.publish` | USAGE_LIMITED | COUNT_PER_MONTH | publish-now + due-job worker |
| `social.linkedin.publish` | USAGE_LIMITED | COUNT_PER_MONTH | publish-now + due-job worker |
| `social.gbp.publish` | USAGE_LIMITED | COUNT_PER_MONTH | publish-now + due-job worker |
| `social.publish.scheduled` | PLAN_GATED | BOOLEAN | due-job worker before provider call |
| `analytics.read` | NOT_READY | BOOLEAN | future analytics API/query boundary |
| `analytics.sync` | NOT_READY | COUNT_PER_DAY/period | future ingestion job before provider call |
| `learning.compute` | NOT_READY | BOOLEAN | future learning runner |
| `admin.audit.read` | ADMIN_ONLY | N/A | existing SUPER_ADMIN API |
| `admin.session.manage` | ADMIN_ONLY | N/A | existing SUPER_ADMIN API |
| `admin.customer.ban` | ADMIN_ONLY | N/A | existing SUPER_ADMIN API |
| `admin.customer.impersonate` | ADMIN_ONLY | N/A | existing SUPER_ADMIN API |
| `usage.ai.ledger` | INTERNAL | N/A | server-side event writer |

No future entitlement may rely only on hiding a React control. Enforcement must occur before the cost/resource side effect at the API, job, provider-call or DB mutation boundary.

## SELLABLE NOW — conservative

These are sufficiently coherent product capabilities to form part of an offer **without claiming external provider behavior that has not been runtime-certified**:

1. Secure account/session foundation and isolated multi-activity profiles.
2. Per-activity website intelligence with page-level crawl and persisted source material.
3. Brand context/tone/target persistence and AI-assisted analysis.
4. OpenAI-based editorial/copy/image generation, content variants, deduplication and review workflow, subject to current AI limits.
5. Per-profile calendar/frequency configuration, approval workflow and persisted publication queue.

`LIVE_NOT_RUNTIME_VERIFIED` items must still receive focused production/runtime certification before being marketed as guaranteed external outcomes. SELLABLE NOW therefore excludes promises such as “publishes automatically to all four social networks” or “optimizes from real analytics” until those paths are certified.

## NOT SELLABLE YET / gap analysis

| Capability | Current status | Missing | Monetization blocker | Effort |
|---|---|---|---|---|
| Four-provider OAuth/connect as guaranteed live service | LIVE_NOT_RUNTIME_VERIFIED | real account runtime certification, provider approvals/config verification, reconnect cases | YES for social-publishing offer | MEDIUM |
| Instagram/Facebook/LinkedIn/GBP publishing guarantee | LIVE_NOT_RUNTIME_VERIFIED | provider-by-provider real publish E2E + failure/retry certification | YES for autopublishing offer | MEDIUM |
| Carousels end-to-end | PARTIAL | multiple asset model + provider-specific publish implementation/certification | NO for initial post-only offer | MEDIUM |
| Stories end-to-end | PARTIAL | provider-specific constraints + real Instagram story E2E | NO | MEDIUM |
| Social analytics ingestion | PLANNED/PARTIAL contracts | provider fetch APIs, permissions, sync job, persistence/idempotency | YES for analytics/learning claims | LARGE |
| Analytics dashboard as performance product | PARTIAL | real ingestion and time-series aggregation/comparison | YES for analytics offer | MEDIUM after ingestion |
| Continuous learning/recommendations | PARTIAL | real metric ingestion → learning runner → persistence → strategy feedback loop E2E | YES for “self-optimizing” claim | LARGE |
| Provider/infrastructure cost allocation | NOT_METERED | provider usage import/allocation by profile | YES before robust pricing | MEDIUM |
| Billing-grade usage ledger | PARTIAL | atomic idempotent usage events, retry semantics, period buckets, immutable events | YES before usage-based plans | MEDIUM |
| External object storage | PLANNED | choose provider, migrate DB data URLs, quotas/cleanup/egress meter | YES before meaningful scale | MEDIUM |
| Entitlement engine | PLANNED | FASE 4B schema/design + FASE 4C enforcement | YES before commercial plans | MEDIUM |
| Billing/Stripe | PLANNED | intentionally deferred until 4A–4F | NO for personal version; YES for public SaaS checkout | LARGE later |

## Core value today

The strongest current product value is:

1. **Multi-activity isolation** — one login can operate multiple independent profiles while data remains tenant-scoped.
2. **Website-grounded intelligence** — the system crawls the activity website page by page and feeds confirmed business context into generation instead of relying on homepage-only prompts.
3. **AI editorial production** — OpenAI text/research/QA/image components can produce platform-specific content while recording AI usage and enforcing internal budget/quota controls.
4. **Approval + calendar automation** — manual or automatic approval policy, per-provider frequency/timezone and persisted scheduling queue.
5. **Real provider publishing architecture** — four-provider OAuth/publish code and retry queue exist, but remain excluded from guaranteed commercial claims until external runtime certification.

## Preliminary unit economics model

Per profile/customer per month, future technical COGS should be modeled as:

`AI text + AI research/tool calls + AI image + database compute + database storage + data transfer + Worker compute/requests + publishing/analytics API related costs + email/auth variable services + allocated fixed infrastructure = estimated technical COGS`

Then:

`Revenue - technical COGS = gross contribution`

This is not accounting or tax net profit.

Current measurable components:

- AI text tokens/generations/estimated USD.
- AI image generation count and estimated USD when OpenAI usage is returned.
- Some web-search call metadata.
- Current profiles/connections/jobs/publish attempts can be derived operationally.

Currently unknown/not allocated by profile:

- Neon CU-hours, DB/storage GB-month and transfer.
- Cloudflare Worker request/CPU allocation by profile.
- Vercel account cost, if any remains attributable to this product.
- DB bytes occupied by generated media.
- External social API operational/quota cost.
- Analytics ingestion cost because ingestion is not live.
- auth/email delivery cost allocation.

Metrics required before final plan pricing:

1. billing-grade AI event atomicity/idempotency;
2. generated media bytes/profile/month;
3. successful publish count/profile/month;
4. website pages scanned/profile/month;
5. actual infrastructure provider monthly usage and a defensible allocation method;
6. future analytics sync volume if analytics becomes sellable;
7. low/normal/high usage distributions taken from real production usage, not invented post counts.

Internal economic target for future packaging: approximately **€50/customer/month gross contribution after relevant technical operating costs**. This is a target, not a guarantee and not a reason to invent a selling price before measurement is complete.

## Proposed entitlement model — design only

Use a provider-independent model:

`profile/workspace → entitlement assignment → capability key → limit definition → usage ledger/bucket → server-side enforcement → UI projection`

Conceptually:

- `capability_catalog`: stable machine-readable keys and metadata.
- `entitlement_assignment`: which capabilities a profile receives and optional limits.
- `usage_event`: immutable, idempotent events with `profile_id`, capability key, quantity/cost, occurred-at, provider reference/idempotency key.
- `usage_bucket`: derived/transactionally maintained daily/monthly/billing-period counters.
- enforcement helper: called at API/job/provider boundaries before side effects.
- Admin view: enabled entitlements, limits, usage, blocked/overage state and cost estimates.
- Customer view: current allowances, usage and reset date. No pricing/upgrade UI until packaging/billing phases.

The future billing provider must be only an **adapter** that maps a commercial subscription to an entitlement set. Product code must never scatter checks such as `if (plan === "pro")`.

All entitlement/usage data must remain tenant-scoped with RLS; SUPER_ADMIN global management stays behind the already certified privileged server boundary.

## FASE 4A decision

`PRODUCT CAPABILITY + COST + ENTITLEMENT INVENTORY = PASS` only when this document is reviewed in its dedicated docs-only PR and no material capability/provider/usage class is missing. At this commit the inventory is complete enough to proceed to review; no entitlement/billing runtime has been implemented.

Next after PASS: `FASE 4B — Entitlement + Usage Architecture`.
