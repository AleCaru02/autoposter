# MVP Status

Aggiornato: 2026-08-09

## VALIDATO LOCALMENTE

### Database / tenancy

- Supabase local development configurato con CLI + Docker (`supabase/config.toml`).
- Database ricostruibile da zero con `supabase start` + `supabase db reset --local`.
- 6 migrations applicate in ordine e presenti nella migration history locale:
  1. tenancy/RLS/plans/subscriptions/feature flags/audit;
  2. website/brand/assets/social/content/publishing/analytics/memory;
  3. prompt registry/model routes/product knowledge/support/storage;
  4. foreign key composte e consistenza multi-tenant;
  5. quota engine reservation/commit/release;
  6. hardening rilevato dalla validazione locale.
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
- Tenant A non può leggere righe di Tenant B.
- Tenant A non può inserire risorse attribuite a Tenant B.
- Tenant A non può modificare o eliminare righe di Tenant B.
- Tenant A può eseguire CRUD sulle proprie risorse.
- Collegamenti FK cross-tenant con ID conosciuto/indovinato vengono rifiutati.
- Tabelle server-only, ad esempio `publication_jobs`, non sono scrivibili da `authenticated`.
- Contatori quota di Tenant B non sono visibili a Tenant A.

### Quota engine

- `authenticated` non può chiamare direttamente le RPC di mutazione quota.
- `service_role` può riservare quota.
- `reserve` idempotente verificato.
- `release` idempotente verificato.
- `commit` idempotente verificato.
- Contatori `used`/`reserved` verificati dopo release e commit.
- Superamento del limite configurato correttamente rifiutato.
- Isolamento quota tra tenant verificato.

### Codice / contratti

- Architettura target e modello multi-tenant definiti.
- Contratti TypeScript strict + Zod per AI, quality score, SocialProvider e GBP Local Optimizer.
- Model router configurabile, error classifier e anti-duplicate implementati con test unitari.
- Facebook, Instagram, LinkedIn e Google Business Profile presenti nel provider model.
- Separazione chatbot pubblico / assistenza tenant definita.
- PR draft #1 aperta e intenzionalmente non mergeata.

## DA VALIDARE SU SUPABASE REMOTO

Questi punti sono intenzionalmente rimandati. **Non sono un blocco per lo sviluppo locale.**

- Applicazione delle migrations su un nuovo progetto Supabase dedicato.
- Confronto migration history locale/remota.
- Security/Performance Advisors del progetto remoto.
- Auth/RLS con chiavi reali del progetto remoto.
- Storage/Signed URL sul progetto remoto.
- Edge Functions reali.
- Secret management e cifratura token con secret remoto.
- OAuth reali Meta/Instagram/LinkedIn/Google Business Profile.
- Callback/webhook pubblici e redirect URL reali.
- Scheduler/Cron/Queues reali.
- Test beta/end-to-end pubblico.

Il progetto remoto verrà richiesto solo quando serve realmente per OAuth, callback pubblici, provider reali, beta tester/clienti o altro blocco non riproducibile localmente.

## IN SVILUPPO A COSTO ZERO

- Frontend architecture e service/mock layer.
- Onboarding.
- Dashboard.
- Brand Profile.
- Asset Library.
- Strategy e calendario editoriale.
- Post editor + approval inbox.
- Social Connections mock.
- Analytics mock.
- Admin panel e piani.
- AI Orchestrator senza chiamate provider reali.
- Website scanner/mock ingestion.
- Social adapters mock.
- Scheduler mock.
- Telegram approval flow mock.
- Chatbot + product knowledge mock.
- Test automatici CI.

## BLOCCATO MA NON CRITICO

- Lovable UI bootstrap: workspace ancora senza crediti disponibili al 2026-08-09. Nessun acquisto effettuato. Lo sviluppo GitHub può continuare senza Lovable.

## INTENZIONALMENTE POSTICIPATO

- Nuovo Supabase remoto dedicato.
- OAuth/provider social reali.
- OpenAI live.
- Telegram live.
- Stripe live.
- Vercel production deployment.

## Definition of Done V1

La V1 sarà considerata completa solo dopo il successivo test end-to-end pubblico con due tenant isolati, generazione differenziata, approval, pubblicazione idempotente sui provider abilitati, external IDs e analytics reali. La foundation database, invece, è **VALIDATA LOCALMENTE**.
