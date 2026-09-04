# FASE 4C — brand.analyze metering

## Effective call graph

- UI: `src/pages/onboarding-page.tsx` calls `POST /api/website-scan`, then `POST /api/onboarding-analyze`.
- Cloudflare production: `cloudflare/entry.ts` routes to `cloudflare/onboarding-analyze.ts`.
- Vercel serverless: `api/onboarding-analyze.ts`.
- Shared provider boundary: `api/_lib/brand-analysis.ts#analyzeBrandFromWebsite`.
- `cloudflare/worker.ts` is not the production entrypoint for this route; `wrangler.jsonc` points to `cloudflare/entry.ts`, which intercepts the route before the legacy fallback.

## Commercial and technical units

One successful analysis of one persisted website scan is one logical unit of `brand.analyze`.
The current provider boundary performs one OpenAI Responses call and has no provider subcalls.
The technical event remains `ANALYZE_BRAND_ONBOARDING` with tokens and estimated USD cost.

## Enforcement order

`profile/scan tenant validation → entitlement reserve → provider → technical usage → brand/profile persistence → cached result → logical commit`.

Failures before commit release the reservation. A committed duplicate for the same profile and scan returns the cached result without a provider replay or extra logical usage. A concurrent duplicate fails closed with `BRAND_ANALYSIS_IN_PROGRESS`. Limits and reservations are server-derived; the client cannot supply entitlement state, remaining quota, quantity, or the idempotency key.
