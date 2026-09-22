# SaaS commercial continuation

## Scope

Post Automatici remains one multi-tenant product. The current release is personal-use first: the first real CUSTOMER tenant uses the same user → app_user → profile/workspace → OWNER membership → package → entitlements → usage → capabilities architecture that future paying customers will use.

Do not introduce a personal-only code path, identity-based bypass, RLS bypass, entitlement bypass, or usage bypass.

## Preserve before commercial launch

The following foundations must remain compatible and must not be replaced when commercial work starts:

- Better Auth identities and session model;
- CUSTOMER, OWNER and SUPER_ADMIN separation;
- multi-tenant profiles/workspaces and memberships;
- RLS / FORCE RLS and server-side authorization;
- entitlement packages and capability registry;
- usage/metering and provider-cost budgets;
- social-provider tenant isolation;
- DEMO_PERSISTENT and QA_EPHEMERAL separation;
- Analytics and Learning data-origin separation;
- existing admin/audit infrastructure.

## Commercial work intentionally deferred

The personal product does not require these items to be completed now. Before selling Post Automatici to external customers, implement and verify them in this order:

1. **Stripe** — production Stripe account/configuration and server-side customer mapping.
2. **Checkout** — authenticated checkout flow that cannot assign packages client-side.
3. **Webhooks** — signed, idempotent Stripe webhook ingestion with replay protection.
4. **Subscriptions** — durable subscription state mapped to package/version without rewriting the entitlement engine.
5. **Pricing** — final commercial packages, limits, provider-cost economics and public prices.
6. **Billing UI** — customer-visible plan, renewal state, payment method and subscription controls.
7. **Invoices** — invoice history and links sourced from Stripe, not synthetic local records.
8. **Failed payments** — dunning state, grace periods, entitlement behavior and recovery flow.
9. **Upgrade / downgrade** — safe package transitions, proration rules and usage-limit semantics.
10. **Public signup** — customer self-service registration and workspace creation only after the billing path is ready.
11. **Legal / privacy** — privacy policy, terms, data-processing/legal review, retention and account-deletion policy.
12. **Landing** — public commercial positioning and conversion flows.
13. **SEO** — commercial indexing, structured metadata, sitemap and acquisition content only after the offer is final.
14. **Support** — support channel, incident handling, account recovery and billing-support procedures.

## Stripe integration contract

Future Stripe integration should attach to the existing package engine:

Stripe customer
→ subscription
→ package/version assignment
→ entitlements
→ limits
→ usage
→ capabilities

Stripe must not become the authorization source of truth inside product features. Product authorization remains server-side through the existing tenant, package, entitlement and usage contracts.

## Release rule

Commercial work starts only after the personal product is stable and verified. Existing commercial scaffolding may remain dormant in the meantime, but must not be deleted merely because it is not required for personal use.
