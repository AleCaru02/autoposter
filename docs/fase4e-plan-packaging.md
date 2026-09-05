# FASE 4E — plan packaging

Verified against `main` SHA `11e51ebb456607266cd431fc44d369f4e6dae4df` on 2026-09-05.

## Contract

Commercial packaging is a provider-independent mapping:

`package version -> capability rows -> privileged profile assignment -> profile_entitlements -> server-side capability enforcement`

Runtime code never branches on a plan name. Stripe products, prices, checkout, subscriptions and webhooks remain outside this phase.

The package catalog is not public pricing. It contains no selling price. `commercial_guarded:v1` is the first bounded commercial candidate. It is stored as `DRAFT`, so the materializer rejects it until FASE 4F completes provider-budget enforcement and promotes it through a reviewed migration. It uses current operational safety defaults as explicit assumptions:

| Capability | Monthly logical allowance | Provider-attempt reserve |
|---|---:|---:|
| `brand.analyze` | 2 | `$0.50` |
| `ai.content.generate_text` | 30 | `$1.00` |
| `ai.strategy.generate` | 3 | `$0.75` |
| `ai.image.generate` | 20 | `$0.50` |

The package-level monthly provider-cost budget is `$5.00/profile`. This is a safety envelope, not an observed average and not a price. The image allowance preserves the pre-existing 20-image default; text uses the existing 30-generation weekly guard as a stricter monthly pilot allowance; strategy follows the existing 30-day strategy / 14-day plan refresh cadence; two brand analyses allow initial analysis plus one retry/re-analysis. These values must be revised from measured usage before public pricing.

Every other commercially assignable registry capability is explicitly present and disabled. A package therefore cannot silently inherit a new or uncertified feature.

## Provisioning and security

- `apply_entitlement_package(...)` is the only package materializer.
- It is `SECURITY DEFINER`, transaction-scoped, profile-locked, and revoked from `PUBLIC` and `authenticated`.
- It replaces the complete commercially assignable entitlement set and records assignment history plus `ENTITLEMENT_CHANGED` in `platform_admin_audit`.
- Package catalog, mapping and assignment tables use RLS + FORCE RLS and have no customer policy.
- Customers continue to see only tenant-scoped resolved rows in `profile_entitlements`.
- Existing production profiles retain `INTERNAL_BASELINE`; this migration does not change their behavior.
- The automatic `UNLIMITED` bootstrap trigger is removed. New profiles fail closed for gated capabilities until privileged provisioning.
- Only `ACTIVE` package versions can be materialized; the v1 candidate is deliberately non-assignable during FASE 4E.

## Economic boundary

Logical allowances are finite and the package stores a server-owned provider-attempt reserve per enabled AI capability plus a finite monthly provider budget. FASE 4F must certify atomic package assignment, denial, tenant isolation, audit, and runtime enforcement of the provider budget before commercial exposure. Provider dashboard spend limits remain defense in depth.

Selling price and the approximately €50 contribution target remain `NOT CERTIFIABLE` until a price decision and measured usage allocation exist. No price is inferred here.

`FASE 4E PLAN PACKAGING MODEL = PASS`

Next: `FASE 4F — runtime certification`.
