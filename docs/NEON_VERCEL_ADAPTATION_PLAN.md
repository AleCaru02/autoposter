# Neon + Vercel adaptation plan (contingency only)

Status: **PIANO DI RISERVA — NON IMPLEMENTATO**

Questo documento descrive cosa cambierebbe passando da Supabase a Neon Free + Vercel Functions + Vercel Blob. Non autorizza alcuna riscrittura.

## Fattibilita'

Tecnicamente fattibile. Neon e' PostgreSQL, supporta pgvector, offre Neon Auth basato su Better Auth e una Data API basata su PostgREST. Il serverless driver e' compatibile con Vercel Functions. Questo riduce l'adattamento rispetto a un backend SQL costruito da zero, ma l'architettura corrente resta Supabase-native per `auth.users`, `auth.uid()`, ruoli API e Supabase Storage.

Vercel documenta Hobby come piano per uso personale/non commerciale. Vercel Functions/Blob Hobby possono quindi sostenere sviluppo e uso personale entro quota, ma non sono una base gratuita durevole per un SaaS commerciale.

Fonti ufficiali correnti:
- https://neon.com/pricing
- https://neon.com/docs/serverless/serverless-driver
- https://neon.com/docs/guides/row-level-security
- https://neon.com/docs/changelog/2025-12-12
- https://neon.com/docs/changelog/2026-03-06
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/vercel-blob/usage-and-pricing
- https://vercel.com/pricing

## Impatto sulle 12 migrations

Le 12 migrations sono circa 127 KB di SQL. **12/12 contengono almeno un accoppiamento Supabase** (ruoli `anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`, `storage.*` o configurazioni/advisor specifici). Questo NON significa riscrivere 127 KB: la maggioranza di tabelle, FK, indici, trigger, funzioni di dominio, `app_private`, quota engine, cost ledger e scheduler e' PostgreSQL portabile.

Mappa:

1. `001_tenancy_foundation`: forte accoppiamento a `auth.users`, `auth.uid()`, trigger su `auth.users` e ruoli Supabase. Tabelle tenant/piani/usage/audit sono portabili.
2. `002_core_domain`: dominio quasi tutto PostgreSQL; `vector` e' portabile; FK creator/approver verso `auth.users` e policy/ruoli richiedono adattamento.
3. `003_prompt_support_storage`: pgvector portabile; la parte `storage.buckets`/`storage.objects` e' Supabase-specific e va sostituita.
4. `004_tenant_consistency`: quasi tutti composite FK/triggers sono invariati; policy/grant verso `anon`/`authenticated` vanno adattati.
5. `005_quota_engine`: logica di quota/RPC e' portabile; grants `service_role` e policy `authenticated` vanno adattati. Neon Data API e' PostgREST-based, quindi le RPC Postgres possono restare un pattern valido dopo l'adattamento di auth/ruoli.
6. `006_local_validation_fixes`: e' la migration piu' Supabase-specific (service_role, auth.uid, advisor/extension schema); richiede una variante Neon.
7. `007_local_e2e_state`: onboarding/versioni/learning sono portabili; FK `auth.users` e grants/policy ruoli vanno adattati.
8. `008_auto_variant_scheduling`: trigger di scheduling portabile; grants service-role specifici da adattare.
9. `009_visual_asset_pipeline`: tabelle/constraint portabili; FK `auth.users`, grants/policy e `storage.buckets` richiedono adattamento.
10. `010_provider_staging_readiness`: la maggior parte del modello provider e' PostgreSQL; `auth.users` e grants/ruoli richiedono adattamento.
11. `011_billing_provider_readiness`: tabelle portabili; grants/policy ruoli Supabase da adattare. Stripe resterebbe comunque OFF.
12. `012_free_live_foundations`: budget, website resources, scheduler reconciliation e rate-limit tables sono portabili; `auth.users`, `auth.uid()` e ruoli Supabase vanno adattati.

## Auth / auth.users

Neon Auth corrente e' basato su Better Auth e conserva utenti/sessioni/configurazione/JWKS nel database, nello schema `neon_auth`; la tabella utenti e' `neon_auth.user`. Questo evita un provider Auth esterno, ma non e' schema-compatible con i FK gia' scritti verso `auth.users`.

Piano di adattamento se si scegliesse Neon:
1. usare Neon Auth come `IdentityProvider`;
2. scegliere tra FK diretti verso `neon_auth.user(id)` oppure una piccola tabella applicativa `identity_users` stabile; preferenza: adapter applicativo se vogliamo restare provider-neutral;
3. sostituire i FK `auth.users(id)` nelle migrations compatibili;
4. adattare il trigger di creazione profilo all'evento/record Neon Auth;
5. mantenere profiles, tenant_members, platform_admins e audit sopra un UUID utente stabile.

Non serve costruire da zero password/session/JWT: Neon Auth li gestisce realmente.

