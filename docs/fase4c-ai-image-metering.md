# FASE 4C — AI image generation metering

`ai.image.generate` is charged as one logical unit for one image-generation operation. The unit is profile-scoped and reserved before either OpenAI provider call.

| Path | Source | Logical identity | Product persistence |
|---|---|---|---|
| `POST /api/generate-image` | `MANUAL` | caller operation ID + stable request fingerprint | generated asset and optional content-variant link |
| content Autopilot | `AUTOPILOT` | profile + provider + scheduled slot + variant | generated asset and content-variant link |

One successful logical unit can create two technical cost events: `AGENT_MEDIA_MANAGER` for visual direction and `GENERATE_SOCIAL_IMAGE` for `gpt-image-2` pixel generation.

The logical reservation is committed only after technical usage and product output are durable. Provider, technical-ledger, asset, or link failures release the logical unit. Technical events carry the logical usage-event ID and are retried idempotently; an outbox remains on the logical event if all immediate ledger writes fail.

Completed duplicates return the cached product reference without another provider call or logical charge. Concurrent duplicates fail closed while the first request is in progress. Profile lookup, variant lookup, capability usage, technical events, assets, and variant updates are profile-scoped.
