# Testing

## Strategia

Durante lo sviluppo la foundation viene validata senza costi con tre livelli indipendenti:

1. Supabase CLI + Docker per schema/RLS/Auth/Data API;
2. runtime TypeScript deterministico per AI/social/scheduler/scanner/support/Telegram mock;
3. web app React/Vite con route smoke tests, strict typecheck e production build.

Nessun test CI pubblica sui social reali, usa token provider reali o modifica i progetti Supabase cloud esistenti.

## Database locale

Workflow: `.github/workflows/tenant-isolation.yml`.

Sequenza:

1. installa Supabase CLI;
2. `supabase start`;
3. `supabase db reset --local`;
4. migration history;
5. `supabase db lint`;
6. Security Advisors;
7. Performance Advisors;
8. pgTAP;
9. chiavi effimere dello stack locale;
10. due utenti Auth locali;
11. test Tenant A/Tenant B e quota;
12. distruzione stack senza backup.

Risultato validato 2026-08-09:

- 6/6 migrations da zero: PASS;
- migration history: PASS;
- schema lint: PASS — `No schema errors found`;
- Security Advisors: PASS — `No issues found`;
- Performance Advisors: PASS — `No issues found`;
- pgTAP: **20/20 PASS**;
- Auth/RLS/quota integration: **14/14 PASS**.

### pgTAP

`supabase/tests/database_security.test.sql` verifica:

- RLS sulle tabelle applicative `public`;
- isolamento `app_private`;
- integration credentials non leggibili dal client;
- assenza colonne token/secret plaintext;
- foreign key tenant-aware;
- quota RPC non eseguibili da `authenticated`;
- quota RPC disponibili a `service_role`;
- grant server-side necessari;
- `publication_jobs` non scrivibile dal client;
- bucket privati;
- migration history;
- `vector` fuori da `public`;
- seed e policy plans.

### Tenant A / Tenant B

`tests/integration/tenant-isolation.test.ts` verifica:

- owner vede solo il proprio tenant;
- SELECT A → B = zero righe;
- INSERT con `tenant_id` B rifiutato;
- CRUD proprio;
- UPDATE/DELETE A → B senza modifiche;
- FK cross-tenant rifiutata;
- service-only tables protette;
- `app_private` non esposto;
- read anon solo risorse pubbliche intenzionali;
- entitlements tenant-scoped;
- client non può riservare quota;
- `reserve → replay → release → replay`;
- `reserve → commit → replay`;
- quota limit e contatori isolati.

## Runtime mock

Workflow: `.github/workflows/runtime.yml`.

Risultato validato 2026-08-09:

- strict typecheck: PASS;
- **5 test file / 15 test PASS**.

Copertura:

- SocialProvider mock e publish idempotente;
- connection health e skip validation;
- scheduler dedupe/exactly-once/dead state;
- AI platform adaptation incl. GBP `skip` e LinkedIn `separate_concept`;
- website scanner same-origin, page limit, URL normalization e hashing;
- chatbot pubblico senza tenant resolver;
- tenant support scope;
- Telegram HMAC, tenant/user binding, expiry e nonce one-time.

## Web app

Workflow: `.github/workflows/web.yml`.

Risultato validato 2026-08-09:

- route smoke tests: **5/5 PASS**;
- TypeScript strict typecheck: PASS;
- Vite production build: PASS.

Le route smoke verificano almeno:

- landing e chatbot pubblico senza tenant data;
- app dashboard shell in modalità mock;
- post editor con `separate_concept`, quality gate, anti-duplicate e publishing safety;
- Google Business Profile nella pagina connessioni e OAuth mock;
- Admin con infrastruttura remota esplicitamente posticipata.

Il frontend include inoltre shell di login/registrazione/reset, onboarding, Brand Profile, asset, strategy, calendar, approvals, notifications, analytics, support, billing, settings e admin; nessun componente importa Supabase o SDK provider direttamente.

## Problemi realmente intercettati dalla CI

- `service_role` privo dei grant SQL espliciti necessari → migration 006;
- extension `vector` in `public` → spostata in `extensions`;
- tre policy RLS con `auth.uid()` non ottimizzato → corrette;
- migration correttiva fuori ordine → rinumerata e retestata;
- risoluzione monorepo contracts/zod errata → npm workspaces;
- Vite CSS side-effect type declaration mancante → `vite-env.d.ts`;
- stylesheet legacy con errore sintattico → sostituito e rimosso;
- smoke assertion non allineata al copy reale → corretta senza indebolire la safety assertion.

## Suite successiva a costo zero

- onboarding → Brand Profile state machine;
- tenant isolation esteso su social metadata/analytics/posts/assets/jobs;
- publishing mock: timeout-after-provider-success + reconciliation;
- duplicate: semantic/topic/hook/visual acceptance più ampia;
- approval state transitions AUTO/MANUALE;
- website scanner redirect/error/coverage fixtures;
- anti-clone acceptance multi-business;
- accessibilità/keyboard checks frontend;
- repository/service mock contract tests.

## Anti-clone acceptance

Fixture previste:

- Pizzeria A/B/C stessa città, 10 post ciascuna;
- Property Manager A/B/C stessa città, 10 post ciascuno.

Verificare topic, hook, caption, visual direction e CTA differenti. Il controllo cross-tenant deve usare fingerprint/score server-side e non esporre contenuti di un tenant ad altri tenant.

## Da ripetere su Supabase remoto

Quando verrà creato il progetto dedicato, la stessa suite database dovrà essere ripetuta contro l'ambiente remoto prima di beta/test pubblico. Fino a quel momento la validazione remota è intenzionalmente posticipata, non un blocco dello sviluppo.

## Production safety

I test automatici usano provider mock. Nessun test CI deve pubblicare sui social reali o usare token provider di produzione.
