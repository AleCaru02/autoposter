# MVP Status

Aggiornato: 2026-08-09

## VALIDATO LOCALMENTE

### Database / tenancy

- Supabase local development configurato con CLI + Docker (`supabase/config.toml`).
- Database ricostruibile da zero con `supabase start` + `supabase db reset --local`.
- 6 migrations applicate in ordine e presenti nella migration history locale.
- Seed locale deterministico con piano `local-dev` e knowledge fixture.
- `supabase db lint`: nessun errore di schema.
- Supabase Security Advisors locali: nessuna issue residua.
- Supabase Performance Advisors locali: nessuna issue residua.
- 20/20 test pgTAP superati.
- RLS attiva su tutte le tabelle applicative `public` verificate dal test strutturale.
- `app_private` non utilizzabile da `anon` o `authenticated`.
- `app_private.integration_credentials` non leggibile dal client e priva di colonne token/secret plaintext.
- `service_role` ha i grant server-side necessari senza estenderli ai ruoli client.
- Foreign key composte `(tenant_id, id)` verificate su relazioni sensibili.
- `vector` spostata fuori dallo schema `public` nello schema `extensions`.

### Tenant A / Tenant B

- Due utenti Auth locali creati realmente e autenticati con sessioni separate.
- Due tenant locali creati tramite `create_tenant`.
- SELECT/INSERT/UPDATE/DELETE cross-tenant verificati e bloccati.
- CRUD sulle proprie risorse verificato.
- Collegamenti FK cross-tenant con ID conosciuto/indovinato rifiutati.
- Tabelle service-only non scrivibili da `authenticated`.
- Contatori quota isolati tra tenant.

### Quota engine

- RPC di mutazione quota non eseguibili da `authenticated`.
- `reserve`, `commit` e `release` verificati con replay idempotente.
- Contatori `used`/`reserved` verificati.
- Superamento limite rifiutato.
- Isolamento quota tra tenant verificato.

### Core / contratti

- Architettura target e modello multi-tenant definiti.
- Contratti TypeScript strict + Zod per AI, quality score, SocialProvider e GBP Local Optimizer.
- Model router configurabile, error classifier e anti-duplicate implementati con test unitari.
- Facebook, Instagram, LinkedIn e Google Business Profile presenti nel provider model.
- Separazione chatbot pubblico / assistenza tenant definita.

### Runtime mock a costo zero

- npm workspaces configurato alla root del repository.
- `DeterministicAIOrchestratorMock` implementato.
- Decisione per canale `native_variant | separate_concept | skip`, incluso GBP locale e LinkedIn.
- `MockSocialProvider` per Facebook, Instagram, LinkedIn e Google Business Profile.
- Publishing mock idempotente con external post ID e analytics deterministici.
- `InMemoryPublicationScheduler` con deduplica enqueue, retry/dead state ed exactly-once mock.
- Website scanner con fetcher iniettato, same-origin, page limit, URL normalization e content hash.
- Chatbot pubblico separato dal resolver tenant-aware.
- Tenant support resolver isolato per tenant.
- Telegram approval mock con HMAC SHA-256, tenant/user binding, expiry e nonce one-time.
- CI `runtime`: typecheck strict PASS.
- CI `runtime`: **5 file / 15 test PASS**.

## DA VALIDARE SU SUPABASE REMOTO

Questi punti sono intenzionalmente rimandati e **non bloccano lo sviluppo locale**:

- Applicazione migrations su nuovo progetto Supabase dedicato.
- Confronto migration history locale/remota.
- Security/Performance Advisors remoti.
- Auth/RLS/Storage con chiavi reali.
- Signed URL ed Edge Functions reali.
- Secret management/cifratura token con secret remoto.
- OAuth Meta/Instagram/LinkedIn/Google Business Profile.
- Callback/webhook pubblici.
- Scheduler/Cron/Queues reali.
- Test beta/end-to-end pubblico.

Il progetto remoto verrà richiesto solo quando serve realmente per OAuth, callback pubblici, provider reali, beta tester/clienti o altro blocco non riproducibile localmente.

## IN SVILUPPO A COSTO ZERO

- Frontend architecture e typed service/mock layer.
- Onboarding.
- Dashboard.
- Brand Profile.
- Asset Library.
- Strategy e calendario editoriale.
- Post editor + approval inbox.
- Social Connections mock.
- Analytics mock.
- Admin panel e piani.
- Test frontend automatici.

## BLOCCATO MA NON CRITICO

- Lovable UI bootstrap: workspace ancora senza crediti disponibili al 2026-08-09. Nessun acquisto effettuato. Lo sviluppo GitHub continua senza Lovable.

## INTENZIONALMENTE POSTICIPATO

- Nuovo Supabase remoto dedicato.
- OAuth/provider social reali.
- OpenAI live.
- Telegram live.
- Stripe live.
- Vercel production deployment.

## PR

- Draft PR #1 aperta, aggiornata e intenzionalmente non mergeata.

## Definition of Done V1

La V1 sarà considerata completa solo dopo un futuro test end-to-end pubblico con due tenant isolati, generazione differenziata, approval, pubblicazione idempotente sui provider abilitati, external IDs e analytics reali. Database e runtime mock sono invece **VALIDATI LOCALMENTE**.
