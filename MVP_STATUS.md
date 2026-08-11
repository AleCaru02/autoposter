# MVP Status

Aggiornato: **2026-08-11**

## STATO

**MVP locale ~93% — TUTTI I GATE CRITICI LOCALI VERDI**

Il percorso locale principale è operativo e persistente senza provider live, senza Supabase remoto dedicato e senza costo fisso aggiuntivo.

```text
registrazione/login
→ tenant
→ onboarding
→ website scan
→ Brand Profile + locks + Brand Visual Settings
→ Asset Library DB + Storage
→ strategy
→ calendar
→ content generation
→ visual selection/render/QA
→ Approval Center + Media Picker
→ scheduler
→ publish mock
→ analytics
→ learning
```

## Gate verificati

- migrations da zero: **11/11 PASS**;
- DB lint: **PASS**;
- Security Advisors locali: **0 issue**;
- Performance Advisors locali: **0 issue**;
- pgTAP: **71/71 PASS**;
- DB/Auth/RLS/Storage integration: **29/29 PASS**;
- Runtime TypeScript strict: **PASS**;
- Runtime: **29 file / 151 test PASS**;
- Local API TypeScript strict: **PASS**;
- Local API: **1 file / 4 test PASS**;
- Web TypeScript strict: **PASS**;
- Web: **3 file / 18 test PASS**;
- Vite production build: **PASS**;
- Full Playwright API/browser E2E: **22/22 PASS**;
- secondo Full Playwright E2E sullo stesso HEAD: **22/22 PASS**.

## Regression chiusa — Media Picker

L'ultimo gate rosso non era un bug di persistenza dell'app. La trace Playwright ha mostrato due problemi nel test:

1. il test leggeva `visual.selection.selectedAssetId` dopo un GET persistito, mentre la forma DB espone `selected_asset_id` e `visual_spec.selection.selectedAssetId`;
2. dopo una seconda conferma il test eseguiva il GET prima che il POST di render/persistenza fosse terminato.

Il test ora verifica la forma persistita reale e attende la risposta POST 2xx del render prima delle assertion DB. Nessun timeout artificiale è stato aumentato e la severità del test non è stata ridotta.

Il lifecycle coperto resta: cancel, reopen, selezione ripetuta, upload, BLOCKED/ARCHIVED exclusion, Tenant A/Tenant B isolation, nuova preview, persistenza, Visual QA e mobile.

## Provider readiness

`check-provider-readiness` distingue architecture, contract, security, UI, tests, credentials, remote callback/webhook e live validation.

Sul gate locale finale architecture/contracts/security/UI/tests risultano pronti. Le parti mancanti sono intenzionalmente quelle live: credenziali, callback/webhook pubblici dove richiesti e live validation. In questo significato i provider sono **READY_FOR_CREDENTIALS**, non live-ready.

## Ancora intenzionalmente non eseguito

- OpenAI live;
- provider social reali;
- Telegram reale;
- Stripe reale;
- Supabase remoto dedicato;
- callback/webhook pubblici di staging;
- deploy production;
- merge della PR #1.

## Safety

- `AUTO_PUBLISH=false` resta il default;
- publishing E2E è mock-only;
- visual generation esterna non viene chiamata;
- nessun secret reale è stato aggiunto;
- costo fisso aggiuntivo introdotto: **€0**;
- PR #1 deve restare **OPEN + DRAFT + NOT MERGED**.
