# Testing

## Strategia

Durante lo sviluppo la foundation viene validata senza costi con tre livelli indipendenti:

1. Supabase CLI + Docker per schema/RLS/Auth/Data API;
2. runtime TypeScript deterministico per AI/social/scheduler/scanner/support/Telegram/onboarding/brand mock;
3. web app React/Vite con route smoke tests, strict typecheck e production build.

Nessun test CI pubblica sui social reali, usa token provider reali o modifica i progetti Supabase cloud esistenti.

## Database locale

Workflow: `.github/workflows/tenant-isolation.yml`.

Risultato validato 2026-08-09:

- 6/6 migrations da zero: PASS;
- migration history: PASS;
- schema lint: PASS — `No schema errors found`;
- Security Advisors: PASS — `No issues found`;
- Performance Advisors: PASS — `No issues found`;
- pgTAP: **20/20 PASS**;
- Auth/RLS/quota integration: **2 file / 17 test PASS**.

### Copertura RLS/Auth

I test creano utenti e tenant effimeri e coprono:

- owner vede solo il proprio tenant;
- SELECT/INSERT/UPDATE/DELETE cross-tenant;
- CRUD sulle risorse proprie;
- FK cross-tenant;
- `app_private` non esposto;
- entitlements tenant-scoped;
- quota server-only, idempotenza e limiti;
- `websites` come baseline CRUD;
- `brand_assets` e `posts` come contenuti editabili;
- `social_connections` come metadata owner/admin;
- `ai_usage_events` come tabella server-only;
- contatori quota tenant-scoped.

## Runtime mock

Workflow: `.github/workflows/runtime.yml`.

Risultato validato 2026-08-09:

- strict typecheck: PASS;
- **10 test file / 29 test PASS**.

Copertura:

- SocialProvider mock e publish idempotente;
- connection health e skip validation;
- scheduler dedupe/exactly-once/dead state;
- timeout-after-provider-success senza doppia pubblicazione;
- AI platform adaptation incl. GBP `skip` e LinkedIn `separate_concept`;
- anti-clone acceptance su 3 pizzerie + 3 property manager;
- approval manual/auto tenant-scoped;
- website scanner same-origin, page limit, URL normalization e hashing;
- chatbot pubblico senza tenant resolver;
- tenant support scope;
- Telegram HMAC, tenant/user binding, expiry e nonce one-time;
- onboarding provenance, conferme, lock, coverage e step gate;
- Brand Profile versioning, latest-only confirmation, locks e tenant-isolated history.

## Web app

Workflow: `.github/workflows/web.yml`.

Risultato validato 2026-08-09:

- route smoke tests: **5/5 PASS**;
- TypeScript strict typecheck: PASS;
- Vite production build: PASS.

Le route smoke verificano almeno:

- landing e chatbot pubblico senza tenant data;
- dashboard in modalità mock;
- post editor con `separate_concept`, quality gate, anti-duplicate e publishing safety;
- Google Business Profile nella pagina connessioni e OAuth mock;
- Admin con infrastruttura remota esplicitamente posticipata.

## Problemi realmente intercettati dalla CI

- `service_role` privo dei grant SQL espliciti necessari → migration 006;
- extension `vector` in `public` → spostata in `extensions`;
- tre policy RLS con `auth.uid()` non ottimizzato → corrette;
- migration correttiva fuori ordine → rinumerata e retestata;
- risoluzione monorepo contracts/zod errata → npm workspaces;
- Vite CSS side-effect type declaration mancante → `vite-env.d.ts`;
- stylesheet legacy con errore sintattico → sostituito e rimosso;
- smoke assertion non allineata al copy reale → corretta senza indebolire la safety assertion;
- Brand Profile versioning inizialmente lasciava due versioni non superseded → corretto a una sola versione corrente.

## Suite successiva a costo zero

- repository/service mock contract tests e rimozione fixture dirette dalle pagine;
- asset operations + usage references;
- website scanner redirect/error/coverage fixtures;
- knowledge retrieval più completo;
- accessibilità/keyboard checks frontend.

## Da ripetere su Supabase remoto

Quando verrà creato il progetto dedicato, la stessa suite database dovrà essere ripetuta contro l'ambiente remoto prima di beta/test pubblico. Fino a quel momento la validazione remota è intenzionalmente posticipata, non un blocco dello sviluppo.

## Production safety

I test automatici usano provider mock. Nessun test CI deve pubblicare sui social reali o usare token provider di produzione.
