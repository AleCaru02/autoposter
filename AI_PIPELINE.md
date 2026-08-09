# AI Pipeline

## Pipeline

1. Load tenant context autorizzato.
2. Load brand profile + locked facts.
3. Load compact brand context.
4. Load strategy, editorial memory e recent posts rilevanti.
5. Seleziona pillar/topic.
6. Duplicate pre-screen.
7. Genera core concept strutturato.
8. Genera/adatta varianti per provider.
9. GBP Local Optimizer decide `reuse_adapted`, `separate_local_post` o `not_applicable`.
10. Visual Director sceglie asset reale, grafica deterministica o immagine AI.
11. QA/fact check con facts `CONFIRMED`, `INFERRED`, `UNKNOWN`.
12. Duplicate semantic/final screen.
13. Quality score.
14. Solo parti fallite vengono rigenerate quando possibile.
15. Approval AUTO/MANUALE per provider.
16. Schedule → queue → publish.
17. Analytics snapshots → optimizer con campione minimo.
18. Feedback aggregato aggiorna preferenze revisionabili.

## Moduli logici

- Brand Intelligence
- Market & Competitor Intelligence
- Content Strategist
- Topic Researcher
- Core Content Planner
- Copywriter
- Platform Optimizer
- Google Business Profile Local Optimizer
- Visual Director
- Graphic Composer
- QA / Fact Checker
- Anti-Duplicate
- Scheduler
- Analytics Optimizer
- Support Assistant
- SEO/Local Search Advisor (MVP+/Phase 2; usa sito + GBP, non deve moltiplicare chiamate per post)

## Cost control

- Model routing per task.
- Prompt prefix stabile per beneficiare del caching quando disponibile.
- Cache per scan/competitor/trend.
- `brand_context_compact` target indicativo 2k–5k token.
- Batch per classificazioni/tagging.
- Regeneration parziale.
- Budget soft/hard per tenant.
- Ogni chiamata crea `ai_usage_event` con task, model, token/costo stimato e correlation id.

## Structured outputs

Gli output backend sono validati tramite schema (Zod/JSON Schema). Vietato affidarsi a parsing fragile di testo libero per dati applicativi.