# Security

## Stato

**Foundation database VALIDATA LOCALMENTE — 2026-08-09.**

La validazione viene eseguita su Supabase CLI + Docker in GitHub Actions, senza usare progetti cloud esistenti e senza secret remoti.

## Controlli obbligatori

- RLS su ogni tabella applicativa `public`.
- Tenant authorization server-side.
- Foreign key composte `(tenant_id, id)` per impedire riferimenti cross-tenant anche conoscendo un UUID valido.
- `service_role`, OpenAI key, OAuth client secret e social token mai nel browser.
- `service_role` con grant PostgreSQL espliciti solo per workload trusted server-side.
- OAuth `state` one-time e redirect allowlist.
- CSRF dove applicabile.
- Telegram/Stripe/provider webhook signature o secret verification.
- Rate limit per endpoint costosi/sensibili.
- Input e file validation.
- Signed URL per asset privati.
- RBAC admin separato dai ruoli tenant.
- Audit log per azioni privilegiate.
- Correlation ID per job e richieste esterne.
- Safe redirect validation.

## Controlli già provati localmente

- Tutte le tabelle applicative `public` risultano con RLS abilitata nel test strutturale.
- Utente Tenant A non può SELECT righe Tenant B.
- Tenant A non può INSERT righe attribuite a Tenant B.
- UPDATE/DELETE di Tenant A contro Tenant B non modificano alcuna riga.
- Tenant A può CRUD sulle proprie risorse.
- Tentativo di FK cross-tenant viene rifiutato.
- `authenticated` non può scrivere `publication_jobs`.
- `authenticated` non può chiamare le RPC di mutazione quota.
- `anon` e `authenticated` non hanno `USAGE` su `app_private`.
- `authenticated` non può leggere `app_private.integration_credentials`.
- La tabella delle credenziali non contiene colonne plaintext `token`, `access_token`, `refresh_token`, `secret` o `client_secret`.
- Tre bucket applicativi verificati come privati.
- Extension `vector` spostata nello schema `extensions`.
- Security Advisors locali: **No issues found**.
- Performance Advisors locali: **No issues found**.

## Token social

La tabella metadata è pubblica/RLS; il materiale segreto vive in `app_private.integration_credentials`. Non esiste una colonna plaintext. Prima di attivare OAuth va implementata cifratura autenticata server-side con chiave in secret manager e rotazione/versione chiave.

Il client non avrà accesso diretto allo schema privato; le operazioni con token passano esclusivamente da codice trusted server-side.

## Quota e abuso

Le funzioni `reserve_tenant_usage`, `commit_tenant_usage` e `release_tenant_usage` sono server-only. La suite locale verifica idempotenza, limiti e isolamento dei contatori fra due tenant.

## Impersonation

Non nell'MVP Core. Se introdotta: motivo obbligatorio, time-box, banner evidente, log immutabile e impossibilità di leggere secret/token.

## Da validare prima del beta pubblico

- stesso set di RLS/FK/grant su Supabase remoto dedicato;
- Auth e refresh reali;
- Signed URL e Storage remoto;
- cifratura token con secret manager;
- OAuth state/PKCE/redirect reali;
- firme webhook reali;
- rate limiting pubblico;
- Security/Performance Advisors remoti;
- tentativi cross-tenant sul deployment pubblico.

## GDPR/legal

Il software deve offrire export, account deletion, revoca social e cancellazione dati. Privacy policy, terms, cookie e basi giuridiche richiedono revisione professionale prima del lancio commerciale.
