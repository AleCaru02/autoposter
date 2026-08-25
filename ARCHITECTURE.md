# Architecture

## Stato

La V1 locale funziona senza infrastruttura cloud aggiuntiva durante lo sviluppo.

```text
React/Vite web app
  ↓ localhost HTTP
Local E2E API
  ├─ Auth/session + tenant/role guard
  ├─ website scanner
  ├─ Brand Profile/versioning/locks + visual settings
  ├─ Asset Library DB/Storage
  ├─ strategy + calendar planner
  ├─ deterministic AI runtime
  ├─ Asset Selection + Visual Director
  ├─ deterministic SVG renderer + carousel
  ├─ visual QA + selective repair + component versions
  ├─ anti-duplicate + visual fingerprints
  ├─ approval + scheduler
  ├─ mock social providers
  ├─ analytics + learning
  └─ AI/visual cost ledger
  ↓
Supabase CLI + Docker
  ├─ Auth
  ├─ PostgreSQL 17
  ├─ RLS
  ├─ app_private
  └─ private Storage: brand-assets / post-assets / tenant-documents
```

## Browser/server boundary

Le normali operazioni cliente passano con token Auth e RLS. Il browser non possiede `service_role`, secret social o accesso a `app_private`.

Il local API usa `service_role` soltanto per workload trusted server-side: publishing, analytics ingest, learning writes, visual render evidence, usage history e cost ledger. Prima di ogni workload tenant-scoped verifica membership/ruolo; i path Storage vengono costruiti server-side dal tenant autorizzato e non accettati come fonte autorevole dal frontend.

## Flusso E2E

```text
registration/login
→ tenant
→ onboarding
→ website scan
→ Brand Profile + locks + logo/style settings
→ goals/target/social/frequency/AUTO-MANUALE
→ strategy
→ calendar
→ core concept
→ platform variants
→ visual brief
→ Asset Library search/selection
→ Visual Director
→ template profile + template selection
→ deterministic SVG render / MockImageGenerationProvider fallback
→ visual QA
→ selective repair
→ visual fingerprint / anti-clone
→ persisted preview / carousel
→ per-platform approval
→ scheduler/idempotency
→ mock provider
→ published_posts/external_mock_id
→ analytics snapshot
→ editorial memory / learning
```

`generate-all` e la generazione singola producono anche i visual delle varianti applicabili prima dell'Approval Center. Il cliente non deve creare manualmente record DB o render.

## Asset Library / Storage

`brand_assets` conserva metadata, hash, qualità, compatibilità, stato, preferred/brand lock e usage. I file vivono nel bucket privato `brand-assets` sotto path tenant-safe.

SHA-256 evita duplicati identici nello stesso tenant. `BLOCKED` e `ARCHIVED` sono esclusi dal selection engine. Un asset già collegato a un contenuto non viene eliminato silenziosamente: il local API rifiuta il delete finché esiste il riferimento.

I documenti PDF/brochure vengono persistiti con stato di indicizzazione; il parsing AI reale resta dietro una futura ingestion interface.

## Visual Engine

Il runtime espone moduli sostituibili:

- `AssetClassifier` → implementazione locale `DeterministicAssetClassifier`;
- `AssetSelectionEngine`;
- `DeterministicVisualDirector`;
- `DeterministicGraphicRenderer`;
- `ImageGenerationProvider` → implementazione locale `MockImageGenerationProvider`;
- `ImagePromptBuilder`;
- `SelectiveQaRepairEngine`.

Il selector privilegia asset reali pertinenti e penalizza riuso recente. Una foto reale buona della pizza viene preferita a una pizza generata. Il fallback è branded graphic; l'image provider mock viene usato soltanto quando il brief richiede una nuova immagine.

## Template / anti-clone visuale

Dieci famiglie parametriche: Photo Full Bleed, Photo + Text Overlay, Split Layout, Minimal Brand Card, Quote/Testimonial, Educational Tip, Promotional, Statistic/Data, Service Highlight, Local/GBP.

Ogni tenant ha un `visual_template_profile` persistente con preferred templates, spacing, ratio, text density, logo position, border e CTA style. Il fingerprint considera template, visual type, asset, headline shape, background/palette e placement. `asset_usage_history` bilancia pertinenza e varietà.

## Renderer / formati

Il renderer locale produce SVG reali e li salva nel bucket privato `post-assets`.

Preset centralizzati:

- square 1080×1080;
- portrait 1080×1350;
- landscape 1200×630.

Il logo viene inserito mantenendo aspect ratio (`preserveAspectRatio`) e non viene ritagliato o deformato. Il renderer riceve palette/font/logo dal Brand Profile, non usa una palette globale universale.

## Carousel

Carousel locali supportati: educational, checklist, mistakes, step-by-step, before/after concettuale, FAQ e tips. Ogni slide ha indice, headline, body, layout e visual type; cover, slide intermedie e CTA finale vengono renderizzate e persistite separatamente.

## Visual QA / selective repair

Visual QA controlla lunghezza headline/body/CTA, contrasto e fact-safe graphics. I quality fields persistiti includono brand match, asset relevance, layout quality, readability, novelty, platform fit, text density e template repetition.

`content_component_versions` rende auditabili hook, caption, hashtag, CTA, visual e fact claim. Il repair modifica soltanto il componente interessato; i claim vietati rimangono blocker invece di essere nascosti da una rigenerazione automatica.

## AUTO / MANUALE per piattaforma

Una variante AUTO che supera QA entra in coda indipendentemente da una variante MANUALE della stessa campagna. La migration 008 implementa questa separazione con idempotency key per variante.

## Social / immagini live

`SocialProvider` resta il boundary comune per Instagram, Facebook, LinkedIn e Google Business Profile. `ImageGenerationProvider` è il boundary futuro per generazione/edit/variation immagine.

In questa fase entrambi usano implementazioni mock/deterministiche: nessuna chiamata OpenAI, Meta, LinkedIn o Google reale.

## Frontend

`apps/web` usa service boundary tipizzato. Con `VITE_LOCAL_API_URL` attivo dialoga con local API/database; senza variabile mantiene fallback mock per smoke test.

Route operative: dashboard, onboarding, Brand Profile + Visual Settings, Asset Library, Strategy, Calendar, Post Editor, `/approvals`, Connections, Analytics/Learning, Support, Billing/Cost ledger, Settings e Admin.

## Admin

RBAC platform-admin separato dai ruoli tenant. Il bootstrap del primo admin esiste esclusivamente nel seed locale e non nelle migrations destinate al futuro remoto.

## Evoluzione remota

Quando serviranno OAuth/provider reali:

```text
Vercel web
→ server/Edge Functions
→ Supabase remoto dedicato
→ OpenAI/provider reali
```

La foundation locale non richiede Redis, Kafka, microservizi o database aggiuntivi. Dettagli del visual layer: `VISUAL_PIPELINE.md`.
