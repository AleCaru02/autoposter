# FASE 4C — AI content text metering + server-side gating

Base: main `f2fc51fb26f10f20d605cbbc8d099840c5b49a4c`. FASE 4B remains PASS and is reused unchanged.

## Complete OpenAI text call graph

| Entry Point | Real Caller | OpenAI Operation | Logical Capability | Technical Event | Current Metering | Target Metering |
|---|---|---|---|---|---|---|
| `/api/generate-text` (Vercel) | authenticated manual API request | `generateSocialText` → Responses API main copy | `ai.content.generate_text` | `GENERATE_SOCIAL_TEXT` | legacy cost budget + `ai_usage_events` | shared reserve/commit/release + legacy budget + technical ledger |
| `/api/generate-text` (Cloudflare production) | authenticated manual API request | `generateSocialText` → Responses API main copy | `ai.content.generate_text` | `GENERATE_SOCIAL_TEXT` | legacy cost budget + `ai_usage_events` | same shared boundary |
| `createPlannedContent` | `runContentAutopilot` | `generateSocialText` → Responses API main copy | `ai.content.generate_text` | `GENERATE_SOCIAL_TEXT` | legacy budget only | same shared boundary as manual |
| `generateSocialText` | manual + Autopilot | `runOpenAIResearchAgent` when research mode = NEWS | parent logical generation `ai.content.generate_text` | `AGENT_RESEARCH` | cost included in aggregate result | technical event only; no second logical quota |
| `generateSocialText` | manual + Autopilot | `runOpenAIFactCheckAgent` when generated content needs fact-check | parent logical generation `ai.content.generate_text` | `AGENT_FACTCHECK` | cost included in aggregate result | technical event only; no second logical quota |
| `createPlannedContent` | Autopilot automatic approval + eligible variant | `runOpenAIEditorialQA` | parent logical generation `ai.content.generate_text` | `AGENT_EDITORIAL_QA` | dedicated `ai_usage_events` row | technical event only; no second logical quota |
| `/api/onboarding-analyze` Vercel | onboarding / legacy-profile bootstrap | `analyzeBrandFromWebsite` | `brand.analyze` | `ANALYZE_BRAND_ONBOARDING` | technical event after analysis | mapped only in this PR |
| `/api/onboarding-analyze` Cloudflare | onboarding / legacy-profile bootstrap | `analyzeBrandFromWebsite` | `brand.analyze` | `ANALYZE_BRAND_ONBOARDING` | technical event after analysis | mapped only in this PR |
| `/api/editorial-agents/strategy-plan` Vercel | authenticated strategy refresh | Strategist Responses API | `ai.strategy.generate` | `AGENT_STRATEGIST` | event, historical path has `cost_usd=NULL` | open gap outside this PR |
| `/api/editorial-agents/strategy-plan` Vercel | authenticated strategy refresh | Planner Responses API | `ai.strategy.generate` | `AGENT_PLANNER` | event, historical path has `cost_usd=NULL` | open gap outside this PR |
| `/api/editorial-agents/strategy-plan` Cloudflare | authenticated strategy refresh | Strategist Responses API | `ai.strategy.generate` | `AGENT_STRATEGIST` | same shared library | open gap outside this PR |
| `/api/editorial-agents/strategy-plan` Cloudflare | authenticated strategy refresh | Planner Responses API | `ai.strategy.generate` | `AGENT_PLANNER` | same shared library | open gap outside this PR |
| `runContentAutopilotSerialized` | manual Autopilot run + scheduled Autopilot | `ensureOpenAIStrategyPlannerFresh` → Strategist | `ai.strategy.generate` | `AGENT_STRATEGIST` | refresh path records calculated cost | mapped only in this PR |
| `runContentAutopilotSerialized` | manual Autopilot run + scheduled Autopilot | `ensureOpenAIStrategyPlannerFresh` → Planner | `ai.strategy.generate` | `AGENT_PLANNER` | refresh path records calculated cost | mapped only in this PR |
| `generateOpenAIImage` | image endpoint + Autopilot image branch | `runOpenAIMediaManager` Responses API | `ai.image.generate` | currently folded into image event metadata | image technical cost includes Media Manager | defer to AI image metering block |

Repository-wide provider scan found no other production `/v1/responses` text path outside: `openai-text.ts`, `openai-research-factcheck.ts`, `openai-editorial-qa.ts`, `brand-analysis.ts`, `openai-strategy-planner.ts`, and `openai-media-manager.ts`.

## Editorial QA

