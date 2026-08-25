# Staging Readiness

Verificato: **2026-08-11**.

Questa fase prepara il passaggio `LOCAL → DEDICATED STAGING → PRODUCTION` senza attivare provider live, creare Supabase remoto o inserire secret reali.

## Gate locale

Prima di qualsiasi credential/live work sono stati chiusi i gate locali:

- Runtime strict: PASS;
- Runtime tests: **151/151 PASS**;
- Local API strict/tests: PASS;
- Web strict/tests/build: PASS;
- migrations: **11/11 PASS**;
- pgTAP: **71/71 PASS**;
- DB/Auth/RLS/Storage integration: **29/29 PASS**;
- DB lint: PASS;
- Security Advisors: **0 issue**;
- Performance Advisors: **0 issue**;
- Full Playwright E2E: **22/22 PASS**;
- Full Playwright E2E repeat sullo stesso HEAD: **22/22 PASS**;
- Media Picker lifecycle: PASS;
- provider browser/API E2E: PASS;
- webhook security E2E: PASS;
- mobile/responsive E2E: PASS.

## Environment contract

| Ambiente | Provider | Publishing | Secret reali | Scopo |
|---|---|---|---|---|
| `LOCAL` | fixture/mock | `MOCK` | no | contract/security/E2E |
| `STAGING` | un provider reale per volta | `DRY_RUN` di default | sì, solo quando autorizzati | callback/webhook e live validation controllata |
| `PRODUCTION` | reali per feature flag | `LIVE` solo con gate esplicito | sì | traffico cliente |

`AUTO_PUBLISH=false` resta il default sicuro. Il checker blocca `AUTO_PUBLISH=true` in `STAGING`.

## check-provider-readiness

Il checker finale distingue per ciascun provider:

- `ARCHITECTURE`;
- `CONTRACT`;
- `SECURITY`;
- `UI`;
- `TESTS`;
- `CREDENTIALS`;
- `REMOTE CALLBACK` / webhook;
- `LIVE VALIDATION`.

Sul gate locale finale i primi cinque risultano `READY` per tutti i provider sotto. Le parti mancanti sono intenzionalmente credenziali reali, endpoint pubblici dove richiesti e live validation.

| Provider | Stato locale | Manca prima del live |
|---|---|---|
| OpenAI | **READY_FOR_CREDENTIALS** | `OPENAI_API_KEY`, model/capability config reale, live validation; nessuna callback richiesta per l'adapter server-side iniziale |
| Meta/Facebook | **READY_FOR_CREDENTIALS** | App ID/secret, callback pubblico, webhook/config permission, live validation |
| Instagram | **READY_FOR_CREDENTIALS** | boundary Meta reale, callback pubblico, permission/account validation, live validation |
| LinkedIn | **READY_FOR_CREDENTIALS** | client ID/secret, redirect pubblico, API version/scopes approvati, live validation |
| Google Business Profile | **READY_FOR_CREDENTIALS** | Google credentials, redirect pubblico, API/account/location access, live validation |
| Telegram | **READY_FOR_CREDENTIALS** | bot token, webhook secret/URL pubblico, chat binding, live validation |
| Stripe | **READY_FOR_CREDENTIALS** | secret/webhook secret, public webhook in staging, price mapping reale, live validation |

`READY_FOR_CREDENTIALS` non significa production-ready: significa che architecture/contracts/security/UI/tests sono verdi e che il prossimo blocco è la configurazione live controllata.

## Callback e webhook contract

Quando esisterà un API base pubblico di staging:

- Meta OAuth: `<API_BASE>/oauth/meta/callback`;
- LinkedIn OAuth: `<API_BASE>/oauth/linkedin/callback`;
- Google Business Profile OAuth: `<API_BASE>/oauth/google-business-profile/callback`;
- Meta webhook: `<API_BASE>/webhooks/meta`;
- Telegram webhook: `<API_BASE>/webhooks/telegram`;
- Stripe webhook: `<API_BASE>/webhooks/stripe`.

Ogni callback deve validare provider, tenant, user, redirect e OAuth state one-time. Ogni webhook deve verificare firma/timestamp dove supportato e applicare deduplica/idempotenza prima degli effetti.

## Piano operativo successivo — NON ESEGUITO

Solo dopo autorizzazione esplicita:

1. creare **Dedicated Staging** separato da produzione;
2. applicare la stessa migration history e rieseguire DB/RLS/security gate remoti;
3. configurare un `APP_BASE_URL` pubblico di staging e mantenere `AUTO_PUBLISH=false`;
4. configurare esclusivamente **OpenAI** come primo provider live;
5. aggiungere `OPENAI_API_KEY` server-side e capability→model config senza esporla al browser;
6. eseguire contract smoke con output Zod/structured validation;
7. eseguire un singolo live validation controllato, con costo esplicitamente autorizzato;
8. validare audit/cost ledger/error handling;
9. mantenere tutti i social, Telegram e Stripe ancora mock/off;
10. soltanto dopo OpenAI verde rivalutare il provider successivo.

Questa fase non crea staging, non configura credenziali e non esegue chiamate live.

## Safety invariata

- nessun provider live attivato;
- nessun progetto Supabase remoto creato;
- nessun acquisto;
- nessun deploy production;
- nessun merge della PR #1;
- PR #1 resta Draft;
- costo fisso aggiuntivo: **€0**.

## Fonti operative

Le versioni/API/permission esterne devono essere ricontrollate in `docs/INTEGRATIONS.md` immediatamente prima della prima attivazione live, perché possono cambiare nel tempo.
