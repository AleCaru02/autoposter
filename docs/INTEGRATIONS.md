# Integration Registry

Ultima verifica documentale: **2026-08-10**.

Regola: usare fonti primarie ufficiali e ricontrollare versione, access review, scopes e limiti prima di ogni prima chiamata live. I fixture locali rappresentano contratti realistici, ma non sono una validazione live del provider.

## OpenAI

**Superficie prevista:** Responses API / structured output, embeddings, image input/vision, image generation/editing e web research/tooling quando abilitato.

**Design applicativo:**
- `AIProvider` unico boundary coerente;
- business logic → capability registry, non model string;
- capability: `TEXT_CHEAP`, `TEXT_STANDARD`, `TEXT_REASONING`, `STRUCTURED_OUTPUT`, `EMBEDDING`, `VISION`, `IMAGE_GENERATION`, `IMAGE_EDIT`, `WEB_RESEARCH`;
- output critici sempre validati da Zod/JSON schema;
- API key esclusivamente server-side;
- timeout/retry/cost limit bounded.

**Fonti ufficiali:**
- https://platform.openai.com/docs/api-reference/responses
- https://platform.openai.com/docs/guides/structured-outputs
- https://platform.openai.com/docs/guides/images
- https://platform.openai.com/docs/guides/embeddings
- https://platform.openai.com/docs/guides/tools-web-search

## Meta / Facebook Pages

**Superficie prevista:** OAuth/account discovery, Page publishing/reading capabilities, webhook/analytics solo quando concessi dall'app reale.

**Fixture attuale:** una connection può scoprire più Facebook Pages e account Instagram professionali associati. Capability e permissions vengono valutate per account; non si assume `connection = account`.

**Regola versione:** Graph API version centralizzata in `META_GRAPH_VERSION`; nessun endpoint/versione hardcoded nella business logic.

**Permissions:** la permission matrix locale è un fixture; la lista finale deve essere ricontrollata contro la configurazione e App Review della futura Meta App prima del live.

**Fonti ufficiali / Meta-owned:**
- https://developers.facebook.com/docs/pages-api/
- https://developers.facebook.com/docs/graph-api/webhooks/
- https://www.postman.com/meta/facebook/request/xwu1y81/get-pages-that-a-user-has-access-to

## Instagram

**Account:** il contratto live è per account professionali supportati (Business/Creator), non account consumer generici.

**Fixture:** image post, carousel/reel dove supportato dal contratto configurato, account discovery, permissions, token expiry, rejection, rate limit e analytics fixture.

**Permissions fixture:** `instagram_basic`, `instagram_content_publish` e, nel percorso Facebook Login, Page permissions richieste dal collegamento. La lista finale dipende dal login/API scelto e deve essere riconfermata prima del live.

**Fonti ufficiali / Meta-owned:**
- https://www.postman.com/meta/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00
- https://developers.facebook.com/docs/instagram-platform/

## LinkedIn

**API:** Posts API / Community Management, con header/versioning corrente documentato da Microsoft. Non usare `ugcPosts` come base per nuovo codice.

**Account model:** person e organization separati. Per organization il sistema deve verificare authorization/admin requirements invece di assumere che un token personale possa pubblicare per qualunque Page.

**Formati:** il fixture supporta text, image, multi-image, video/document quando capability presente. Il carousel organico non viene modellato come capability supportata: la documentazione Posts API distingue `multiImage` dall'ad carousel.

**Permissions fixture:** `w_member_social`, `w_organization_social`, `r_organization_social` dove applicabili; accesso effettivo dipende dai prodotti approvati e dai ruoli.

**Fonti ufficiali:**
- https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
- https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/organizations/organization-authorization

## Google Business Profile

Provider separato dagli altri social. Il planner decide `native_variant | separate_concept | skip` e non forza cross-posting.

**OAuth scope principale documentato:** `https://www.googleapis.com/auth/business.manage`.

