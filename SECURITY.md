# Security

## Stato

**Foundation + local E2E VALIDATI LOCALMENTE — 2026-08-09.**

La validazione usa Supabase CLI/Docker, local API e Chromium senza utilizzare progetti Supabase cloud esistenti o secret provider reali.

## Controlli già provati

- RLS su tutte le tabelle applicative `public`;
- utenti Auth reali Tenant A/Tenant B;
- SELECT/INSERT/UPDATE/DELETE cross-tenant bloccati;
- composite FK tenant-aware;
- onboarding tenant-scoped;
- Brand Profile version history non collegabile a parent di altro tenant;
- learning leggibile tenant-scoped e non scrivibile dal client;
- `authenticated` non può creare `publication_jobs`;
- quota mutation RPC server-only;
- `anon`/`authenticated` senza `USAGE` su `app_private`;
- integration credentials non leggibili dal client;
- nessuna colonna plaintext token/secret nella tabella credenziali;
- bucket applicativi privati;
- `vector` nello schema `extensions`;
- Security Advisors: nessuna issue;
- Performance Advisors: nessuna issue;
- chatbot cross-tenant rifiutato;
- workspace cross-tenant rifiutato;
- admin senza platform-admin rifiutato;
- browser E2E senza console/page errors.

Numeri finali DB security: **27/27 pgTAP + 3 file / 20 Auth/RLS integration PASS**.

## Browser / local API boundary

Il frontend conserva soltanto sessione Auth locale e tenant selezionato. Non possiede `service_role`.

Il local API:

1. autentica l'utente;
2. verifica membership/ruolo;
3. usa la sessione utente per normali CRUD RLS;
4. usa `service_role` soltanto per workload server-only.

Cross-tenant anti-duplicate viene calcolato server-side e non restituisce il contenuto raw di altri tenant.

## `app_private`

Resta non accessibile al browser. Token social futuri e materiale sensibile appartengono a questo boundary.

Per il test admin locale il seed crea un helper e una view service-role-only. Sono **seed-only**, non migrations production-like e non devono essere copiati nel futuro ambiente remoto.

## Publishing safety

I provider sono mock. La pipeline usa:

- connection health;
- approval mode per piattaforma;
- idempotency key;
- publication attempts;
- external mock ID;
- retry classification;
- reconciliation dopo successful publish + timeout response.

Il test conferma che il retry non crea una seconda pubblicazione mock.

## AUTO/MANUALE

La migration 008 crea job AUTO indipendenti per variante dopo QA. La coda rimane server-side e `authenticated` non riceve il grant di inserimento.

## Telegram mock

Il runtime verifica HMAC, tenant/user binding, expiry e nonce one-time. Un bug del test di tampering è stato corretto garantendo che la firma alterata sia realmente diversa.

## Admin RBAC

I ruoli tenant non equivalgono a platform-admin. L'endpoint admin rifiuta utenti normali. Il claim iniziale esiste esclusivamente nel seed local-E2E.

## Cost/abuse controls

- quota reserve/commit/release server-only;
- idempotency;
- plan entitlements;
- AI usage ledger;
- theoretical price configuration da env, non hardcoded;
- page limits sul website scanner;
- same-origin crawler;
- input/time limits nelle fixture local API.

## Prima del beta pubblico

Restano obbligatori:

- ripetere RLS/FK/grant su Supabase remoto dedicato;
- secret manager e cifratura autenticata token;
- OAuth state/PKCE/redirect reali;
- webhook signature reali;
- rate limiting pubblico;
- Signed URL/Storage remoto;
- provider app review e least-privilege scopes;
- penetration/abuse tests sul deployment pubblico;
- GDPR/export/delete/revoca e policy legali.

Il progetto remoto non è necessario per la fase locale già completata.
