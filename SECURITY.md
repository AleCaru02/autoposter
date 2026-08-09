# Security

## Controlli obbligatori

- RLS su ogni tabella tenant-scoped.
- Tenant authorization server-side.
- `service_role`, OpenAI key, OAuth client secret e social token mai nel browser.
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

## Token social

La tabella metadata è pubblica/RLS; il materiale segreto vive in `app_private.integration_credentials`. Non esiste una colonna plaintext. Prima di attivare OAuth va implementata cifratura autenticata server-side con chiave in secret manager e rotazione/versione chiave.

## Impersonation

Non nell'MVP Core. Se introdotta: motivo obbligatorio, time-box, banner evidente, log immutabile e impossibilità di leggere secret/token.

## GDPR/legal

Il software deve offrire export, account deletion, revoca social e cancellazione dati. Privacy policy, terms, cookie e basi giuridiche richiedono revisione professionale prima del lancio commerciale.