**Local Posts:** fixture per standard/local post, event e offer; CTA configurate in base ai tipi documentati (`BOOK`, `ORDER`, `SHOP`, `LEARN_MORE`, `SIGN_UP`, `CALL`).

**Limitazione:** Product Posts non vengono creati attraverso Business Profile API; il validator blocca `product` invece di inventare supporto.

**Sandbox:** non assumere sandbox completo. Usare account/test locations e `validateOnly` dove l'endpoint lo supporta quando si arriverà al remoto.

**Performance:** il provider analytics deve esporre solo metriche realmente disponibili dalla Performance API e deve tollerare metriche assenti/null.

**Fonti ufficiali:**
- https://developers.google.com/my-business/content/posts-data
- https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts
- https://developers.google.com/my-business/content/basic-setup
- https://developers.google.com/my-business/content/implement-oauth
- https://developers.google.com/my-business/reference/performance/rest

## Telegram

**API:** Bot API HTTPS corrente.

**Fixture:** chat binding, approval notification, inline callback approve/reject/open dashboard, replay prevention, tenant/chat binding e forged callback rejection.

**Webhook:** usare endpoint HTTPS e la protezione provider configurata; `update_id`/event identity deve essere usato per deduplica quando applicabile.

**Fonti ufficiali:**
- https://core.telegram.org/bots/api
- https://core.telegram.org/bots/api#setwebhook
- https://core.telegram.org/bots/api#callbackquery

## Stripe

**Scope fase:** readiness soltanto. Nessun checkout live.

**Contratto:** plan/product-price mapping, Checkout abstraction, subscription state, webhook, entitlement sync, past-due/failed-payment, cancel, upgrade/downgrade e idempotenza.

**Webhook:** signature verification, duplicate-event handling e idempotenza obbligatori; non assumere ordering degli eventi.

**Fonti ufficiali:**
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/billing/subscriptions/webhooks
- https://docs.stripe.com/billing/subscriptions/overview
- https://docs.stripe.com/billing/entitlements

## Supabase

**Uso locale attuale:** CLI + Docker. Nessun progetto cloud nuovo.

**Remoto futuro:** migrations repository-first, Auth/RLS/Storage retest, server-only service role, credential envelope/KMS boundary, Edge Functions/callback/webhook pubblici solo quando necessari.

`app_private` resta invisibile ai client. La migration provider readiness prepara OAuth state e integration credential lifecycle server-only. Per secret remote è possibile sostituire il cipher boundary con KMS/Vault senza cambiare i consumer.

**Fonti ufficiali:**
- https://supabase.com/docs/guides/local-development
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions
- https://supabase.com/docs/guides/database/vault

## Vercel

Nessun deploy effettuato in questa fase.

**Contract:** variabili per ambiente, Preview/Staging separato da Production, nessun server secret prefissato/esposto al client. Il repository GitHub resta source of truth.

Vercel supporta Local/Preview/Production; gli environment custom dipendono dal piano e devono essere verificati prima di usarli come staging dedicato.

**Fonti ufficiali:**
- https://vercel.com/docs/environment-variables
- https://vercel.com/docs/deployments/environments
- https://vercel.com/docs/git

## Provider adapter migration path

Il workflow applicativo non cambia quando arrivano le credenziali.

Social:

```text
FixtureSocialProvider
→ RealProviderAdapter implements SocialProviderV2
→ stessa capability detection / permission matrix / validator / dry-run / publish / reconcile / analytics contract
```

AI:

```text
MockAIProvider
→ OpenAIProvider implements AIProvider
→ stessa capability registry + stessi StructuredOutputSchemas
```

Billing:

```text
MockStripeProvider
→ StripeBillingProvider implements BillingProvider
→ stessi idempotency/entitlement/subscription contracts
```

La sostituzione mock→live è considerata pronta soltanto quando l'adapter reale supera la stessa suite contrattuale più i test live specifici del provider.
