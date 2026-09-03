# FASE 4B — Entitlement + Usage Architecture

Status: architecture + foundation for Post Automatici. Billing-provider independent. FASE 4C performs runtime gating of product capabilities.

## Existing system analysis

Production already has `profiles`, `profile_members`, `ai_usage_events`, `social_connections`, `publication_jobs`, `website_scans`, `website_pages`, `content_strategies`, schedules and the tenant/RLS helpers used throughout the product.

There are no existing `plan`, `subscription` or generic entitlement tables in production. `ai_usage_events` is a useful AI-specific operational/cost ledger, but it is semantically too narrow to become the generic product-usage source of truth. It is therefore preserved unchanged and later mapped into the new capability ledger during FASE 4C where appropriate.

Current AI controls must remain active until their explicit migration in FASE 4C:

- text: `OPENAI_TEXT_MONTHLY_BUDGET_USD` + `ai_usage_events` pre-provider budget check;
- image: `OPENAI_IMAGE_MONTHLY_LIMIT` + `ai_usage_events` pre-provider count;
- profile AI economics configuration in `content_strategies.platform_strategy.aiEconomics`.

No FASE 4B component disables or replaces those controls.

## Domain model

Canonical relationship:

`profile/workspace -> entitlement -> capability -> limit -> usage -> server enforcement`

### Capability

The canonical registry lives in `api/_lib/capabilities.ts`. It is the source of truth for stable capability keys, classification, current implementation status and natural limit type. No future runtime code should scatter raw plan-name checks.

Classification behavior:

- `CORE_ALL_PLANS`: enabled by deterministic code default for every valid profile; no row per profile is required.
- `PLAN_GATED`: missing assignment is disabled/fail-closed.
- `USAGE_LIMITED`: missing assignment is disabled/fail-closed.
- `ADMIN_ONLY`: remains protected by the existing SUPER_ADMIN server boundary, not normal customer entitlements.
- `INTERNAL`: never customer-sellable.
- `NOT_READY`: cannot be commercially assigned and always resolves disabled in the customer entitlement service.

### Entitlement assignment

`profile_entitlements` stores only profile-scoped explicit assignments/overrides and the temporary internal baseline used to preserve existing behavior before plan packaging.

Important fields:

- `profile_id`
- `capability_key`
- `enabled`
- `limit_type`
- `limit_value`
- `period_type`
- `source`
- optional validity window

There is intentionally no plan name, Stripe ID, subscription ID or checkout concept in this schema.

### Usage ledger

Generic product usage belongs in `capability_usage_events`, not in `ai_usage_events`.

Each event is:

- tenant-attributed by `profile_id`;
- capability-attributed by `capability_key`;
- quantity based;
- period attributed;
- idempotent through `(profile_id, capability_key, idempotency_key)`;
- stateful: `RESERVED`, `COMMITTED`, `RELEASED`.

`capability_usage_buckets` stores transactionally maintained period totals so expensive capability checks do not require summing an unbounded event table on every request.

## Period model

Supported periods:

- `NONE`
- `DAY`
- `MONTH`
- `CUSTOM`

Day and month storage boundaries use UTC. UI conversion is separate. `CUSTOM` exists for a future provider-independent commercial/billing period but has no Stripe dependency.

## Atomic usage model

For capability use that may have a hard quota:

1. server resolves entitlement;
2. server computes period;
3. `reserve_capability_usage()` obtains an advisory transaction lock for profile + capability + period;
4. the bucket is row-locked;
5. duplicate idempotency key returns the existing reservation;
6. if the requested quantity exceeds the limit, no event/provider call is allowed;
7. otherwise usage is reserved before the side effect;
8. caller later commits or releases the reservation according to capability semantics.

This removes a check-then-provider race between concurrent requests.

## Failure semantics

The foundation deliberately supports different semantics instead of forcing one rule on all providers.

### Cost incurred when provider attempt starts

For operations where an external provider can charge once the call is made, FASE 4C should reserve first and commit when the provider attempt begins/returns a chargeable result. A later functional failure does not automatically erase real technical cost.

Examples likely to use this model: OpenAI generation/research.

### Usage counted only after product outcome

For capability counters whose commercial meaning is a completed outcome, reserve before the side effect and commit only on success; release on safe failure.

Examples likely to use this model: successful social publish, successful connection creation.

The exact rule is decided per capability in FASE 4C.

## Default and backward compatibility

Missing entitlement behavior is fail-closed for `PLAN_GATED` and `USAGE_LIMITED`, while `CORE_ALL_PLANS` remains enabled by code default.

This cannot be allowed to break the current personal production system. The migration therefore provisions an `INTERNAL_BASELINE` assignment for currently operational commercial-candidate capabilities on every existing profile and via an `AFTER INSERT` profile trigger for new personal profiles during the pre-packaging phase.