## JWT / RLS / auth.uid()

Postgres RLS resta disponibile. Neon Data API valida i JWT e offre `auth.user_id()`; il serverless driver consente anche di propagare claims verificati nella transaction e richiede un ruolo senza `BYPASSRLS`.

Piano minimo:
1. sostituire le policy/helper Supabase basate su `auth.uid()` con un helper provider-neutral che su Neon usa `auth.user_id()`;
2. ricreare i grants applicativi al posto dei ruoli Supabase `anon`, `authenticated`, `service_role`;
3. usare Data API per le operazioni client RLS-safe e Vercel Functions/serverless driver per operazioni privilegiate;
4. evitare `neondb_owner` nelle query utente perche' bypassa RLS;
5. rieseguire integralmente pgTAP e i test Tenant A/Tenant B.

Composite FK, tenant_id e gran parte dell'isolamento dati rimangono invariati.

## Data API / RPC

Neon Data API e' basata su PostgREST e supporta query HTTP su tabelle/view/funzioni. Questo significa che il modello `/rest/v1` dell'attuale repository non deve essere concettualmente riscritto: va sostituito il base endpoint/client e adattata autenticazione/RLS. Le RPC Postgres possono restare funzioni SQL esposte dalla Data API, previa verifica dei grants.

Questo e' un vantaggio importante rispetto a una riscrittura completa con ORM/API custom.

## Storage / signed URLs

La parte Supabase Storage non e' portabile direttamente.

Piano Vercel Blob:
1. mantenere le tabelle `brand_assets`, `post_assets`, `visual_renders` e i campi path/metadata;
2. aggiungere un adapter `ObjectStorage` (`put`, `getSignedRead`, `delete`, `listTenantPrefix`);
3. autorizzare upload/download in Vercel Functions dopo Auth + tenant membership;
4. usare path namespaced per tenant;
5. eliminare le policy su `storage.objects` e sostituirle con enforcement backend + audit;
6. usare private Blob/signed delivery dove necessario.

Qui c'e' la riscrittura infrastrutturale piu' netta: la sicurezza Storage passa da RLS Supabase a autorizzazione esplicita del backend.

## Backend / Edge Functions

All'application HEAD `501fd893...` non esiste una directory `supabase/functions/`, quindi non ci sono Edge Functions gia' deployate da portare. Il backend online deve ancora essere costruito in entrambi i percorsi.

Con Neon:
- Auth passerebbe da `/auth/v1/*` a Neon Auth SDK/API;
- `/rest/v1/*` e RPC possono essere sostituiti con Neon Data API/PostgREST con adattamento moderato;
- `/storage/v1/*` deve essere sostituito dall'adapter Vercel Blob;
- website scanner e operazioni privilegiate diventerebbero Vercel Functions.

Il file `apps/local-api/src/db.ts` resta uno dei principali touch point per il transport layer.

## app_private

`app_private` e' un normale schema PostgreSQL: puo' rimanere. Vanno ricreati grants e ruoli in modo che solo il backend privilegiato possa accedervi.

## pgvector

Neon supporta `pgvector`, quindi embeddings/vector columns possono essere mantenuti. Va verificata/installata l'estensione prevista dalla variante Neon delle migrations.

## Realtime

Non e' richiesto dal percorso minimo e nel codice applicativo corrente non e' una dipendenza necessaria per signup -> tenant -> scanner -> AI. Non deve bloccare il beta.

## Scheduler

Le tabelle persistenti `publication_jobs` restano portabili. L'esecutore cambierebbe. L'autopublishing e' esplicitamente fuori dal percorso minimo attuale.

## Admin

RBAC e tabelle Admin sono portabili. L'API Admin dovrebbe usare Neon Auth/JWT, membership/platform-admin DB e una Vercel Function con connessione server-only privilegiata.

## Complessita' relativa

Baseline Supabase collaboratore = **1x**.

Stima ingegneristica aggiornata Neon + Vercel = circa **1.8x-3x** lavoro infrastrutturale/integration per arrivare allo stesso E2E e allo stesso livello di sicurezza. Neon Auth + Data API riducono molto la riscrittura, ma restano:
- adattamento `auth.users` / identity FK;
- adattamento `auth.uid()` / ruoli e grants;
- Storage completamente diverso;
- layer Vercel Functions per scanner/admin/operazioni privilegiate;
- nuova validazione RLS/tenant isolation;
- vincolo contrattuale Vercel Hobby per uso personale/non commerciale.

Il dominio business non va riscritto.

## Condizione per scegliere Neon

Usare questo piano solo se la strada Supabase Free con collaboratore reale non e' disponibile o se si decide consapevolmente di uscire dalla piattaforma Supabase. Non implementarlo in parallelo: creerebbe due backend prima di avere un solo E2E reale funzionante.