- File: `api/_lib/openai-editorial-qa.ts`.
- Caller: only `api/_lib/autopilot.ts:createPlannedContent`.
- Trigger: `approvalMode === "AUTOMATIC" && variant.eligible`.
- Provider calls: exactly one Responses API call per QA execution.
- Output: PASS/BLOCK + reasons/checks. It does not rewrite or generate replacement copy and does not use web search.
- Technical event: `AGENT_EDITORIAL_QA`.
- Cost: token-based Terra estimate.
- Logical quota: zero additional units; it belongs to the already-reserved `ai.content.generate_text` logical operation.
- Retry/failure: a BLOCK is persisted technically and releases the logical reservation because no publishable content is committed. Provider/transport failure also fails the logical operation.
- Gap closed in this PR: its technical event is linked to the logical usage event.

## Strategy / Planner

Real callers:
1. `api/editorial-agents.ts` → `runOpenAIStrategyPlanner`.
2. `cloudflare/editorial-agents.ts` → `runOpenAIStrategyPlanner`.
3. `api/_lib/autopilot-serialized.ts` → `ensureOpenAIStrategyPlannerFresh` → `generateOpenAIStrategy` / `generateOpenAIPlan`.

Strategist and Planner are separate OpenAI Responses API calls under one logical capability `ai.strategy.generate`. `AGENT_STRATEGIST` and `AGENT_PLANNER` are the technical operations.

Open gap: `runOpenAIStrategyPlanner` writes `cost_usd=NULL`; the refresh implementation already calculates cost. This is classified as **OPEN GAP — AI strategy technical cost metering** and is intentionally not migrated in the AI-content-text PR.

## generateSocialText callers

Production callers are exactly:
1. `api/generate-text.ts`.
2. `cloudflare/generate-text.ts`.
3. `api/_lib/autopilot.ts:createPlannedContent`.

Research and fact-check are internal subcalls of `generateSocialText`, not additional entry points and not additional commercial quota units.

## currentSpend defect

Previous Autopilot query:

`sum(cost_usd) where month AND operation='GENERATE_SOCIAL_TEXT'`

It omitted `profile_id`, so Profile B spend could reduce Profile A's legacy budget. Classification: **CONFIRMED TENANT ACCOUNTING BUG**.

Corrected query is profile-scoped and includes all AI-content-text technical operations:
`GENERATE_SOCIAL_TEXT`, `AGENT_RESEARCH`, `AGENT_FACTCHECK`, `AGENT_EDITORIAL_QA`.

The regression uses two different profile IDs and verifies each query receives only its own profile ID.

## Logical metering contract

A **logical generation** is one explicit product operation that asks Post Automatici to create one new social-content result for one profile.

Unit: `quantity = 1` of `ai.content.generate_text`.

It remains one unit even when the provider pipeline performs main copy + Research + Fact-check + Editorial QA.

Manual operation identity:
- client supplies only a nonce in `x-post-automatici-operation-id`;
- the nonce is not the entitlement authority;
- server derives the actual idempotency key from profile + source + nonce + canonical request fingerprint;
- changing payload changes the server key, so a reused nonce cannot obtain different outputs under one logical usage event.

Autopilot operation identity:
`profile + provider + scheduledAt`, generated only from server-controlled job context, plus a canonical request fingerprint.

Reservation occurs before legacy budget and before any provider call. If generic capability denies, provider count is zero. If legacy budget denies, reservation is released before returning `AI_BUDGET_EXCEEDED`.

Commit occurs only after technical usage is durably recorded and the required result persistence has succeeded. Manual stores the recoverable response on the logical event; Autopilot commits only after content/variant/job persistence.

Failure before committed output releases the logical reservation. Provider cost already incurred is not erased.

Duplicate committed operations return the cached result without a second provider call. Concurrent duplicates see the RESERVED operation and return `GENERATION_IN_PROGRESS`; they do not call OpenAI.

## Technical AI cost contract

`capability_usage_events` is the product-usage ledger. `ai_usage_events` is the provider-cost ledger.

Main generation, Research and Fact-check now expose separate technical-event records. Editorial QA remains a separate technical event. These technical events all point back to the logical capability usage event.

Technical persistence is atomic per batch. Before inserting technical rows, the event metadata stores a `technical_usage_outbox`. Three persistence attempts are allowed. If all fail, the outbox remains as `PENDING_RECONCILIATION`, the request fails with `METERING_FAILED`, and logical quota is released. The output is not reported as fully metered success.

Blocked Research/Fact-check provider work carries its technical events through `OpenAITextPipelineError`, so incurred provider usage is preserved before the logical operation is released.

## Error contract

- `CAPABILITY_DISABLED`
- `CAPABILITY_LIMIT_REACHED`
- `AI_BUDGET_EXCEEDED`
- `METERING_FAILED`
- `GENERATION_IN_PROGRESS`
- `OPERATION_ID_REQUIRED`

No client-supplied limit or remaining-quota value is accepted.
