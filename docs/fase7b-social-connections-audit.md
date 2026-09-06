# FASE 7B — Social connections audit

## Production evidence

- Facebook: `ACTIVE`; persisted provider account and encrypted token reference.
- Instagram: `ACTIVE`; persisted provider account and encrypted token reference.
- LinkedIn: `ACTIVE`; persisted provider account and encrypted token reference.
- Google Business Profile: `BLOCKED`; no connection row was persisted.
- Observed GBP failure: the first Account Management `accounts.list` request returned a quota-exhausted error for Google Cloud project number `822017806014`.

No token value, account identifier, email address, or provider content was read during this audit.

## GBP call graph before this change

1. One customer click sends one `POST /api/social/connect` request.
2. The Worker returns one Google OAuth authorization URL.
3. The callback exchanges the authorization code once.
4. The callback calls Account Management `accounts.list` once with an invalid `pageSize=100` (Google documents 20 as the maximum).
5. Only after discovery succeeds does the Worker persist a `PENDING_SELECTION` connection.

The customer-visible quota failure occurs at step 4, before location discovery and persistence. The frontend status refresh never calls Google; it reads only the application Data API.

## Quota conclusion

Google documents 300 QPM for an approved Account Management API project and 0 QPM when basic API access has not been granted. A single nominal callback cannot exhaust 300 QPM by itself. The exact live quota value for project `822017806014` could not be read from the Google Cloud console in the automated browser session, so the provider remains `BLOCKED` and no quota value is asserted as fact.

Required external proof before `REAL_PROVIDER_PASS`:

- live Account Management quota is 300 QPM (or another non-zero approved value);
- API access is approved and enabled for project `822017806014`;
- a real connect completes through account discovery, location discovery, selection, persistence, and `ACTIVE` state.

## Product hardening in this change

- durable, server-owned callback nonce claim before token exchange or discovery;
- completed callback replay returns the stored safe redirect result without provider calls;
- in-progress and failed callback replay is rejected without provider calls;
- bounded 429/5xx retry: at most three attempts with exponential backoff and jitter;
- Account Management pagination uses the documented maximum `pageSize=20`;
- account and location enumeration are bounded;
- quota and replay errors are translated into customer-readable messages;
- the social UI uses the canonical authenticated token boundary.

This change does not disconnect, reconnect, refresh, expose, or modify any existing provider token.
