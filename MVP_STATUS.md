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
- Due utenti Auth e due tenant locali realmente separati.
- SELECT/INSERT/UPDATE/DELETE cross-tenant bloccati; CRUD proprio consentito.
- Foreign key composte tenant-aware verificate.
- `app_private` non utilizzabile da `anon`/`authenticated` e integration credentials non leggibili dal client.
- `service_role` dispone solo dei grant server-side necessari.
- `vector` vive nello schema `extensions`, non in `public`.

### Quota engine

- RPC di mutazione quota non eseguibili da `authenticated`.
- `reserve`, `commit` e `release` verificati con replay idempotente.
- Contatori `used`/`reserved`, limiti e isolamento tra tenant verificati.
- Integration Auth/RLS/quota baseline: **14/14 PASS**.

### Core / contratti

- TypeScript strict + Zod contracts.
- Model router configurabile.
- Error classifier e anti-duplicate deterministic core.
- SocialProvider per Facebook, Instagram, LinkedIn e Google Business Profile.
- GBP Local Optimizer con `native_variant | separate_concept | skip`.
- CI contracts/core verde.

### Runtime mock a costo zero

- npm workspaces configurato alla root.
- `DeterministicAIOrchestratorMock`.
- decisione per canale, incluso GBP/LinkedIn.
- `MockSocialProvider` sui quattro canali.
- publishing idempotente con external ID e analytics deterministici.
- `InMemoryPublicationScheduler` con deduplica, retry/dead ed exactly-once mock.
- timeout-after-provider-success recuperato tramite idempotency key senza doppia pubblicazione.
- `InMemoryApprovalWorkflow` tenant-scoped con modalità manual/auto, rejection reason e replay idempotente.
- anti-clone acceptance su 6 attività: 3 pizzerie + 3 property manager con topic/angle/hook/copy distinti oltre al semplice nome brand.
- website scanner con fetcher iniettato, same-origin, page limit, URL normalization e content hash.
- chatbot pubblico separato dal tenant support resolver.
- tenant support resolver scoped per tenant.
- Telegram approval mock con HMAC SHA-256, tenant/user binding, expiry e nonce one-time.
- CI runtime: typecheck strict PASS; **8 file / 21 test PASS**.

### Web app locale

- React/Vite/TypeScript strict in `apps/web`.
- service/mock boundary: i componenti non importano Supabase o SDK provider.
- landing pubblica + pricing + chatbot pubblico mock.
- login, registrazione e reset password shell, senza invio credenziali.
- app shell multi-tenant demo.
- onboarding con inferred/confirmed/lock e coverage mock.
- dashboard.
- Brand Profile.
- Asset Library.
- Strategy.
- calendario editoriale.
- post editor con core concept, varianti Instagram/Facebook/LinkedIn/GBP, `native_variant|separate_concept|skip`, visual brief, quality gate, fact confidence, anti-duplicate e safety publishing.
- approval inbox.
- Social Connections con health state e OAuth mock.
- Analytics chiaramente marcate mock.
- Notifications.
- support AI tenant-aware mock + handoff umano.
- billing/piano/quote senza checkout.
- settings e Admin panel.
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

- rendere più completo il typed frontend service layer e collegare le pagine ai repository mock invece che a fixture dirette;
- onboarding state machine + validazione form;
- Brand Profile editor/versioning mock;
- asset operations mock e referenze usage;
- website scanner coverage/error/redirect fixtures più ampie;
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
