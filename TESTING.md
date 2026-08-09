# Testing

## Strategia

La fase locale viene validata a quattro livelli indipendenti e tutti a costo fisso €0:

1. Supabase CLI + Docker: schema, migrations, RLS, Auth, Data API;
2. runtime/local API: AI, strategy, social mock, approval, scheduler, scanner, support, analytics;
3. React/Vite: route smoke, accessibilità base, strict typecheck, production build;
4. Playwright Chromium: E2E API + percorso browser reale.

Nessun test usa provider social reali, OpenAI live o i Supabase cloud esistenti.

## Database

Workflow: `.github/workflows/tenant-isolation.yml`.

Risultato finale:

- **8/8 migrations da zero PASS**;
- migration history PASS;
- DB lint PASS;
- Security Advisors PASS — nessuna issue;
- Performance Advisors PASS — nessuna issue;
- pgTAP **27/27 PASS**;
- Auth/RLS/quota/E2E-state **3 file / 20 test PASS**.

Copertura include CRUD cross-tenant, FK tenant-aware, `app_private`, quota, social metadata, server-only tables, onboarding, Brand Profile version history, learning evidence e AUTO variant scheduler.

## Runtime + local API

Workflow: `.github/workflows/local-api.yml`.

Risultato finale:

- runtime strict typecheck PASS;
- runtime **17 file / 66 test PASS**;
- local API strict typecheck PASS.

Copertura principale:

- deterministic AI platform adaptation;
- strategy planner multisettore;
- GBP local decision;
- scheduler/exactly-once/retry/dead;
- timeout-after-provider-success;
- approval manual/auto;
- anti-clone/anti-duplicate;
- scanner redirect/error/coverage;
- public vs tenant support;
- Telegram signed approval mock;
- Brand Profile/onboarding state;
- Asset Library runtime lifecycle;
- analytics evidence gate;
- AI cost ledger;
- editorial E2E pipeline.

## Web

Workflow: `.github/workflows/web.yml`.

Risultato finale:

- **16/16 tests PASS**;
- TypeScript strict PASS;
- Vite production build PASS.

Copertura include route pubbliche/app/admin, service repository, accessibility smoke, `/approvals`, GBP e safety fallback senza local API.

## Local E2E Chromium

Workflow: `.github/workflows/local-e2e.yml`.

Il job parte da runner pulito e avvia:

```text
Supabase Docker
→ db reset + seed
→ local API :8787
→ Vite :5173
→ Chromium Playwright
```

Risultato verificato: **5/5 Playwright E2E PASS**.

### 3 API E2E

1. due Pizzerie con pipeline completa, differenziazione creativa e cross-tenant 403;
2. multisettore Pizzeria / Property Manager / Networker / attività locale;
3. failure modes publishing, retry e reconciliation dopo timeout-success.

### 2 Browser E2E

1. registrazione → onboarding → scanner → Brand Profile → social/modes → strategy → calendar → generation → Approval Center → publish → dashboard → analytics → chatbot → cost ledger → mobile responsive;
2. rate-limit UI/state + admin RBAC local claim.

Il browser test richiede zero console/page errors.

## Bug intercettati durante questa fase

- pgTAP plan dichiarava 25 ma eseguiva 26 assert → corretto e poi esteso a 27;
- runtime importava un tipo scheduler errato → corretto;
- `structuredClone` usato direttamente come callback → reso strict-safe;
- test GBP passava proprietà opzionale `undefined` → corretta semantica exactOptionalPropertyTypes;
- test Telegram poteva non alterare realmente la firma se terminava già in `0` → tampering garantito;
- generic TSX `async <T>` interpretato come JSX → `<T,>`;
- RequestInit body opzionale incompatibile con strict mode → adapter typed dedicato;
- API E2E creava email con spazi → normalizzazione local part;
- selettore browser brand ambiguo → heading univoco;
- test RBAC provocava volutamente 403 nel browser e contaminava console-error check → denial testato via API, UI mantiene zero errori;
- AUTO variants aspettavano MANUAL siblings → migration 008 con scheduling per variante;
- orchestrator troppo statico su hook/CTA → differenziazione tenant/topic/platform.

## Diagnostica

Il workflow E2E salva per 3 giorni artifact con:

- output Playwright;
- local API log;
- web log;
- test-results/traces su failure.

## Ripetizione locale

Procedura unica in `LOCAL_E2E.md`.

## Da ripetere sul remoto futuro

Migrations, RLS/Auth/Storage, OAuth, callback, webhook, Cron/Queues e provider live dovranno essere validati sul futuro progetto Supabase dedicato prima del beta pubblico.
