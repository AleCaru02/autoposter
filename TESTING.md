# Testing

## Stato

**LOCAL MVP + PROVIDER READINESS + VISUAL PIPELINE VALIDATI — 2026-08-11**

La suite resta a costo fisso aggiuntivo **€0**: GitHub runner, Supabase CLI/Docker locale, runtime deterministico, local API, React/Vite e Chromium. Nessun test usa OpenAI/social/Telegram/Stripe reali e nessun test modifica Supabase cloud.

## Gate finali

| Gate | Risultato |
|---|---:|
| Migrations da zero | **11/11 PASS** |
| DB lint | **PASS** |
| Security Advisors | **0 issue** |
| Performance Advisors | **0 issue** |
| pgTAP | **71/71 PASS** |
| DB/Auth/RLS/Storage integration | **29/29 PASS** |
| Runtime strict | **PASS** |
| Runtime | **29 file / 151 PASS** |
| Local API strict | **PASS** |
| Local API | **1 file / 4 PASS** |
| Web strict | **PASS** |
| Web | **3 file / 18 PASS** |
| Vite build | **PASS** |
| Full Playwright E2E | **22/22 PASS** |
| Full Playwright E2E repeat | **22/22 PASS** |

## Full local E2E

Workflow: `.github/workflows/local-e2e.yml`.

Stack del gate:

```text
runner pulito
→ npm install
→ Chromium Playwright
→ Supabase CLI + Docker
→ supabase start
→ supabase db reset --local
→ 11 migrations + seed
→ local API
→ SEO crawl files
→ Vite
→ health checks
→ 22 API/browser E2E
→ cleanup processi + Supabase locale
```

La suite finale copre nello stesso run:

- customer pipeline multi-tenant e multi-settore;
- publishing retry/failure/reconciliation;
- asset oversize handling;
- onboarding → content → approval → publishing → analytics → learning;
- RBAC admin gate;
- Approval Center / Media Picker lifecycle;
- provider readiness browser/API;
- OAuth fixture flow, health, validation, dry-run, publish, analytics, reconnect e revoke;
- provider validator;
- webhook raw bytes/signature/replay/stale timestamp/mapping/malformed payload;
- landing/SEO/structured data/crawl controls;
- responsive 320/375/390/430/tablet;
- public chatbot accessibility;
- visual asset pipeline, carousel, QA/selective repair, dedup e cross-tenant denial.

## Media Picker regression closure

Test: `apps/e2e/tests/media-picker-lifecycle.spec.ts`.

### Failure riprodotto

Il test storico passava il primo cambio foto ma falliva dopo il secondo. La trace/network Playwright ha dimostrato che:

- la persistenza del primo cambio era corretta;
- il GET persistito restituisce `selected_asset_id` e `visual_spec.selection`, non il campo transitorio `selection` usato dalla risposta POST;
- sul secondo cambio il POST `/variants/:id/visual` era ancora in flight mentre il test lanciava immediatamente il GET di verifica, che quindi leggeva ancora `render_version=2` invece del nuovo `render_version=3`.

### Fix

- assertion allineate alla forma persistita reale;
- helper `persistedSelectedAssetId` per leggere la selection DB;
- conferma Media Picker sincronizzata sulla risposta POST 2xx del render tramite `page.waitForResponse` impostato **prima** del click;
- nessun aumento dei timeout;
- nessun `sleep` introdotto;
- nessun locator reso meno severo.

### Lifecycle verificato

- cancel;
- reopen;
- primo cambio asset;
- secondo cambio asset;
- upload nuovo asset;
- asset `BLOCKED` escluso;
- asset `ARCHIVED` escluso;
- Tenant A/Tenant B denial;
- nuova preview;
- render version incrementale;
- persistenza selected asset;
- `USER_SELECTED_ASSET` motivation;
- Visual QA e fingerprint;
- copy invariato;
- mobile 390 px senza overflow;
- console/page errors guard.

Il Full E2E è poi passato **22/22** ed è stato rieseguito sullo stesso HEAD con un secondo **22/22**, escludendo un pass casuale.

## Browser quality

I test browser rilevanti mantengono guard su console/page errors e i failure intenzionali sono gestiti come stati applicativi attesi. Nel ciclo finale non sono emersi errori browser inattesi, page errors o regressioni React bloccanti.

## Runtime / provider security

Runtime: **151/151 PASS** con TypeScript strict su source e test shard.

La copertura include tra l'altro:

- provider readiness;
- provider contract/security/lifecycle;
- OAuth state TTL, replay, tenant/user/provider/redirect binding e PKCE;
- webhook signature/replay/idempotency;
- connection health;
- plan entitlements;
- Stripe lifecycle/readiness;
- Telegram callback security;
- publishing resilience;
- visual engine e anti-clone;
- structured AI contracts e cost ledger.

## Database / RLS

Il workflow locale ricostruisce il database da zero. Risultati:

- **11/11 migrations**;
- **71/71 pgTAP**;
- **29/29 integration**;
- DB lint PASS;
- Security Advisors 0 issue;
- Performance Advisors 0 issue.

Sono coperti isolamento Tenant A/Tenant B, RLS, Storage path, `app_private`, provider readiness persistence, visual evidence, quota/state e FK tenant-aware.

## Production safety

I test automatici non devono mai:

- pubblicare sui provider reali;
- utilizzare OpenAI live;
- usare token social/Telegram/Stripe reali;
- applicare migrations a Supabase cloud;
- abilitare `AUTO_PUBLISH` fuori dalla safety policy.

Publishing usa provider fixture/mock e image generation usa esclusivamente provider deterministici/mock.