The baseline assignment uses `UNLIMITED` at the generic entitlement layer. Existing product-specific AI text budget and image quota continue to enforce the real current limits until FASE 4C migrates them. This prevents double enforcement and prevents accidental production lockout.

Before FASE 4E plan packaging, the baseline bootstrap strategy must be revisited for external customer provisioning.

## Profile/workspace and profile-count limits

The commercial service unit remains one `profile/workspace` because brand, social, content, scheduling, metrics, learning and usage belong to `profile_id`.

`workspace.profile.manage` exists in the catalog, but a true maximum-number-of-workspaces-per-commercial-account is an aggregate account-level entitlement. The current product has no commercial-account container above profiles. FASE 4B therefore does not invent one or attach a contradictory “max profiles” limit to a profile itself. That aggregate relationship is deferred until packaging/customer-account design requires it.

## Social connection limits

Each social provider already has a dedicated connection row and provider-specific capability. Future gating may use boolean provider access and/or `MAX_CONNECTED_ACCOUNTS`. Current database shape effectively supports one selected connection per provider/profile. FASE 4C will enforce entitlement before OAuth/selection without trusting the browser.

## Central service

`api/_lib/entitlement-usage.ts` provides the centralized server-side contract:

- `getEntitlement(profileId, capabilityKey)`
- `canUseCapability(profileId, capabilityKey, amount?)`
- `getUsage(profileId, capabilityKey)`
- `reserveUsage(...)`
- `commitUsage(eventId)`
- `releaseUsage(eventId)`

Unknown capability keys fail closed. `NOT_READY`, `ADMIN_ONLY` and `INTERNAL` do not resolve as normal customer-enabled capabilities.

## Security and RLS

New tables have RLS enabled and forced.

Customer/authenticated role:

- SELECT only when `owns_profile(profile_id)`;
- no entitlement or usage INSERT/UPDATE/DELETE policy;
- no permission to execute reservation/commit/release functions.

Anonymous:

- no policy/access.

Writes are owned by privileged server/internal provisioning. SUPER_ADMIN visibility/write management must remain behind the existing privileged Admin API boundary when introduced; direct customer elevation is forbidden.

Expected security matrix:

| Test | Expected |
|---|---|
| Customer A reads A | PASS |
| Customer A reads B | DENIED |
| Customer changes own limit | DENIED |
| Anonymous reads entitlement | DENIED |
| Unknown capability | FAIL CLOSED |
| Duplicate consume | IDEMPOTENT |
| Concurrent over-limit consume | SAFE / excess denied |

## Audit model

Entitlement mutation should later emit a small auditable set through the existing platform audit mechanism:

- `ENTITLEMENT_GRANTED`
- `ENTITLEMENT_CHANGED`
- `ENTITLEMENT_REVOKED`
- `LIMIT_CHANGED`

FASE 4B does not add a second audit subsystem.

## Customer read model

A future safe read API may expose only the resolved customer view:

- capability key;
- enabled;
- limit type/value;
- used/reserved/remaining;
- period start/end/reset;
- source type when safe.

It must never accept current plan, enabled state, remaining quota or reset date from the browser as authority.

## SUPER_ADMIN model

Future Admin API may expose:

- profile entitlement assignments;
- resolved defaults and source (`CORE_DEFAULT`, baseline, override);
- usage buckets/events;
- current limits/remaining;
- technical cost indicators when available.

Writes stay privileged and audited.

## FASE 4C enforcement boundaries

FASE 4B builds the engine only. FASE 4C wires it in this order:

| Capability | Enforcement boundary |
|---|---|
| AI text | before OpenAI/provider call |
| AI image | before OpenAI/provider call |
| Website scan | before crawler starts |
| Scheduled job | before job creation |
| Publish | before external provider call |
| Social connect | before OAuth/new connection allocation |
| Autopilot | before automatic run |

Frontend hiding/disabled states are UX only.

## Migration strategy

1. create new non-destructive tables/functions;
2. backfill internal baseline for all existing profiles;
3. preserve existing AI budgets and existing application flows;
4. certify RLS/idempotency/reservation behavior on an ephemeral Neon branch;
5. apply migration to production only after migration verification;
6. deploy foundation service with no product gating changes;
7. FASE 4C migrates one capability at a time using `problem -> correction -> verification -> PASS`.

Production invariants to preserve: 20 profiles unless legitimate production change occurs, zero profiles without owner, all existing tenant/RLS and FASE 3 security guarantees.

## Future billing integration boundary

A future billing provider may provision or revoke entitlement assignments through a privileged adapter. It may not become the product source of truth.

Correct direction:

`billing adapter -> entitlement provisioning -> capability engine`

Forbidden direction:

`Stripe price/subscription -> scattered runtime plan checks`.
