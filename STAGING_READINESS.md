# Staging Readiness

Verificato: **2026-08-10**.

Questa fase prepara il passaggio `LOCAL → STAGING → PRODUCTION` senza attivare provider live, creare nuovi progetti cloud o inserire secret reali.

## Environment contract

| Ambiente | Provider | Publishing | Secret reali | Scopo |
|---|---|---|---|---|
| `LOCAL` | fixture/mock | `MOCK` | no | sviluppo, contract test, OAuth/webhook fixture, E2E |
| `STAGING` | reali opzionali per flag | `DRY_RUN` di default | sì, solo quando autorizzati | callback OAuth/webhook e test live controllati |
| `PRODUCTION` | reali per feature flag | `LIVE` solo con `AUTO_PUBLISH=true` | sì | traffico cliente |

`AUTO_PUBLISH=false` è il default sicuro. Non usare controlli impliciti basati su `localhost`.

## Callback e webhook URL contract

Quando esisterà un API base pubblico di staging, registrare URL espliciti e stabili:

- Meta OAuth: `<API_BASE>/oauth/meta/callback`
- LinkedIn OAuth: `<API_BASE>/oauth/linkedin/callback`
- Google Business Profile OAuth: `<API_BASE>/oauth/google-business-profile/callback`
- Meta webhook: `<API_BASE>/webhooks/meta`
- Telegram webhook: `<API_BASE>/webhooks/telegram`
- Stripe webhook: `<API_BASE>/webhooks/stripe`

Ogni callback deve validare provider, tenant, user, redirect e OAuth state one-time. Ogni webhook deve verificare firma/timestamp dove supportato e applicare deduplica/idempotenza prima degli effetti.

## Secret richiesti quando si passa live

### OpenAI
- `OPENAI_API_KEY`
- capability→model configuration (`AI_MODEL_*`)

### Meta / Facebook / Instagram
- `META_APP_ID`
- `META_APP_SECRET`
- `META_GRAPH_VERSION`
- redirect URI approvato
- webhook verify/signature configuration

### LinkedIn
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_REDIRECT_URI`
- `LINKEDIN_API_VERSION`
- prodotti/scopes approvati per l'app

### Google Business Profile
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_GBP_REDIRECT_URI`
- progetto/API access approvati

### Telegram
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_WEBHOOK_URL`

### Stripe
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- price IDs configurati per plan mapping

### Supabase remoto
- `SUPABASE_URL`
- publishable key
- service-role key esclusivamente server-side
- credential encryption/KMS configuration

## Dashboard settings da configurare al go-live

### Meta
1. creare app appropriata al caso d'uso;
2. registrare redirect OAuth esatto;
3. configurare Webhooks richiesti;
4. richiedere/ottenere permissions necessarie;
5. configurare versione Graph esplicita;
6. lasciare `META_LIVE=false` fino ai test live positivi.

### LinkedIn
1. creare app;
2. registrare redirect URL esatto;
3. richiedere Community Management / prodotti necessari;
4. registrare scopes/ruoli realmente concessi;
5. configurare `LINKEDIN_API_VERSION` centralmente;
6. lasciare `LINKEDIN_LIVE=false` fino ai test live positivi.

### Google Business Profile
1. creare/associare Cloud project;
2. richiedere accesso alle Business Profile APIs quando necessario;
3. configurare OAuth consent/client;
4. registrare redirect URI;
5. collegare account/location e validare `business.manage`;
6. lasciare `GBP_LIVE=false` fino ai test live positivi.

### Telegram
1. creare bot;
2. registrare webhook HTTPS e secret token/configurazione;
3. completare binding chat autorizzata;
4. verificare callback replay/tenant/chat;
5. lasciare `TELEGRAM_LIVE=false` fino ai test live positivi.

### Stripe
1. creare Products/Prices coerenti con i piani interni;
2. configurare price mapping server-side;
3. creare webhook endpoint;
4. verificare firma, duplicate events, ordering e idempotenza;
5. verificare entitlement sync/past_due/cancel/upgrade/downgrade;
6. lasciare `STRIPE_LIVE=false` fino ai test live positivi.

## Vercel / staging

Non viene creato alcun deploy in questa fase. Quando autorizzato:

- collegare repository GitHub come source of truth;
- usare environment variables per ambiente;
- usare Preview/Staging separato da Production;
- non esporre service-role/social/OpenAI/Stripe secrets al browser;
- eseguire `check-provider-readiness` prima di ogni attivazione live.

## Supabase remote migration path

Quando sarà disponibile il progetto dedicato:

1. applicare migrations nella stessa history del repository;
2. eseguire DB lint + Security/Performance Advisors;
3. ripetere Auth/RLS/Storage cross-tenant tests;
4. configurare credenziali server-only / KMS-encryption boundary;
5. configurare callback/webhook pubblici;
6. attivare un solo provider per volta via feature flag;
7. eseguire provider contract + live smoke + rollback/revoke test;
8. mantenere `AUTO_PUBLISH=false` finché publish/reconcile/idempotency non sono provati live.

## Mock → live adapter migration

L'orchestrator non cambia. Per ogni social provider:

`FixtureSocialProvider → <RealProviderAdapter> → SocialProviderV2`

Il nuovo adapter deve superare la suite comune:

- connection/OAuth exchange;
- list accounts;
- capability detection;
- permission matrix;
- connection health;
- content validation;
- dry-run;
- publish;
- reconcile/idempotency;
- analytics disponibili;
- disconnect/revoke;
- error classification.

Per OpenAI:

`MockAIProvider → OpenAIProvider → AIProvider`

Il router continua a richiedere capability (`TEXT_STANDARD`, `VISION`, `IMAGE_GENERATION`, ecc.) e non model IDs. L'adapter live deve produrre gli stessi output Zod validati dei contract test.

## Gate prima di STAGING live

Tutti devono essere veri:

- migrations/RLS/Auth/Storage remote verdi;
- callback URL pubblici disponibili;
- credential encryption server-side configurata;
- provider feature flag ancora OFF;
- contract fixture tests verdi;
- provider-specific live credentials disponibili;
- permission/scopes review completata;
- webhook verifier e deduplica pronti;
- dry-run verde;
- reconnect/revoke verde;
- audit log senza token;
- browser E2E verde;
- `AUTO_PUBLISH=false`.

## Fonti ufficiali

Vedere `docs/INTEGRATIONS.md`. Le API e permission devono essere ricontrollate prima della prima attivazione live perché versioni, access review e limiti possono cambiare.
