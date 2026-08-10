# Testing

## Stato

**LOCAL MVP + VISUAL PIPELINE VALIDATI — 2026-08-10**

La suite resta completamente a costo fisso aggiuntivo €0: Docker/Supabase locale, runtime deterministico, local API, React/Vite e Chromium. Nessun test usa social/OpenAI/Stripe reali o modifica progetti Supabase cloud.

## Gate finali

| Gate | Risultato |
|---|---:|
| Migrations da zero | **9/9 PASS** |
| DB lint | **PASS** |
| Security Advisors | **0 issue** |
| Performance Advisors | **0 issue** |
| pgTAP | **2 file / 45 PASS** |
| Auth/RLS/quota/asset-storage integration | **4 file / 24 PASS** |
| Runtime strict | **PASS** |
| Runtime | **21 file / 87 PASS** |
| Local API strict | **PASS** |
| Web | **16/16 PASS** |
| Web strict | **PASS** |
| Vite build | **PASS** |
| Full Playwright E2E | **11/11 PASS** |

## Database / Storage

Workflow: `.github/workflows/tenant-isolation.yml`.

La suite ricostruisce realmente PostgreSQL/Auth/Storage da zero e verifica migration history, lint e Advisors.

pgTAP strutturale copre anche la migration visuale 009:

- asset metadata columns;
- Brand Profile logo reference;
- visual template profiles;
- asset usage history;
- visual renders;
- component versions;
- visual QA issues;
- RLS;
- tenant-consistent FK;
- asset content hash unique per tenant;
- bucket privati;
- visual renders non falsificabili da `authenticated`.

Integration con due utenti Auth reali copre:

- SELECT/INSERT/UPDATE/DELETE cross-tenant;
- CRUD proprio;
- FK cross-tenant;
- `app_private` chiuso;
- quota reserve/commit/release e replay idempotente;
- onboarding / Brand Profile / learning isolation;
- asset row cross-tenant;
- Storage path cross-tenant;
- visual evidence read-only;
- cross-tenant logo reference rifiutato.

Risultato finale:

- pgTAP: **45/45 PASS**;
- integration: **24/24 PASS**.

## Runtime

Workflow: `.github/workflows/runtime.yml` e local-api gate.

Risultato finale:

- TypeScript strict: PASS;
- **21 test file / 87 test PASS**.

Copertura preesistente preservata:

- SocialProvider mock FB/IG/LinkedIn/GBP;
- scheduler exactly-once/retry/dead;
- successful-publish + timeout reconciliation;
- manual/auto approval;
- website scanner;
- public vs tenant support;
- Telegram HMAC/expiry/nonce;
- onboarding/versioned Brand Profile;
- asset repository mock legacy;
- analytics optimizer;
- AI cost ledger;
- GBP local planner;
- sector strategy planner.

Nuova copertura visuale:

- deterministic asset classifier;
- real-asset selection;
- repetition penalty;
- brand-aware asset selection quando il topic è generico;
- 10-template catalog / per-tenant template profile;
- square/portrait/landscape renderer;
- contrast checks;
- overflow checks;
- logo aspect-ratio safe rendering;
- fact-safe graphics;
- carousel builder;
- MockImageGenerationProvider generate/edit/variation;
- image prompt safety;
- selective hook repair;
- selective caption repair;
- selective hashtag repair;
- selective CTA repair;
- visual/template-only repair;
- visual anti-clone su **3 Pizzerie**;
- visual anti-clone su **3 Property Manager**.

## Web

Workflow: `.github/workflows/web.yml`.

Risultato finale:

- **16/16 PASS**;
- TypeScript strict PASS;
- Vite production build PASS.

Copre le route e i componenti principali già esistenti più la composizione del nuovo visual workflow.

Il browser E2E copre direttamente Asset Library e Approval Center, quindi upload/preview/visual action non vengono validate soltanto tramite smoke render server-side.

## Full local E2E

Workflow: `.github/workflows/local-e2e.yml`.

Stack reale del test:

