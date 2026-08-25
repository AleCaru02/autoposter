# Database

## Stato

**VALIDATO LOCALMENTE — 2026-08-10**

Supabase CLI + Docker ricostruiscono il database da zero. Nessun progetto Supabase cloud viene usato per questo SaaS in questa fase.

## Comandi

```bash
supabase start
supabase db reset --local
supabase migration list --local
supabase db lint --local --level warning --fail-on error
supabase db advisors --local --type security
supabase db advisors --local --type performance
supabase test db --local
```

La procedura applicazione + API + web + visual E2E è in `LOCAL_E2E.md`.

## Migration history validata

1. `20260809193000_001_tenancy_foundation.sql`
2. `20260809194000_002_core_domain.sql`
3. `20260809195000_003_prompt_support_storage.sql`
4. `20260809200000_004_tenant_consistency.sql`
5. `20260809201000_005_quota_engine.sql`
6. `20260809202000_006_local_validation_fixes.sql`
7. `20260809203000_007_local_e2e_state.sql`
8. `20260809204000_008_auto_variant_scheduling.sql`
9. `20260810060000_009_visual_asset_pipeline.sql`

## Migration 009 — visual asset pipeline

Estende `brand_assets` con metadata operativi:

- `asset_type`, `source`, `description`, `alt_text`;
- `dominant_colors`, `suitable_platforms`, `suitable_topics`;
- `quality_score`;
- `is_brand_locked`, `is_preferred`;
- `status` (`ACTIVE`, `ARCHIVED`, `BLOCKED`);
- `thumbnail_path`, `index_status`;
- `usage_count`, `last_used_at`, `updated_at`.

Dedupe per tenant tramite indice unico parziale `(tenant_id, content_hash)`.

Il Brand Profile può referenziare logo principale/alternativo con FK composte tenant-aware e conserva `preferred_visual_style`.

Nuove tabelle:

- `visual_template_profiles`;
- `asset_usage_history`;
- `visual_renders`;
- `content_component_versions`;
- `visual_qa_issues`.

Tutte sono tenant-scoped, RLS-enabled e le evidenze server-generated non sono scrivibili dal browser.

## Storage locale

Bucket applicativi privati:

- `brand-assets`;
- `post-assets`;
- `tenant-documents`.

Gli upload Asset Library usano path server-derived:

```text
{tenant_id}/assets/{sha-prefix}-{sanitized-filename}
```

Le policy Storage già esistenti derivano l'autorizzazione dalla prima cartella e verificano membership/role. Il frontend non è fonte autorevole del tenant.

Validazioni local API:

- MIME allowlist;
- limite byte configurabile (`LOCAL_ASSET_MAX_BYTES`, default locale 8 MB);
- filename sanitization;
- SHA-256;
- dedup identico nello stesso tenant;
- signature/corruption check per PNG/JPEG/SVG/WebP;
- dimensioni non valide rifiutate;
- PDF/brochure persistiti con `index_status=pending`.

Le preview sono signed URL. I render SVG finiscono in `post-assets/{tenant_id}/visuals/...` e sono versionati in `visual_renders`.

## Multi-tenancy

Il modello combina:

- `tenant_id`;
- RLS;
- `tenant_members` + ruoli;
- composite foreign keys `(tenant_id, id)`;
- tabelle server-only senza grant client;
- `app_private` senza `USAGE` per `anon`/`authenticated`;
- Storage path tenant-safe;
- test Auth reali Tenant A/Tenant B.

La suite visuale prova anche che Tenant A non può:

- leggere/modificare/eliminare asset B;
- caricare o elencare oggetti nel path Storage di B;
- falsificare `visual_renders`;
- vedere `asset_usage_history` di B;
- impostare come proprio logo un asset di B.

## Asset usage / anti-repetition

`asset_usage_history` registra asset, variante, piattaforma, template, visual type, fingerprint e timestamp. `brand_assets.usage_count` e `last_used_at` vengono aggiornati dal server.

Il delete di un asset già associato a `post_assets` viene rifiutato invece di lasciare un contenuto persistente con riferimento rotto.

## Visual render / component audit

`visual_renders` conserva:

- selected asset;
- render version;
- visual type/template;
- format e dimensioni;
- storage paths;
- visual spec;
- QA result;
- visual fingerprint;
- stato ready/qa_failed/superseded.

`content_component_versions` mantiene l'audit per hook, caption, hashtag, CTA, visual e fact claim. `visual_qa_issues` mantiene affected component, severity, repair action, status e dettagli.

## Quota / publishing / learning

Quota:

```text
reserve_tenant_usage
→ commit_tenant_usage
oppure
→ release_tenant_usage
```

Publishing conserva `post_variants`, `publication_jobs`, `publication_attempts`, `published_posts`, analytics e memoria editoriale. Migration 008 rende AUTO/MANUALE indipendente per variante.

Learning resta server-written/evidence-gated. `ai_usage_events` registra anche operazioni visuali mock (`asset_classification`, `image_generation`, `visual_qa`) con costo reale corrente pari a zero.

## Validazione CI visuale

Workflow `.github/workflows/tenant-isolation.yml`:

- **9/9 migrations da zero: PASS**;
- migration history: PASS;
- DB lint: PASS — `No schema errors found`;
- Security Advisors: PASS — `No issues found`;
- Performance Advisors: PASS — `No issues found`;
- pgTAP: **2 file / 45 test PASS**;
- Auth/RLS/quota/E2E-state/asset-storage isolation: **4 file / 24 test PASS**.

## Da validare sul futuro remoto

Prima di beta/provider reali dovranno essere ripetuti migrations/history/advisors/Auth/RLS/Storage sul progetto Supabase dedicato, insieme a signed URL/secret/Edge Functions reali. Fino ad allora la verifica remota è intenzionalmente posticipata e non blocca lo sviluppo locale.
