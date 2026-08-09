# MVP Status

Aggiornato: 2026-08-09

## VALIDATO LOCALMENTE

### E2E utilizzabile dalla web app

Il percorso cliente è realmente collegato su stack locale:

`React/Vite → local API → Supabase Auth/Postgres/RLS → runtime deterministico → scheduler/provider mock → analytics/learning`

Percorso verificato in Chromium:

1. registrazione Auth locale;
2. creazione tenant;
3. onboarding persistente;
4. website scanner locale;
5. Brand Profile versionato con DRAFT/REVIEW/CONFIRMED e lock;
6. obiettivi, target, social, frequenza e AUTO/MANUALE per piattaforma;
7. strategia settoriale;
8. calendario editoriale;
9. contenuti e varianti specifiche per piattaforma;
10. anti-duplicate + quality gate;
11. Approval Center;
12. scheduling idempotente;
13. `Publish now` mock;
14. analytics mock persistite;
15. learning evidence-gated;
16. chatbot pubblico e tenant-aware;
17. cost ledger teorico;
18. admin locale con RBAC.

Il workflow `.github/workflows/local-e2e.yml` ricostruisce tutto da zero e ha concluso **5/5 Playwright E2E PASS** su Chromium.

### Database / tenancy

- Supabase CLI + Docker, PostgreSQL 17.
- Database ricostruibile con `supabase start` + `supabase db reset --local`.
- **8/8 migrations** applicate da zero.
- Seed locale deterministico, inclusi piano `local-dev` e knowledge commerciale.
- DB lint: PASS — nessun errore schema.
- Security Advisors: PASS — nessuna issue.
- Performance Advisors: PASS — nessuna issue.
- pgTAP: **27/27 PASS**.
- Auth/RLS/quota/E2E-state: **3 file / 20 test PASS**.
- Tenant A/B separati con utenti Auth reali.
- CRUD cross-tenant bloccato.
- Brand Profile version history tenant-consistent.
- onboarding tenant-scoped.
- learning leggibile solo dal tenant e non falsificabile dal client.
- `app_private` non esposto ai client.
- quota `reserve → commit/release` idempotente.
- AUTO variants schedulate indipendentemente dai MANUAL siblings tramite trigger DB.

### Runtime / local API

- TypeScript strict: PASS.
- Runtime: **17 file / 66 test PASS**.
- Local API strict typecheck: PASS.
- orchestrator deterministico differenziato per tenant/topic/piattaforma;
- strategy planner Pizzeria / Property Manager / Networker / attività locale;
- SocialProvider mock per Instagram, Facebook, LinkedIn, Google Business Profile;
- GBP planner `native_variant | separate_concept | skip`;
- approval manual/auto;
- scheduler, retry, dead/failure state, idempotency;
- timeout-after-provider-success reconciliato senza doppia pubblicazione;
- anti-clone e anti-duplicate server-side;
- scanner same-origin con redirect/error handling;
- Brand Profile versioning/locks;
- knowledge retrieval pubblico/interno;
- Telegram approval mock firmato;
- analytics optimizer evidence-gated;
- AI cost ledger senza prezzi provider hardcoded.

### Web app

- React/Vite/TypeScript strict.
- **16/16 web test PASS**.
- Typecheck: PASS.
- Vite production build: PASS.
- sessione locale Auth + tenant persistiti;
- onboarding interattivo;
- dashboard operativa;
- Brand Profile editor/versioning;
- strategia;
- calendario week/month/list;
- Post Editor;
- `/approvals` + `/app/approvals`;
- connessioni mock;
- analytics/learning;
- chatbot pubblico e tenant-aware;
- cost ledger;
- admin RBAC;
- responsive smoke in Chromium;
- E2E richiede zero console/page errors.

### Test E2E specifici

Playwright API/browser: **5/5 PASS**.

Copertura:

- due pizzerie distinte con pipeline completa e nessuna perdita cross-tenant;
- brand/topic/hook/caption/visual/CTA differenziati;
- quattro settori: Pizzeria, Property Manager, Networker, attività locale generica;
- provider timeout;
- rate limit;
- validation error;
- successful publish + timeout response con stesso external mock ID al retry;
- onboarding UI completo;
- Approval Center;
- analytics/learning;
- chatbot tenant-aware;
- admin RBAC;
- responsive 390×844;
- zero console/page errors.

## ANCORA MOCK / NON REMOTO

- provider Instagram/Facebook/LinkedIn/Google Business Profile;
- OAuth social;
- OpenAI;
- Telegram live;
- Stripe checkout;
- analytics provenienti dalle API social reali;
- Cron/Queues Supabase remoto;
- storage remoto/signed URL reali;
- Edge Functions/secrets remoti;
- deploy production Vercel.

Asset Library UI resta ancora prevalentemente in-memory/mock. Il quality repair selettivo per singolo componente non è ancora completo: la rigenerazione UI può rigenerare l'intero post anziché soltanto hook/caption/visual specifico.

## DA VALIDARE SU SUPABASE REMOTO

Intenzionalmente posticipato e non bloccante:

- migrations/history/advisors sul futuro progetto dedicato;
- Auth/RLS/Storage remoto;
- Edge Functions e secret encryption reali;
- OAuth/callback/webhook pubblici;
- Cron/Queues reali;
- provider live;
- beta pubblica.

Il remoto diventa necessario solo quando serve una callback pubblica/provider reale/beta tester/cliente o emerge un limite non riproducibile localmente.

## COSTI

Costo fisso infrastrutturale aggiunto in questa fase: **€0**.

- nessun nuovo progetto Supabase;
- nessun upgrade Supabase;
- nessun acquisto Lovable;
- nessun provider a pagamento;
- nessun checkout;
- GitHub Actions + Supabase CLI/Docker + provider mock.

## PR

Draft PR #1 resta aperta, non mergeata e source of truth sul branch `feat/saas-foundation`.

## Definition of Done della fase

**RAGGIUNTA LOCALMENTE.**

È possibile partire da un database vuoto e, senza editing manuale del DB, entrare nella web app, completare onboarding, generare Brand Profile/strategia/calendario/contenuti, approvare o rifiutare, pubblicare in mock, vedere analytics e learning.

Procedura unica: `LOCAL_E2E.md`.