```text
GitHub runner pulito
→ Supabase CLI + Docker
→ db reset + migrations + seed
→ local API
→ Vite
→ Chromium
→ API + browser E2E
```

Risultato finale: **11/11 PASS**.

### Scenario core preservati

- registrazione/login e onboarding browser;
- workspace/customer flow;
- due Pizzerie separate e cross-tenant denial;
- multisettore Pizzeria / Property Manager / Networker / attività locale;
- approval → scheduler → mock publishing → analytics/learning;
- provider timeout;
- rate limit;
- auth expired;
- validation error;
- platform rejection;
- successful publish + timeout reconciliation;
- admin RBAC;
- responsive / console error guard.

### Nuovi Visual E2E

**Pizzeria**

- upload logo, pizza e locale;
- Brand Visual Settings;
- generazione contenuto;
- il selector preferisce una foto reale pizza quando pertinente;
- signed preview `post-assets`;
- usage count aggiornato.

**Property Manager**

- asset soggiorno/interior;
- selection del relativo asset reale.

**Networker**

- asset persona/founder;
- selection differente dal Property Manager/Pizzeria.

**Nessun asset**

- fallback verso branded graphic o MockImageGenerationProvider, senza crash.

**Carousel**

- checklist carousel;
- **5 slide renderizzate e persistite**.

**Selective repair**

- visual overflow riparato e retestato;
- hook repair modifica solo hook;
- caption e CTA restano invariati nel test hook-only.

**Asset safety**

- MIME non supportato;
- file corrotto;
- file vuoto;
- dimensioni immagine invalide;
- file sopra limite configurabile;
- duplicate hash → riuso asset esistente;
- cross-tenant list/update/delete → 403;
- nessun crash.

**Browser visual UI**

- Asset Library upload;
- search/filter;
- Approval Center signed preview;
- CAMBIA GRAFICA;
- persistenza operazione;
- mobile width check;
- console/page errors guard.

## Regressioni / bug intercettati in questa fase

1. Migration visual QA FK prima dell'unicità `(tenant_id,id)` dei render → ordine corretto, reset DB retestato.
2. Policy `SELECT` + `FOR ALL` su template profile → policy RLS separate, Advisors retestati.
3. `noUncheckedIndexedAccess` nel nuovo renderer/test → tuple/accessi espliciti, strict retestato.
4. Optional `visualType` non compatibile con `exactOptionalPropertyTypes` → assegnazione condizionale.
5. Node Buffer non accettato da Fetch `BodyInit` strict → Blob/Uint8Array.
6. Supersede visual renders senza filtro tenant/variant → PATCH limitato a tenant + variante.
7. Asset già collegato eliminabile dal servizio → `asset_in_use` guard.
8. Persisted visual selection/direction rimanevano annidate e Approval UI non le mostrava → normalizzazione via `visual_spec`.
9. Dopo APPROVA il pending spariva senza feedback → stato esplicito Approvato/Rifiutato.
10. Selector con topic generico “Pizzeria” sottopesava la foto pizza reale → brandContext/settore/servizi aggiunti al ranking + regression test dedicato.
11. Signed URL test dipendeva dal vecchio prefisso Supabase → assertion su bucket/path firmato + token.
12. Onboarding poteva tornare da `goals` a `business` per risposta workspace stale → refresh sequence guard + explicit tenant refresh.

Ogni fix è stato seguito da rerun della suite interessata; il ciclo finale completo è verde.

## Production safety

I test automatici non devono mai:

- pubblicare sui provider reali;
- utilizzare OpenAI live;
- usare token social/Stripe di produzione;
- applicare migrations a Supabase cloud esistenti.

Image generation E2E usa esclusivamente `MockImageGenerationProvider`; publishing usa provider social mock.

## Limiti ancora non coperti come funzionalità live

- OAuth/provider social reali;
- image generation/Vision reali;
- remote Supabase/Auth/Storage/Edge Functions;
- provider analytics reali;
- PDF semantic ingestion reale;
- thumbnail raster/resizer dedicato.

Questi punti richiederanno nuovi gate prima del beta pubblico e non riducono la validità del Local/Visual E2E corrente.
