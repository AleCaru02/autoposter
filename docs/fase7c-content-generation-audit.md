# FASE 7C — Content generation audit

Baseline audited: `main` at `8b84b6bf831162013074160c7e96d1109c0ed023`.

## Real call graph

1. Customer profile and brand context are read through profile-scoped RLS.
2. Manual text generation calls `POST /api/generate-text` with a Better Auth JWT and a stable logical operation id.
3. The Worker loads the selected profile, brand analysis and confirmed website pages, then reserves `ai.content.generate_text` before any AI provider call.
4. OpenAI text, research and fact-check technical events are persisted separately from the commercial unit; success commits one commercial unit and replay returns the cached result.
5. The customer can edit the generated copy and visual brief before saving `content_items` and profile-scoped `content_variants` in review state.
6. Review can call `POST /api/generate-image` for a persisted variant. The Worker reserves `ai.image.generate`, persists technical usage, saves an `assets` row and associates it with that exact variant.
7. Manual edits reset approval to `PENDING`; approval derives and persists the parent content status.

## Capability classification at baseline

| Capability | Baseline | Evidence |
| --- | --- | --- |
| Automatic text and image generation | INTEGRATION_PASS | Canonical Autopilot runtime, metering and persistence exist; no production content rows were present during the audit. |
| Manual text generation endpoint | INTEGRATION_PASS | Guarded endpoint and tests existed, but there was no customer callsite. |
| Manual customer creation flow | NOT_READY | The Content page only configured Autopilot; `saveGeneratedContent` had no caller. |
| Manual editing and approval | INTEGRATION_PASS | Profile-scoped edit, autosave, image generation and approval are connected in Revisioni. |
| POST | INTEGRATION_PASS | Text schema, image size and persistence are implemented. |
| STORY | INTEGRATION_PASS | Vertical image format, copy schema and persistence are implemented. |
| CAROUSEL | PARTIAL | The label is accepted by text/image APIs, but the data model holds one image asset per variant and has no ordered multi-slide persistence. It must not be presented as a completed customer format. |
| Instagram/Facebook/LinkedIn/GBP preparation | INTEGRATION_PASS | All four providers are accepted by generation; generation is independent of OAuth connection state. GBP publishing remains externally blocked. |

## Gap closed by this product change

The Content page now provides the missing manual path: topic and optional objective, one or more target socials, supported format, AI generation, editable variants, persistence, then a direct transition to image generation and approval. Customer errors translate capability, limit, duplicate and metering states into non-technical language.

No Auth, RLS, database schema, provider connection or publishing behavior is changed.
