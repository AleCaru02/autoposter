# Neon + Vercel adaptation plan (contingency only)

Status: **PIANO DI RISERVA — NON IMPLEMENTATO**

Questo documento descrive cosa cambierebbe passando da Supabase a Neon Free + Vercel Functions + Vercel Blob. Non autorizza alcuna riscrittura.

## Fattibilita'

Tecnicamente fattibile. Neon e' PostgreSQL e supporta pgvector; Vercel Functions puo' collegarsi a Neon con driver/serverless pooling. Tuttavia l'architettura corrente e' intenzionalmente Supabase-native per Auth, PostgREST/RPC e Storage.

Inoltre Vercel documenta Hobby come piano per uso personale/non commerciale. Questo rende Vercel Functions/Blob Hobby accettabile per sviluppo personale, ma non una base gratuita durevole per un SaaS commerciale.

Fonti ufficiali correnti:
- https://neon.com/pricing
- https://neon.com/docs/serverless/serverless-driver
- https://neon.com/docs/extensions/pgvector
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
5. `005_quota_engine`: logica di quota/RPC e' portabile; grants `service_role` e policy `authenticated` vanno adattati.
6. `006_local_validation_fixes`: e' la migration piu' Supabase-specific (service_role, auth.uid, advisor/extension schema); richiede una variante Neon.
7. `007_local_e2e_state`: onboarding/versioni/learning sono portabili; FK `auth.users` e grants/policy ruoli vanno adattati.
8. `008_auto_variant_scheduling`: trigger di scheduling portabile; grants service-role specifici da adattare.
9. `009_visual_asset_pipeline`: tabelle/constraint portabili; FK `auth.users`, grants/policy e `storage.buckets` richiedono adattamento.
10. `010_provider_staging_readiness`: la maggior parte del modello provider e' PostgreSQL; `auth.users` e grants/ruoli richiedono adattamento.
11. `011_billing_provider_readiness`: tabelle portabili; grants/policy ruoli Supabase da adattare. Stripe resterebbe comunque OFF.
12. `012_free_live_foundations`: budget, website resources, scheduler reconciliation e rate-limit tables sono portabili; `auth.users`, `auth.uid()` e ruoli Supabase vanno adattati.

## Auth / auth.users

Neon Auth e' basato su Better Auth e conserva dati Auth nel database Neon, ma non dobbiamo rendere il dominio dipendente dalla forma interna di una seconda implementazione Auth.

Piano di adattamento consigliato se si scegliesse Neon:
1. introdurre un adapter `IdentityProvider` server-side;
2. creare una tabella applicativa `identity_users` con UUID applicativo stabile;
3. mappare l'identita' autenticata del provider a `identity_users`;
4. sostituire gradualmente i FK `auth.users(id)` con `identity_users(id)`;
5. mantenere profiles, tenant_members, platform_admins e audit sopra quell'ID applicativo.

Questo evita di legare le migrations alle tabelle interne di Neon Auth/Better Auth.

## JWT / RLS / auth.uid()

Postgres RLS resta disponibile su Neon. Cambia il modo in cui l'identita' arriva nella sessione DB.

Piano:
1. Vercel Function verifica il JWT Neon Auth;
2. connessione DB con un ruolo che **non** abbia `BYPASSRLS`;
3. claims/user-id vengono propagati alla sessione/transaction DB;
4. introdurre `app.current_user_id()` come helper provider-neutral;
5. sostituire `auth.uid()` con `app.current_user_id()`;
6. ricreare ruoli/grants applicativi al posto di `anon`, `authenticated`, `service_role`;
7. rieseguire tutti i test Tenant A/Tenant B e pgTAP.

L'isolamento tenant basato su RLS e composite FK puo' quindi essere conservato, ma va nuovamente validato end-to-end.

## Storage / signed URLs

La parte Supabase Storage non e' portabile direttamente.

Piano Vercel Blob:
1. mantenere le tabelle `brand_assets`, `post_assets`, `visual_renders` e i campi path/metadata;
2. aggiungere un adapter `ObjectStorage` (`put`, `getSignedRead`, `delete`, `listTenantPrefix`);
3. autorizzare upload/download in Vercel Functions dopo JWT + tenant membership;
4. usare path namespaced per tenant;
5. eliminare le policy su `storage.objects` e sostituirle con enforcement backend + audit;
6. usare private Blob/signed delivery dove necessario.

La sicurezza storage passerebbe quindi da RLS nel database a autorizzazione esplicita del backend: e' piu' codice da mantenere e testare.

## Backend / Edge Functions

All'HEAD `501fd893...` non esiste una directory `supabase/functions/`, quindi non ci sono Edge Functions gia' deployate da portare. Il backend online deve ancora essere costruito in entrambi i percorsi.

Con Neon il backend diventerebbe Vercel Functions e dovrebbe sostituire il client attuale che oggi parla direttamente con endpoint Supabase:
- `/auth/v1/*`
- `/rest/v1/*`
- `/rest/v1/rpc/*`
- `/storage/v1/*`

Il file `apps/local-api/src/db.ts` mostra questo accoppiamento e sarebbe uno dei touch point principali.

## app_private

`app_private` e' un normale schema PostgreSQL: puo' rimanere. Vanno ricreati grants e ruoli in modo che solo il backend privilegiato possa accedervi.

## pgvector

Neon supporta `pgvector`, quindi embeddings/vector columns possono essere mantenuti. Va solo verificato lo schema/extension target usato dalle migrations Neon.

## Realtime

Non e' richiesto dal percorso minimo e nel codice applicativo corrente non e' una dipendenza necessaria per signup -> tenant -> scanner -> AI. Se diventera' necessario verra' progettato separatamente; non deve bloccare il beta.

## Scheduler

Le tabelle persistenti `publication_jobs` restano portabili. L'esecutore cambierebbe. Vercel Hobby ha vincoli propri sui cron e, comunque, l'autopublishing e' esplicitamente fuori dal percorso minimo attuale.

## Admin

RBAC e tabelle Admin sono portabili. L'API Admin dovrebbe essere implementata in Vercel Functions usando JWT verificato, membership/platform-admin DB e un ruolo server-only.

## Complessita' relativa

Baseline Supabase collaboratore = **1x**.

Neon + Vercel = circa **2.5x-4x** lavoro backend/integration per arrivare allo stesso livello di sicurezza, perche' richiede contemporaneamente:
- nuovo adapter Auth;
- bridge identita';
- variante RLS/JWT;
- nuovo transport DB al posto di PostgREST/RPC;
- nuovo storage authorization layer;
- nuove verifiche security/tenant isolation;
- deployment Vercel Functions.

Il dominio business non va riscritto, ma il boundary infrastrutturale si'.

## Condizione per scegliere Neon

Usare questo piano solo se la strada Supabase Free con collaboratore reale non e' disponibile o se si decide consapevolmente di uscire dalla piattaforma Supabase. Non implementarlo in parallelo: creerebbe due backend prima di avere un solo E2E reale funzionante.
