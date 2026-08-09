# MVP Status

Aggiornato: 2026-08-09

## DONE

- Architettura target definita.
- GitHub repository identificato e branch `feat/saas-foundation` creato.
- Documentazione fondazione.
- ERD e modello multi-tenant definiti.
- Strategia AI Orchestrator + model routing definita.
- Provider model include Facebook, Instagram, LinkedIn e Google Business Profile.
- Separazione chatbot pubblico / assistenza tenant definita.

## IN PROGRESS

- Supabase migrations per tenancy/RLS/core domain.
- Contratti TypeScript condivisi.
- Tenant isolation test scaffolding.
- CI foundation.

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
- Publishing live.
- Analytics collection live.
- Stripe subscriptions.
- Production deployment.

## Definition of Done

La V1 sarà DONE solo dopo il test end-to-end definito nel product brief: due tenant isolati, generazione differenziata, approval Telegram, pubblicazione idempotente sui provider abilitati, external IDs e analytics.