# MVP Status

Aggiornato: 2026-08-10

## STATO

**MVP LOCALE ~88% — VISUAL E2E VALIDATO**

Il percorso locale principale è ora operativo e persistente senza provider live e senza costo fisso aggiuntivo:

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
→ platform variants
→ asset selection
→ Visual Director
→ template / SVG / carousel
→ visual QA
→ selective repair
→ approval AUTO/MANUALE
→ scheduler
→ publish mock
→ analytics
→ learning
```

Nessun progetto Supabase cloud viene usato dal SaaS in questa fase. PR #1 resta draft e non mergeata.

## DATABASE / TENANCY — VALIDATO LOCALMENTE

- Supabase CLI + Docker ricostruibili da database vuoto.
- **9/9 migrations PASS**.
- Migration history PASS.
- DB lint: nessun errore.
- Security Advisors: nessuna issue.
- Performance Advisors: nessuna issue.
- pgTAP: **2 file / 45 test PASS**.
- Auth/RLS/quota/E2E-state/asset-storage integration: **4 file / 24 test PASS**.
- Tenant A/Tenant B: SELECT/INSERT/UPDATE/DELETE cross-tenant bloccati.
- Composite FK tenant-aware.
- `app_private` non accessibile ai client.
- Storage privato con path tenant-safe.
- Tenant A non può leggere, modificare, eliminare, usare o associare asset Tenant B.
- Tenant A non può caricare nel path Storage Tenant B.
- Quota `reserve → commit/release` idempotente.
- AUTO variants accodate indipendentemente dalle MANUAL siblings.

## ASSET LIBRARY — OPERATIVA

Asset Library non è più principalmente in-memory.

Persistenti in PostgreSQL + Supabase Storage locale:

- upload;
- signed preview;
- ricerca e filtri;
- type;
- description;
- alt text;
- tags;
- quality score;
- platform/topic compatibility;
- preferred;
- brand lock;
- ACTIVE / ARCHIVED / BLOCKED;
- usage count;
- last used;
- archive/unarchive;
- block/unblock;
- safe delete;
- document/PDF storage + `index_status`;
- SHA-256 dedup per tenant.

Validazioni: MIME allowlist, size limit configurabile, filename sanitization, file vuoto/corrotto/dimensioni invalide e duplicate handling.

Un asset già associato a un contenuto non viene eliminato silenziosamente (`asset_in_use`).

## VISUAL / GRAPHIC ENGINE — OPERATIVO

- `AssetClassifier` boundary + `DeterministicAssetClassifier`.
- `AssetSelectionEngine` brand-aware.
- Preferenza per asset reale pertinente prima di branded/generated visual.
- Repetition control tramite `asset_usage_history`.
- `DeterministicVisualDirector` collegato alla pipeline.
- `DeterministicGraphicRenderer` produce SVG reali localmente.
- Palette/font/logo dal Brand Profile.
- Logo con aspect ratio preservato.
- 10 famiglie template parametriche.
- `visual_template_profile` differente per tenant.
- Fingerprint visuale / anti-clone.
- square / portrait / landscape centralizzati.
- Carousel locale con slide persistite.
- `MockImageGenerationProvider` dietro `ImageGenerationProvider`.
- `ImagePromptBuilder` già testabile e provider-neutral.
- render persistiti nel bucket privato `post-assets` + `visual_renders`.

## QUALITY GATE / SELECTIVE QA — OPERATIVO

Visual QA controlla almeno:

- headline/body/CTA troppo lunghi;
- contrasto insufficiente;
- forbidden/unverified fact claims;
- readability;
- asset relevance;
- brand match;
- layout quality;
- visual novelty;
- platform fit;
- text density;
- template repetition.

Selective repair può modificare senza rigenerazione completa:

- hook only;
- caption only;
- hashtag only;
- CTA only;
- visual text/contrast only;
- template only.

`content_component_versions` mantiene audit trail/versioning. Un fact claim vietato resta blocker.

## APPROVAL CENTER — OPERATIVO

`/approvals` mostra preview visuale persistita, carousel, caption, hashtag, piattaforma, data/ora e stato.

Azioni DB-backed:

- APPROVA;
- MODIFICA TESTO;
- CAMBIA GRAFICA;
- RIGENERA GRAFICA;
- CAMBIA FOTO;
- RIFIUTA.

Cambio grafica crea una nuova render version. “Cambia foto” cicla un altro asset attivo disponibile; l'API supporta anche asset ID esplicito.

## RUNTIME / LOCAL API — VALIDATO

- Runtime TypeScript strict: PASS.
- Runtime: **21 file / 87 test PASS**.
- Local API TypeScript strict: PASS.
- Brand-aware asset selection test.
- Visual anti-clone acceptance: 3 Pizzerie + 3 Property Manager.
- Selective repair hardening.
- SocialProvider mock FB/IG/LinkedIn/GBP.
- Publishing idempotente/retry/reconciliation.
- Website scanner.
- Support/knowledge isolation.
- Telegram approval mock.
- Analytics evidence-gated.
- AI/visual cost ledger con costo corrente zero.

## WEB — VALIDATA

- **16/16 test PASS**.
- TypeScript strict PASS.
- Vite production build PASS.
- Asset Library responsive e lazy-loaded.
- Brand Visual Settings.
- Approval Center visuale.
- Onboarding race-safe con refresh sequencing.
- Dashboard, strategy, calendar, post editor, connections, analytics/learning, support, billing/cost ledger, settings e admin continuano a funzionare.

## FULL LOCAL E2E — VALIDATO

Stack pulito:

```text
Supabase CLI/Docker → local API → React/Vite → Chromium Playwright
```

**11/11 E2E PASS**.

Copertura include:

- percorso cliente completo;
- due tenant e RBAC;
- provider error/reconciliation mock;
- Pizzeria con foto reale pizza preferita;
- Property Manager con asset reale pertinente;
- Networker con asset persona pertinente;
- tenant senza asset → branded graphic / mock generated fallback;
- carousel 5 slide;
- selective repair;
- MIME/corruption/size/dedup errors;
- cross-tenant Asset API 403;
- Asset Library browser upload/search;
- Approval Center visuale e cambio grafica;
- responsive mobile;
- zero regressioni del vecchio core E2E.

## BUG REALI TROVATI E CORRETTI IN QUESTA FASE

- FK visual QA creata prima dell'unicità composta render → ordine migration corretto.
- RLS template profile con policy permissive sovrapposte → policy separate per operazione.
- strict access RGB/base64 → accessi sicuri espliciti.
- Node `Buffer` non compatibile con `BodyInit` strict → `Blob(Uint8Array)`.
- supersede render non filtrato per tenant/variant → PATCH tenant-scoped.
- possibile delete asset già referenziato → `asset_in_use` guard.
- persisted visual decision annidata non esposta correttamente in Approval UI → lettura da `visual_spec`.
- Approval action rimuoveva il pending senza feedback esplicito → stato “Approvato/Rifiutato” visibile.
- selector sottopesava foto pizza con topic generico → `brandContext` + settore/servizi nel ranking.
- test signed URL legato a un vecchio prefisso Supabase → validazione struttura URL + signed token.
- race onboarding tra refresh vecchio e nuovo tenant → refresh sequenziati + stale response rejection.

## ANCORA MOCK / POSTICIPATO

- OpenAI live / Vision classifier;
- image generation reale (oggi `MockImageGenerationProvider`);
- Meta/Instagram live;
- LinkedIn live;
- Google Business Profile live;
- Telegram live;
- Stripe live;
- analytics provenienti dai provider reali;
- Supabase remoto dedicato;
- Edge Functions/Cron/Queues remote;
- Vercel production.

Inoltre:

- PDF/brochure: storage + metadata + index state operativi, parsing semantico AI non ancora implementato;
- thumbnail raster dedicata non ancora implementata: UI usa signed preview originale + lazy loading;
- chooser visuale completo tipo “media picker modal” non ancora presente: `CAMBIA FOTO` cicla asset attivi e l'API accetta asset specifico;
- `edit()` / `variation()` del provider immagine esistono come mock contract ma non hanno UI dedicata;
- `no_visual` è supportato dal contratto ma non è un flusso E2E principale.

## COSTI

**Costo fisso aggiuntivo: €0.**

Nessun upgrade Supabase, nuovo progetto cloud, acquisto Lovable, provider a pagamento o secret live configurato.

## BLOCCANTI REALI

Nessun blocco che richieda intervento utente per continuare lo sviluppo locale.

Il prossimo blocco reale esterno arriverà quando serviranno OAuth/callback/provider reali o beta pubblico.

## PROSSIMO BLOCCO

Il maggior impatto sul passaggio da MVP locale a prodotto utilizzabile è ora il **provider-integration readiness layer** a costo zero: chiudere media picker/thumbnail pipeline, document ingestion provider abstraction, provider contract fixtures/webhook/OAuth state machine e staging-readiness senza ancora attivare secret o servizi reali. Dopo questo blocco il passo successivo richiederà il Supabase remoto dedicato e credenziali reali.

## PR

Draft PR #1 aperta. Non mergeare in questa fase.
