# Tenant isolation tests

Questa suite viene resa eseguibile appena esiste il Supabase dedicato/staging.

## Scenari obbligatori

1. User A crea Tenant A; User B crea Tenant B.
2. A può leggere/scrivere risorse consentite di A.
3. A riceve zero righe o permission error su tutte le risorse di B.
4. B non può usare connection metadata, publication job, analytics, asset o support conversation di A.
5. Un editor non può mutare social connections.
6. Un viewer non può mutare contenuti.
7. Nessun ruolo tenant può leggere `app_private.integration_credentials`.
8. `service_role` è usata solo nel test harness server-side e non dimostra sicurezza client: le assertions principali usano JWT reali dei due utenti.

Il test runtime verrà implementato con due utenti Auth reali di staging e `@supabase/supabase-js`, non con `tenant_id` simulato dal browser.