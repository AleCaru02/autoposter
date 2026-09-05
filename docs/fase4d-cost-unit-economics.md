# FASE 4D — Cost / unit economics

Status: model complete; current commercial exposure **not bounded**.  
Code baseline audited: `dbb20019c0e2d75780284b66584cf07845b21515`.  
Evidence and provider prices verified: 2026-09-05 UTC.

This phase measures technical COGS per profile/workspace. It does not define plans, selling prices, tax treatment, payment processing, or Stripe.

## Evidence classes

- **FACT**: official provider rate or exact repository/runtime behavior.
- **OBSERVED**: production aggregate read at a stated time. QA cleanup means zero rows are `NO_DATA`, never a zero-cost customer average.
- **ESTIMATE**: deterministic calculation from a documented rate and workload.
- **ASSUMPTION**: sensitivity input for the next packaging phase, not a product fact.

## Production usage snapshot

Read-only Neon query at `2026-09-05T07:18:50Z`, project `post-automatici`, default branch `main`:

| Measure | Observed value | Interpretation |
|---|---:|---|
| Profiles | 20 | Current tenant denominator; not evidence of 20 paying customers |
| `ai_usage_events` all time/current month | 0 / 0 | No non-QA technical usage remains after verifier cleanup |
| `capability_usage_events` all time/current month | 0 / 0 | No non-QA logical usage distribution exists yet |
| Persisted OpenAI image assets | 0 | No observed media byte distribution exists yet |

Therefore average cost per active customer is **NO_DATA**. Dividing zero cost by 20 profiles would create a false `$0` average and is forbidden by the unit-economics regression.

Neon organization plan is currently Free. The active project snapshot reports 25.30 CU-hours (`91,082` CU-seconds), about 34.9 MB logical storage, and 11.8 MB transfer. These values are below the current Free allowances, so the current Neon invoice contribution is `$0`; they include development/verifier load and are not extrapolated into a customer monthly average.

## Official rate card

| Driver | Current official rate | Product use |
|---|---:|---|
| GPT-5.6 Terra standard input / cached input / cache write / output | `$2.00 / $0.20 / $2.50 / $12.00` per 1M tokens | text, brand, strategy, research, fact-check, editorial QA, Media Manager |
| OpenAI web search | `$10 / 1,000 calls` plus search-content tokens | at most one search call in each instrumented research request |
| GPT-Image-2 text input | `$5.00 / 1M tokens` | generation prompt |
| GPT-Image-2 image output | `$30.00 / 1M tokens` | generated image |
| GPT-Image-2 high 1024×1024 / 1024×1536 output estimate | `$0.211 / $0.165` per image output | current POST/CAROUSEL and STORY sizes; prompt and Media Manager costs are additional |
| Neon Launch compute / storage / public transfer | `$0.106/CU-hour`; `$0.35/GB-month`; 500 GB/project included then `$0.10/GB` | scale-out shadow rates; the actual organization is Free |
| Cloudflare Workers Paid | `$5/account-month` minimum, includes 10M requests and 30M CPU ms; overage `$0.30/M requests`, `$0.02/M CPU ms` | certified production runtime; actual account plan/invoice not available in the repository |

Official sources:

- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- GPT-5.6 Terra model rate: https://developers.openai.com/api/docs/models/gpt-5.6-terra
- GPT-Image-2 sizes/cost calculator: https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency
- Neon pricing: https://neon.com/pricing
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- ECB reference rate used for sensitivity conversion: https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html

ECB 2026-09-04 reference: `EUR 1 = USD 1.1622`. Calculations use `EUR = USD / 1.1622`; this is a dated sensitivity rate, not an FX guarantee.

## Capability cost units

| Capability | Logical commercial unit | Technical billable work | Current product guardrail | Unit-cost result |
|---|---|---|---|---|
| `ai.content.generate_text` | one completed generation | final Terra call; optional research, fact-check, web search and automatic editorial QA | estimated text budget `$5/profile/month`, daily/weekly Autopilot generation limits | actual post-call cost is complete when all technical events have non-null cost; request estimator is a guardrail, not an invoice ceiling |
| `brand.analyze` | one completed analysis of one persisted scan | one Terra call, max 8,000 output tokens and bounded 110k-character page context | baseline entitlement currently `UNLIMITED` | no current monthly hard provider-cost cap |
| `ai.strategy.generate` | one completed daily cycle (`STRATEGY_PLAN` or `PLAN`) | Strategist + Planner, or Planner only | Autopilot reserves `$0.20` / `$0.12`; baseline entitlement currently `UNLIMITED` | reserves are conservative estimates, not hard provider-cost caps |
| `ai.image.generate` | one completed image operation | Terra Media Manager + GPT-Image-2 | 20 images/profile/month legacy count by default | high output is `$0.165–$0.211` plus prompt and Media Manager; failed/released calls can cost without consuming a logical unit |

Every successful capability now persists logical and technical usage with tenant isolation and idempotency. A commercial average is valid only when logical units are positive and every related technical event has non-null `cost_usd`.

## Current worst case

`CURRENT_MONTHLY_PROVIDER_EXPOSURE = UNBOUNDED`

Reasons:

1. baseline entitlements for `brand.analyze` and `ai.strategy.generate` are `UNLIMITED`;
2. the text budget and image count are application estimates/counts, not an account-level provider spend ceiling;
3. provider work can be billable before a failure, while the logical reservation is correctly released so the customer is not charged a commercial unit;
4. repeated failed/released attempts are therefore not bounded by committed logical-unit limits.

This is not a metering defect: release semantics are correct. It is a cost-governance/packaging gap. FASE 4E must assign finite commercial limits and a separate provider-cost safety budget that includes failed technical attempts. Provider-dashboard spend limits remain a required defense in depth.

## Contribution sensitivity, not pricing

For an assumed hard all-AI provider cap and `€0.50/profile/month` of other allocated technical COGS:

| ASSUMPTION: provider cap | Converted provider COGS | Total technical COGS | Minimum revenue for `€50` contribution |
|---:|---:|---:|---:|
| `$5` | `€4.30` | `€4.80` | `€54.80` |
| `$10` | `€8.60` | `€9.10` | `€59.10` |
| `$15` | `€12.91` | `€13.41` | `€63.41` |

These are sensitivity rows only. They exclude support labor, taxes, payment fees, Vercel account charges, unmeasured generated-media storage, and unknown social-provider operational costs. No selling price or plan can be certified from them.

## 4D decision

- Provider rates: **VERIFIED**.
- Cost calculation code: **TESTED**.
- Production customer average: **NO_DATA**.
- Technical cost completeness rule: **DEFINED**.
- Current worst-case exposure: **UNBOUNDED**.
- `€50` contribution target: **NOT YET CERTIFIABLE** until FASE 4E supplies finite limits and the missing cost allocations are measured or conservatively budgeted.

`FASE 4D COST / UNIT ECONOMICS MODEL = PASS`

Next single block: `FASE 4E — plan packaging`, without Stripe.
