# FASE 7D — Content review and approval

## Audit finding

The customer review UI used separate Data API updates for the variant approval
state and the aggregate `content_items.status`. A failed or concurrent request
could therefore leave the parent and variant inconsistent. An autosave racing an
approval could also restore the variant to `PENDING`.

## Product contract

- `POST /api/content-review` is the only customer UI path for saving a reviewed
  variant or changing its approval state.
- The Worker verifies the same-origin Better Auth JWT and resolves the active,
  non-banned identity server-side.
- `review_content_variant` verifies exact profile ownership, locks the scoped
  variant and rejects a stale `updated_at` value.
- Variant fields, approval state and aggregate content state change in one
  database transaction. The existing calendar trigger synchronizes future jobs
  in that same transaction.
- A direct Data API transition by `authenticated` to `APPROVED` or
  `CHANGES_REQUESTED` is rejected. The privileged function is not executable by
  `PUBLIC` or `authenticated`.
- No social provider, publishing operation, AI metering or entitlement behavior
  is changed by this phase.
