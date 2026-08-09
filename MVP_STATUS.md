# MVP Status

Aggiornato: 2026-08-09

## DONE

- Architettura target definita.
- Repository GitHub `AleCaru02/autoposter` scelto come base e branch `feat/saas-foundation` creato.
- Documentazione tecnica iniziale + integration registry ufficiale.
- ERD e modello multi-tenant definiti.
- Migration tenancy/RLS/plans/subscriptions/feature flags/audit scritta.
- Migration website/brand/assets/social metadata/content/publishing/analytics/memory scritta.
- Token social separati nello schema privato `app_private`, senza colonne plaintext esposte.
- Migration prompt registry/model routes/product knowledge/support/storage scritta.
- Coerenza relazionale cross-tenant rinforzata con foreign key composte `(tenant_id, id)`.
- Quota engine server-side con reservation/commit/release e idempotency key scritto.
- Contratti TypeScript strict + Zod per AI, quality score, SocialProvider e GBP Local Optimizer scritti.
- Harness integration test tenant isolation scritto.
- Strategia AI Orchestrator + model routing definita.
- Provider model include Facebook, Instagram, LinkedIn e Google Business Profile.
- Separazione chatbot pubblico / assistenza tenant definita.
- PR draft GitHub aperta per la Fase 1.

## IN PROGRESS

- Validazione esecutiva delle migrations su un Supabase dedicato/staging.
- Esecuzione reale tenant isolation test con due utenti Auth.
- CI typecheck: workflow presente ma non ancora eseguito sul branch/PR.
- Hardening del quota engine e test di concorrenza/idempotenza.

## BLOCKED

- Lovable UI bootstrap: workspace senza crediti disponibili al 2026-08-09.
- Nuovo Supabase dedicato: deve essere creato in una organizzazione Supabase scelta/approvata; non riuso progetti esistenti.
- OAuth Meta: richiede Meta App ID/Secret, redirect e App Review/permissions.
- LinkedIn live: richiede client credentials e accesso approvato alle API necessarie.
- Google Business Profile live: richiede progetto Google/GBP API access approvato e OAuth credentials.
- Telegram live: richiede bot token/webhook secret.
- Stripe live: intenzionalmente posticipato; piano assegnabile manualmente.

## NOT STARTED

- UI Lovable.
- OAuth reale.
- Website crawler live.
- OpenAI calls live.
- Deterministic graphic renderer.
- Queue/Cron worker live.
- Publishing live.
- Analytics collection live.
- Stripe subscriptions.
- Vercel production deployment.

## Definition of Done

La V1 sarà DONE solo dopo il test end-to-end definito nel product brief: due tenant isolati, generazione differenziata, approval Telegram, pubblicazione idempotente sui provider abilitati, external IDs e analytics.
