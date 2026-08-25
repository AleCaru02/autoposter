# Security

## Stato

**Foundation database + visual asset pipeline VALIDATE LOCALMENTE — 2026-08-10.**

La validazione usa Supabase CLI + Docker in GitHub Actions, senza progetti cloud esistenti e senza secret remoti.

## Controlli obbligatori

- RLS su ogni tabella applicativa `public`.
- Tenant authorization server-side.
- Foreign key composte `(tenant_id, id)` sulle relazioni sensibili.
- Storage privato con path tenant-safe.
- `service_role`, OpenAI key, OAuth client secret e social token mai nel browser.
- `service_role` solo per workload trusted server-side.
- OAuth `state` one-time e redirect allowlist prima del provider live.
- Webhook signature verification prima del provider live.
- Rate limit per endpoint costosi/sensibili.
- Input/file validation.
- Signed URL per asset privati.
- RBAC admin separato dai ruoli tenant.
- Audit/versioning per azioni e repair privilegiati.
- Correlation/idempotency per job e richieste esterne.

## Controlli provati localmente

Database/Auth/RLS:

- tutte le tabelle applicative `public` hanno RLS;
- Tenant A non può SELECT/INSERT/UPDATE/DELETE righe Tenant B;
- Tenant A può CRUD sulle proprie risorse dove previsto;
- FK cross-tenant rifiutate;
- `authenticated` non può scrivere `publication_jobs`;
- `authenticated` non può chiamare RPC quota di mutazione;
- `anon`/`authenticated` non hanno `USAGE` su `app_private`;
- `authenticated` non può leggere `app_private.integration_credentials`;
- nessuna colonna plaintext token/secret nella tabella credenziali;
- `vector` vive in `extensions`;
- Security Advisors: **No issues found**;
- Performance Advisors: **No issues found**.

Visual/asset/Storage:

- `brand-assets`, `post-assets`, `tenant-documents` privati;
- upload path costruito server-side come `{tenant_id}/...` dopo membership/role check;
- Tenant A non può caricare nel path Storage Tenant B;
- Tenant A non può leggere/modificare/eliminare asset Tenant B;
- cross-tenant logo reference rifiutata dalla FK composta;
- `visual_renders`, `asset_usage_history`, `visual_qa_issues` e component versions sono server-generated/read-only per il client dove previsto;
- supersede render filtrato per tenant + variante;
- delete asset referenziato rifiutato (`asset_in_use`);
- signed preview per asset/render privati;
- MIME allowlist, size limit configurabile, filename sanitization, hash/dedup e corruption checks.

Suite finale database/security:

- pgTAP **45/45 PASS**;
- Auth/RLS/quota/asset-storage integration **24/24 PASS**.

## Fact-safe graphics

Il renderer riceve forbidden claims dal Brand Profile. Headline/supporting text che introducono una claim vietata producono un blocker `FORBIDDEN_FACT_CLAIM`; il visual non viene considerato QA-green.

Il MockImageGenerationProvider e l'ImagePromptBuilder vietano per contratto loghi inventati, prodotti non verificati e false testimonianze. Prima del provider image live serviranno moderazione/provider-safety e secret server-side.

## Logo safety

Il renderer mantiene aspect ratio (`preserveAspectRatio="xMidYMid meet"`) e non applica crop/recolor arbitrario al logo. Logo principale/alternativo devono appartenere allo stesso tenant del Brand Profile tramite composite FK.

## Token social

Metadata connessioni resta separato dai secret. Il materiale segreto vive in `app_private.integration_credentials`; prima dell'OAuth reale va aggiunta cifratura autenticata server-side con chiave remota versionata/ruotabile.

## Quota / abuse

`reserve_tenant_usage`, `commit_tenant_usage`, `release_tenant_usage` sono server-only. Idempotenza, limiti e isolamento contatori sono coperti dai test locali.

## Admin

RBAC platform-admin è separato dai ruoli tenant. Il primo admin locale può essere assegnato soltanto tramite helper seed-only dev; tale shortcut non appartiene alle migrations production-like.

## Prima del beta pubblico

Da ripetere/aggiungere sul futuro ambiente remoto:

- migrations/history/advisors;
- Auth/RLS/Storage/signed URL;
- secret encryption e rotation;
- OAuth state/PKCE/redirect;
- webhook signatures;
- rate limiting pubblico;
- provider/image moderation;
- cross-tenant test sul deployment pubblico;
- security headers/cookie/session policy production.

## GDPR/legal

Il prodotto dovrà offrire export, account deletion, revoca social e cancellazione dati. Privacy policy, termini, cookie e basi giuridiche richiedono revisione professionale prima del lancio commerciale.
