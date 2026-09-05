# FASE 4F — provider cost budget

## Runtime contract

The commercial logical allowance and the provider-cost budget are independent server-side gates. For a profile assigned to an active package, every provider-backed logical usage event must pass this sequence:

`logical reserve -> provider-cost reserve -> provider call -> technical usage -> cost reconciliation -> logical commit/release`

`begin_provider_cost_attempt(...)` is the only transition that authorizes a provider call for a managed profile. It locks the profile/month budget, accounts the greater of reserved and known actual cost for every attempt, and inserts a unique attempt before the provider starts. A denied attempt returns `PROVIDER_COST_BUDGET_REACHED`; no provider call is allowed and the logical reservation is released by the caller.

Technical usage remains the source of actual provider cost. After its idempotent persistence, `reconcile_provider_cost_attempt(...)` records the sum of technical `cost_usd` linked to the logical event. A failed provider attempt is never removed from the budget merely because its logical unit is released: its provider reserve remains conservatively accounted unless a larger actual cost is known.

Profiles without a package assignment keep the pre-existing internal runtime behavior. This compatibility path is deliberate: FASE 4F introduces the commercial budget boundary without silently changing existing `INTERNAL_BASELINE` profiles.

## Security and concurrency

- Package assignment, capability reserve and monthly cap are resolved exclusively from server-owned database rows.
- Both budget functions are `SECURITY DEFINER`, use a fixed `search_path`, and are revoked from `PUBLIC` and `authenticated`.
- The attempt table has RLS + FORCE RLS and no customer policy.
- One attempt exists per logical usage event.
- A transaction advisory lock serializes budget decisions per profile and UTC calendar month.
- Budget accounting uses `max(reserved_usd, actual_usd)` for every attempt, preventing release, retry or delayed reconciliation from reopening already-exposed provider spend.
- All Vercel and Cloudflare callers return explicit HTTP 429 semantics on budget denial.

## Release order

The database change is expand-first and must precede runtime deployment:

1. apply the merged FASE 4E package catalog migration;
2. apply this additive provider-attempt ledger migration;
3. verify package lifecycle, functions, RLS, profile baselines and zero unexpected assignments/attempts;
4. deploy runtime callers;
5. run authenticated runtime certification from a separate verifier branch;
6. leave the verifier PR open, draft and unmerged.

The migration promotes `commercial_guarded:v1` from `DRAFT` to `ACTIVE` only after the budget ledger and privileged functions exist. Promotion makes the package assignable; it does not assign any profile.

Public prices, Stripe objects and customer subscription lifecycle remain outside FASE 4F.
