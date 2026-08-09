# Architecture

## Stato

La V1 locale è strutturata per funzionare senza infrastruttura cloud aggiuntiva durante lo sviluppo.

```text
React/Vite web app
  ↓ localhost HTTP
Local E2E API
  ├─ Auth/session + tenant/role guard
  ├─ website scanner
  ├─ Brand Profile/versioning/locks
  ├─ strategy + calendar planner
  ├─ deterministic AI runtime
  ├─ anti-duplicate server-side
  ├─ approval + scheduler
  ├─ mock social providers
  ├─ analytics + learning
  └─ AI cost ledger
  ↓
Supabase CLI + Docker
  ├─ Auth
  ├─ PostgreSQL 17
  ├─ RLS
  ├─ app_private
  └─ Storage locale
```

## Browser/server boundary

Le normali operazioni cliente passano con token Auth e RLS. Il browser non possiede `service_role`, social secret o accesso a `app_private`.

Il local API usa `service_role` soltanto per workload che anche in produzione saranno trusted server-side: publishing jobs/attempts, cross-tenant fingerprints, analytics ingest, AI usage e learning writes. Prima delle operazioni tenant verifica membership/ruolo.

## Flusso E2E validato

```text
registration/login
→ tenant
→ onboarding
→ website scan
→ Brand Profile DRAFT/REVIEW/CONFIRMED + locks
→ goals/target/social/frequency/AUTO-MANUALE
→ strategy
→ calendar
→ core concept
→ platform variants
→ anti-duplicate
→ quality gate
→ per-platform approval branch
→ scheduler/idempotency
→ mock provider
→ published_posts/external_mock_id
→ analytics snapshot
→ editorial memory
→ evidence-gated learning
```

Il workflow `.github/workflows/local-e2e.yml` avvia Supabase, local API, Vite e Chromium da un runner pulito e percorre questo flusso.

## AUTO / MANUALE per piattaforma

La preferenza vive sulla connessione/variante. Una variante AUTO che supera QA entra in coda indipendentemente da una variante MANUALE della stessa campagna. La migration 008 implementa questa separazione a livello DB con idempotency key per variante.

## Runtime AI/logico

Il runtime TypeScript mantiene moduli logici, non microservizi:

- website/brand intelligence;
- strategy planner;
- core content planner;
- platform optimizer;
- Google Business Profile local planner;
- QA/fact confidence;
- anti-duplicate/anti-clone;
- approval workflow;
- scheduler/publishing;
- analytics optimizer;
- learning;
- support/knowledge;
- AI cost ledger.

Il mock è deterministico ma differenzia output per tenant, topic/correlation e piattaforma.

## Social providers

`SocialProvider` è il boundary comune per Instagram, Facebook, LinkedIn e Google Business Profile. Il mock implementa health state, publish, idempotency, external ID e analytics senza chiamare provider reali.

GBP è un canale distinto: il planner decide `native_variant`, `separate_concept` o `skip`; non viene forzato su ogni concept.

## Frontend

`apps/web` usa service boundary tipizzato. Con `VITE_LOCAL_API_URL` attivo dialoga con local API/database; senza variabile mantiene un fallback mock isolato per smoke test.

Route operative: dashboard, onboarding, Brand Profile, Strategy, Calendar, Post Editor, `/approvals`, Connections, Analytics/Learning, Support, Billing/Cost ledger, Settings e Admin.

## Admin

RBAC platform-admin separato dai ruoli tenant. Il bootstrap del primo admin esiste esclusivamente nel seed locale e non nelle migrations destinate al futuro remoto.

## Evoluzione remota

Quando serviranno OAuth/provider reali:

```text
Vercel web
→ server/Edge Functions
→ Supabase remoto dedicato
→ OpenAI/provider reali
```

La foundation locale non richiede Redis, Kafka, microservizi o database aggiuntivi.
