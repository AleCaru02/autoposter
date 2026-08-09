# Database

## Stato

**VALIDATO LOCALMENTE — 2026-08-09**

Supabase CLI + Docker ricostruiscono il database da zero. Nessuno dei due progetti Supabase cloud esistenti viene usato per questo SaaS.

## Comandi

```bash
supabase start
supabase db reset --local
supabase migration list --local
supabase db lint --local --level warning --fail-on error
supabase db advisors --local --type security
supabase db advisors --local --type performance
supabase test db --local
```

La procedura completa applicazione + API + web è in `LOCAL_E2E.md`.

## Migration history validata

1. `20260809193000_001_tenancy_foundation.sql`
2. `20260809194000_002_core_domain.sql`
3. `20260809195000_003_prompt_support_storage.sql`
4. `20260809200000_004_tenant_consistency.sql`
5. `20260809201000_005_quota_engine.sql`
6. `20260809202000_006_local_validation_fixes.sql`
7. `20260809203000_007_local_e2e_state.sql`
8. `20260809204000_008_auto_variant_scheduling.sql`

## Stato E2E aggiunto

Migration 007 introduce/persistisce:

- scheduling fields sui post;
- onboarding session;
- Brand Profile version history;
- learning insights;
- RLS/FK tenant-aware per i nuovi oggetti.

Migration 008 rende il percorso AUTO/MANUALE realmente per piattaforma: le varianti AUTO che superano QA vengono accodate indipendentemente dai MANUAL siblings, con idempotency key.

## Multi-tenancy

Il modello combina:

- `tenant_id`;
- RLS su tabelle applicative;
- `tenant_members` e ruoli;
- composite foreign keys `(tenant_id, id)` sulle relazioni sensibili;
- tabelle server-only senza grant client;
- `app_private` senza `USAGE` per `anon`/`authenticated`;
- test Auth reali con Tenant A/Tenant B.

La suite E2E-state verifica anche:

- onboarding A invisibile/non scrivibile da B;
- Brand Profile history non collegabile a parent cross-tenant;
- learning insights leggibili solo dal tenant;
- authenticated non può falsificare insight.

## `app_private`

Contiene materiale privileged come integration credentials e platform admin mapping. Il frontend non vi accede.

Il seed locale crea esclusivamente per test:

- `claim_local_platform_admin()`;
- una view service-role-only `platform_admins_local`.

Questi helper non sono migrations production-like.

## Quota engine

```text
reserve_tenant_usage
→ commit_tenant_usage
oppure
→ release_tenant_usage
```

Le RPC di mutazione sono server-only. Replay, limiti, contatori used/reserved e isolamento sono testati localmente.

## Publishing

Persistenza principale:

- `post_variants`;
- `publication_jobs`;
- `publication_attempts`;
- `published_posts`;
- `analytics_snapshots`;
- `editorial_memory`.

`publication_jobs.idempotency_key` è tenant-unique. Il mock provider salva external mock ID e gli stessi meccanismi di retry/reconciliation usati dal futuro adapter reale.

## AI / learning

- `ai_usage_events`: operazioni/token/work unit/costo teorico configurabile;
- `content_fingerprints`: dedup server-side;
- `feedback_events`: approve/reject/user edit;
- `learning_insights`: insight evidence-gated e server-written.

## Validazione CI finale

Workflow `.github/workflows/tenant-isolation.yml`:

- **8/8 migrations da zero: PASS**;
- migration history: PASS;
- DB lint: PASS, nessun errore;
- Security Advisors: PASS, nessuna issue;
- Performance Advisors: PASS, nessuna issue;
- pgTAP: **27/27 PASS**;
- Auth/RLS/quota/E2E-state: **3 file / 20 test PASS**.

## Da validare sul futuro remoto

Prima di beta/provider reali dovranno essere ripetuti migrations/history/advisors/Auth/RLS/Storage sul progetto Supabase dedicato. Fino ad allora questa verifica è intenzionalmente posticipata e non blocca lo sviluppo.
