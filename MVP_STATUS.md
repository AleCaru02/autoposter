# MVP Status

Aggiornato: 2026-08-09

## VALIDATO LOCALMENTE

### Database / tenancy

- Supabase local development configurato con CLI + Docker (`supabase/config.toml`).
- Database ricostruibile da zero con `supabase start` + `supabase db reset --local`.
- 6 migrations applicate in ordine e presenti nella migration history locale.
- Seed locale deterministico con piano `local-dev` e knowledge fixture.
- `supabase db lint`: nessun errore di schema.
- Security Advisors locali: nessuna issue residua.
- Performance Advisors locali: nessuna issue residua.
- pgTAP: **20/20 PASS**.
- Integration Auth/RLS/quota: **2 file / 17 test PASS**.
- Due utenti Auth e due tenant locali realmente separati.
- SELECT/INSERT/UPDATE/DELETE cross-tenant bloccati; CRUD proprio consentito.
- RLS estesa verificata su `websites`, `brand_assets`, `posts`, `social_connections`, `ai_usage_events` e quota counters.
- Tre classi di policy validate: contenuti editabili, metadata owner/admin, tabelle server-only.
- Foreign key composte tenant-aware verificate.
- `app_private` non utilizzabile da `anon`/`authenticated` e integration credentials non leggibili dal client.
- `service_role` dispone solo dei grant server-side necessari.
- `vector` vive nello schema `extensions`, non in `public`.

### Quota engine

- RPC di mutazione quota non eseguibili da `authenticated`.
- `reserve`, `commit` e `release` verificati con replay idempotente.
- Contatori `used`/`reserved`, limiti e isolamento tra tenant verificati.

### Core / contratti

- TypeScript strict + Zod contracts.
- Model router configurabile.
- Error classifier e anti-duplicate deterministic core.
- SocialProvider per Facebook, Instagram, LinkedIn e Google Business Profile.
- GBP Local Optimizer con `native_variant | separate_concept | skip`.
- CI contracts/core verde.

### Runtime mock a costo zero

- npm workspaces configurato alla root.
- `DeterministicAIOrchestratorMock` con decisione per canale, incluso GBP/LinkedIn.
- `MockSocialProvider` sui quattro canali.
- publishing idempotente con external ID e analytics deterministici.
- `InMemoryPublicationScheduler` con deduplica, retry/dead ed exactly-once mock.
- timeout-after-provider-success recuperato tramite idempotency key senza doppia pubblicazione.
- `InMemoryApprovalWorkflow` tenant-scoped con manual/auto, rejection reason e replay idempotente.
- anti-clone acceptance su 6 attività: 3 pizzerie + 3 property manager con topic/angle/hook/copy distinti.
- website scanner con fetcher iniettato, same-origin, page limit, URL normalization e content hash.
- chatbot pubblico separato dal tenant support resolver.
- tenant support resolver scoped per tenant.
- Telegram approval mock con HMAC SHA-256, tenant/user binding, expiry e nonce one-time.
- onboarding state machine con provenance, inferred/confirmed, lock, coverage e gate tra step.
- Brand Profile versioning con una sola versione corrente, history tenant-scoped e lock persistenti tra versioni.
- CI runtime: typecheck strict PASS; **10 file / 29 test PASS**.

### Web app locale

- React/Vite/TypeScript strict in `apps/web`.
- service/mock boundary: i componenti non importano Supabase o SDK provider.
- landing pubblica + pricing + chatbot pubblico mock.
- login, registrazione e reset password shell, senza invio credenziali.
- app shell multi-tenant demo.
- onboarding con inferred/confirmed/lock e coverage mock.
- dashboard, Brand Profile, Asset Library, Strategy, calendario editoriale.
- post editor con core concept, varianti Instagram/Facebook/LinkedIn/GBP, `native_variant|separate_concept|skip`, visual brief, quality gate, fact confidence, anti-duplicate e safety publishing.
- approval inbox, Social Connections, Analytics, Notifications, support, billing, settings e Admin.
- `SOCIAL_PUBLISHING_ENABLED=false` mostrato e mantenuto come default di sicurezza.
- CI web: **5/5 route smoke tests PASS**, TypeScript PASS, production build Vite PASS.

## DA VALIDARE SU SUPABASE REMOTO

Intenzionalmente rimandato e **non bloccante durante lo sviluppo locale**:

- applicazione migrations sul futuro progetto Supabase dedicato;
- migration history locale/remota;
- Security/Performance Advisors remoti;
- Auth/RLS/Storage con chiavi reali;
- Signed URL ed Edge Functions reali;
- secret management/cifratura token con secret remoto;
- OAuth Meta/Instagram/LinkedIn/Google Business Profile;
- callback/webhook pubblici;
- Scheduler/Cron/Queues reali;
- beta/end-to-end pubblico.

Il Supabase remoto dedicato verrà richiesto solo quando OAuth, callback pubblici, provider reali, beta tester/clienti o un altro blocco non riproducibile localmente lo renderanno indispensabile.

## PROSSIMI BLOCCHI A COSTO ZERO

- collegare le pagine ai repository/service mock tipizzati invece che a fixture dirette;
- asset operations mock e referenze usage;
- website scanner redirect/error/coverage fixtures più ampie;
- support/knowledge retrieval mock più completo;
- accessibilità e visual QA frontend;
- documentazione operativa per passaggio mock → provider reali.

## BLOCCATO MA NON CRITICO

- Lovable UI bootstrap: workspace ancora senza crediti disponibili al 2026-08-09. Nessun acquisto effettuato e nessun ulteriore tentativo eseguito. GitHub resta source of truth.

## INTENZIONALMENTE POSTICIPATO

- nuovo Supabase remoto dedicato;
- OAuth/provider social reali;
- OpenAI live;
- Telegram live;
- Stripe live;
- Vercel production deployment.

## PR

- Draft PR #1 aperta e intenzionalmente non mergeata.

## Definition of Done V1

La V1 richiederà un futuro test end-to-end pubblico con due tenant isolati, generazione differenziata, approval, pubblicazione idempotente sui provider abilitati, external IDs e analytics reali. Database, runtime mock e shell web sono già **VALIDATI LOCALMENTE**.
