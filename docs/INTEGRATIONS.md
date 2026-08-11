# Integration Registry

Ultima verifica documentale: **2026-08-11**.

Regola: usare esclusivamente fonti ufficiali/primarie per i contratti provider e ricontrollare versione, access review, scopes, account requirements e limiti prima della prima chiamata live. I fixture locali dimostrano il contratto applicativo; **non** equivalgono a una validazione live del provider.

## OpenAI

- **Data verifica:** 2026-08-11.
- **API/version:** API HTTPS `/v1`; integrazione futura centrata su Responses API. Nessun model ID viene hardcodato nella business logic: la scelta passa dal capability registry.
- **Scopes/permissions:** API key server-side; nessuna chiave viene esposta al browser.
- **Account requirements:** progetto/account OpenAI con API key e billing/limiti adeguati al test live. Nessuna credenziale reale è presente in questa fase.
- **Publishing capabilities:** non applicabile. Le capability applicative previste sono text/structured output, embeddings, vision/document intelligence, image generation/edit e web research quando esplicitamente abilitato.
- **Analytics capabilities:** usage/cost tracking applicativo; nessuna metrica social proviene da OpenAI.
- **Callback requirements:** nessun OAuth callback richiesto per il primo adapter server-side.
- **Webhook requirements:** non richiesti dal primo adapter previsto.
- **Limitations:** output business-critical validato tramite schema; timeout, rate limit, refusal/safety, risposta vuota e cost ceiling devono restare errori/decisioni esplicite. Responses può mantenere application state a seconda della configurazione: la data-retention policy va verificata prima del live.
- **Official source:**
  - https://platform.openai.com/docs/api-reference/responses
  - https://platform.openai.com/docs/quickstart
  - https://platform.openai.com/docs/guides/structured-outputs
  - https://platform.openai.com/docs/guides/images
  - https://platform.openai.com/docs/guides/embeddings
  - https://platform.openai.com/docs/models/default-usage-policies-by-endpoint

**Design applicativo confermato:** `AIProvider` unico boundary, capability registry al posto di model string, output critici validati da Zod/JSON Schema, secret server-only, timeout/retry/cost limit bounded.

## Meta / Facebook Pages

- **Data verifica:** 2026-08-11.
- **API/version:** Graph API; versione centralizzata in `META_GRAPH_VERSION`. Le collezioni ufficiali Meta usano una variabile `api_version`, quindi nessuna versione Graph viene hardcodata nella business logic prima della futura app reale.
- **Scopes/permissions:** la matrice locale resta un fixture. La permission list finale deve essere calcolata sul prodotto realmente attivato e passare App Review/Access Level dove richiesto. Account discovery usa un User Access Token per ottenere le Pages gestibili e relativo Page Access Token.
- **Account requirements:** una `ProviderConnection` Meta può esporre più Facebook Pages e account Instagram professionali associati; `ProviderConnection != ProviderAccount`.
- **Publishing capabilities:** publishing Page solo dopo capability/permission validation dell'account selezionato. Formato e payload restano provider-specific.
- **Analytics capabilities:** solo metriche disponibili per oggetto/account e permission effettivamente concessa; nessun campo viene promesso dal fixture come garanzia live.
- **Callback requirements:** HTTPS OAuth callback registrato nella futura Meta App; redirect allowlist e state/PKCE gestiti dal core applicativo.
- **Webhook requirements:** endpoint HTTPS pubblico in staging/live. Meta documenta firma `X-Hub-Signature-256` con HMAC-SHA256/App Secret per gli Event Notifications; la verifica applicativa deve operare sugli stessi raw bytes ricevuti e deduplicare i retry.
- **Limitations:** access token/Page tasks e App Review determinano le capability reali. Il fixture non rende una Page pubblicabile se manca la permission richiesta.
- **Official source / Meta-owned:**
  - https://developers.facebook.com/docs/pages-api/
  - https://developers.facebook.com/docs/graph-api/webhooks/
  - https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api
  - https://www.postman.com/meta/facebook/request/bqfxwbp/get-access-tokens-of-pages-you-manage

## Instagram

- **Data verifica:** 2026-08-11.
- **API/version:** Instagram API su Graph; l'applicazione tratta Instagram come account/capability separabile, anche quando la connessione e l'autorizzazione appartengono all'ecosistema Meta.
- **Scopes/permissions:** esistono due percorsi ufficiali da non confondere:
  - **Facebook Login:** `pages_show_list`, `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`; `instagram_manage_comments` soltanto se serve quella capability. Per gli Insights: `instagram_manage_insights` e requisiti correlati.
  - **Instagram Login:** i nuovi scope ufficiali includono `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_messages`, `instagram_business_manage_comments`; per Insights è documentato `instagram_business_manage_insights`. I vecchi scope `business_*` sono stati deprecati il 27 gennaio 2025.
- **Account requirements:** account Instagram professionale Business/Creator. Nel percorso Facebook Login è richiesta una Facebook Page collegata; nel percorso Instagram Login **non** è richiesto il collegamento a una Facebook Page.
- **Publishing capabilities:** content publishing per account professionali supportati; nel percorso Facebook Login la documentazione ufficiale indica publishing disponibile per tutti gli account professionali, con Stories limitate agli account Business. Reels/container flow è documentato separatamente. Il validator applicativo mantiene image/carousel/reel come capability distinte e non le abilita per alias.
- **Analytics capabilities:** insights per media/account solo con permission e access level applicabile; non assumere metriche identiche tra i due login model.
- **Callback requirements:** callback coerente con il login model scelto e registrato nella futura app Meta.
- **Webhook requirements:** webhook server per le capability che lo richiedono; comment/live-comment subscriptions e altri fields dipendono dalla feature realmente attivata.
- **Limitations:** consumer account non supportati dal percorso Facebook Login; Instagram Login non fornisce ads/tagging nel setup documentato. Standard/Advanced Access dipendono da chi possiede/gestisce gli account serviti.
- **Official source / Meta-owned:**
  - https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
  - https://www.postman.com/meta/instagram/folder/23987686-3a75357f-e106-47ef-a8d9-af1aadf85365
  - https://www.postman.com/meta/instagram/folder/23987686-98bfade9-3736-4738-8b4a-f56d6534f6de
  - https://developers.facebook.com/docs/instagram-platform/

**Differenza rilevata 2026-08-11:** la documentazione precedente non esplicitava i due login model né i nuovi scope `instagram_business_*`. Registry aggiornato; nessuna credenziale/app reale è stata creata.

## LinkedIn

- **Data verifica:** 2026-08-11.
- **API/version:** Posts API (`/rest/posts`), che sostituisce `ugcPosts` per nuovo codice. Header richiesti dalla documentazione: `Linkedin-Version: YYYYMM` e `X-Restli-Protocol-Version: 2.0.0`. La documentazione versioning consultata nel controllo finale mostra **202607** come versione Marketing corrente da usare come riferimento prima del live; `LINKEDIN_API_VERSION` resta configurazione environment, non hardcoded.
- **Scopes/permissions:** `w_member_social` per pubblicare come membro; `w_organization_social` per pubblicare come organizzazione; `r_organization_social` per letture organizzazione; `r_member_social` è restricted e disponibile soltanto a utenti approvati.
- **Account requirements:** person e organization sono account applicativi separati. Per organization, `w_organization_social` è limitata a organizzazioni dove il membro autenticato ha un ruolo ammesso; la documentazione Posts API elenca `ADMINISTRATOR`, `DIRECT_SPONSORED_CONTENT_POSTER`, `CONTENT_ADMIN`.
- **Publishing capabilities:** organic text, image, video, document, article, MultiImage, poll e celebration sono documentati come supportati; organic carousel non è supportato, mentre carousel è sponsored. Il fixture blocca i formati non supportati invece di convertirli silenziosamente.
- **Analytics capabilities:** soltanto API/permission effettivamente abilitate nel prodotto LinkedIn approvato; fixture analytics non equivale a access approval.
- **Callback requirements:** OAuth authorization-code redirect registrato nella futura LinkedIn app.
- **Webhook requirements:** nessun webhook viene presunto necessario per il publishing base; eventuali webhook/notifications vanno aggiunti soltanto per feature documentate e approvate.
- **Limitations:** product access, restricted permissions e organization role devono essere validati live. Posts API non esegue URL scraping automatico per costruire article posts: titolo/description/thumbnail vanno forniti esplicitamente quando richiesti.
- **Official source:**
  - https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
  - https://learn.microsoft.com/en-us/linkedin/marketing/versioning
  - https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
  - https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/organizations/organization-authorization

**Differenza rilevata 2026-08-11:** registrato il riferimento versione Marketing corrente `202607` e i ruoli organization ammessi dalla Posts API. La versione live rimane environment-controlled.

## Google Business Profile

- **Data verifica:** 2026-08-11.
- **API/version:** Business Profile APIs; Local Posts rimane esposto dal resource path v4 `accounts.locations.localPosts`. Il provider è separato dagli altri social e il planner può decidere `native_variant | separate_concept | skip`.
- **Scopes/permissions:** scope principale previsto `https://www.googleapis.com/auth/business.manage`; la reference Local Posts accetta anche il legacy `https://www.googleapis.com/auth/plus.business.manage`.
- **Account requirements:** Google account valido, progetto Google Cloud e accesso Business Profile API; publishing è sempre riferito a una `location` esplicita appartenente all'account autorizzato.
- **Publishing capabilities:** Local Posts per news/standard, event, CTA e offer. CTA documentate: `BOOK`, `ORDER`, `SHOP`, `LEARN_MORE`, `SIGN_UP`, `CALL`.
- **Analytics capabilities:** provider analytics limitato alle metriche realmente disponibili dalla Business Profile Performance API e tollerante a metriche assenti/null.
- **Callback requirements:** redirect OAuth registrato nel futuro progetto Google Cloud.
- **Webhook requirements:** non presunto dal contratto base Local Posts/Performance; eventuali notification surface devono essere aggiunte soltanto se documentate per la capability scelta.
- **Limitations:** **Product Posts non possono essere creati tramite API** secondo la documentazione ufficiale corrente; il validator li blocca. Non si assume un sandbox completo; `validateOnly` viene usato soltanto sugli endpoint che lo documentano.
- **Official source:**
  - https://developers.google.com/my-business/content/overview
  - https://developers.google.com/my-business/content/posts-data
  - https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create
  - https://developers.google.com/my-business/content/basic-setup
  - https://developers.google.com/my-business/content/implement-oauth
  - https://developers.google.com/my-business/reference/performance/rest

## Telegram

- **Data verifica:** 2026-08-11.
- **API/version:** Telegram Bot API **10.2**, pubblicata il 14 luglio 2026 secondo la pagina ufficiale consultata.
- **Scopes/permissions:** non usa OAuth scopes; l'autorizzazione del bot deriva dal Bot Token e dai permessi del bot/chat.
- **Account requirements:** bot creato e chat/user binding persistito lato tenant prima di accettare decisioni di approvazione.
- **Publishing capabilities:** nel SaaS Telegram è un canale di approval/control, non il social publisher primario.
- **Analytics capabilities:** non venduta come analytics social; si registrano delivery/callback/audit applicativi del workflow.
- **Callback requirements:** inline `callback_query` per approve/reject/open dashboard; il payload applicativo deve essere firmato/bound a tenant, user/chat e one-time/replay semantics.
- **Webhook requirements:** `setWebhook` usa URL HTTPS pubblico. Telegram supporta `secret_token`, restituito in `X-Telegram-Bot-Api-Secret-Token`; deve essere verificato server-side. `update_id` è utilizzabile per deduplica e recovery della sequenza.
- **Limitations:** `getUpdates` e webhook sono mutuamente esclusivi mentre un webhook è configurato; Telegram ritenta webhook non-2xx. Il Bot Token non deve mai comparire in log/UI.
- **Official source:**
  - https://core.telegram.org/bots/api
  - https://core.telegram.org/bots/api#setwebhook
  - https://core.telegram.org/bots/api#callbackquery

**Differenza rilevata 2026-08-11:** registrata la Bot API corrente 10.2 e resa esplicita la verifica `X-Telegram-Bot-Api-Secret-Token`.

## Stripe

- **Data verifica:** 2026-08-11.
- **API/version:** readiness soltanto; nessun checkout live. La reference ufficiale consultata riporta `2026-02-25.clover` come current API version. Il webhook endpoint può avere una API version specifica oppure ereditare quella dell'account; la versione live dovrà essere pin/verified al momento della creazione endpoint e compatibile con lo Stripe SDK scelto.
- **Scopes/permissions:** secret key server-side; webhook signing secret server-side. Nessuna publishable/secret key viene inserita in questo branch.
- **Account requirements:** Stripe account soltanto quando si passa a staging/live billing; prodotti/prezzi/feature reali non vengono creati in questa fase.
- **Publishing capabilities:** non applicabile. Contratto billing: Checkout abstraction, subscription state, upgrade/downgrade, cancel, failed payment e entitlement sync.
- **Analytics capabilities:** billing/subscription state, non social analytics.
- **Callback requirements:** return/success/cancel URL del Checkout saranno configurati soltanto nel flow live.
- **Webhook requirements:** endpoint HTTPS pubblico; firma verificata sul **raw request body**, duplicate event/event ID gestiti idempotentemente e processing retry sicuro. Non dipendere dall'ordine degli eventi.
- **Limitations:** Stripe Entitlements può notificare `entitlements.active_entitlement_summary.updated`; il summary webhook contiene un massimo di 10 entitlements e, oltre tale quantità, va letta la lista paginata. L'applicazione mantiene comunque il proprio server-side entitlement gate.
- **Official source:**
  - https://docs.stripe.com/api/versioning
  - https://docs.stripe.com/api/idempotent_requests
  - https://docs.stripe.com/webhooks
  - https://docs.stripe.com/webhooks/versioning
  - https://docs.stripe.com/billing/subscriptions/webhooks
  - https://docs.stripe.com/billing/subscriptions/overview
  - https://docs.stripe.com/billing/entitlements

**Differenza rilevata 2026-08-11:** registrata la current API version documentata `2026-02-25.clover` e la regola di versioning del webhook endpoint; nessuna versione viene attivata senza account reale.

## Supabase

- **Data verifica:** 2026-08-11.
- **API/version:** sviluppo locale via Supabase CLI + Docker, database PostgreSQL 17 configurato dal progetto. Nessun nuovo progetto cloud.
- **Scopes/permissions:** Auth/RLS come boundary client; service role esclusivamente server-side. `app_private` non deve essere esposto al client.
- **Account requirements:** nessun nuovo account/progetto remoto richiesto nella fase attuale.
- **Publishing capabilities:** non applicabile.
- **Analytics capabilities:** database/advisor/lint e audit applicativo locali; nessuna telemetria remota aggiunta.
- **Callback requirements:** Edge Functions/callback pubblici solo quando Dedicated Staging li rende necessari.
- **Webhook requirements:** le funzioni future devono poter ricevere raw body quando il provider firma i bytes originali.
- **Limitations:** il rate limit Auth locale `sign_in_sign_ups` è configurabile in `config.toml`; il default documentato dalla CLI è 30 richieste ogni 5 minuti per IP. La suite E2E locale alza questo limite perché crea intenzionalmente molti utenti isolati dalla stessa runner IP: non è una policy production.
- **Official source:**
  - https://supabase.com/docs/guides/local-development
  - https://supabase.com/docs/guides/cli/config
  - https://supabase.com/docs/guides/auth/rate-limits
  - https://supabase.com/docs/guides/database/postgres/row-level-security
  - https://supabase.com/docs/guides/functions
  - https://supabase.com/docs/guides/database/vault

**Uso futuro remoto:** migrations repository-first, Auth/RLS/Storage retest, service-role server-only, credential envelope/KMS boundary e callback/webhook pubblici solo quando necessari.

## Vercel

- **Data verifica:** 2026-08-11.
- **API/version:** servizio di deployment; nessuna API version applicativa da pin nel prodotto.
- **Scopes/permissions:** environment variables per target; secret server-side non prefissati/esposti al client. Vercel supporta Sensitive Environment Variables con valore nascosto nel Dashboard dopo configurazione.
- **Account requirements:** progetto collegato a GitHub soltanto quando si passa al vero staging; GitHub resta source of truth.
- **Publishing capabilities:** deploy software, non publishing social.
- **Analytics capabilities:** non richieste dal contratto provider del SaaS.
- **Callback requirements:** Dedicated Staging dovrà avere un URL stabile utilizzabile per OAuth callback/provider webhooks prima dei test live.
- **Webhook requirements:** non richiesti per la base deploy; i provider chiameranno gli endpoint del SaaS ospitati nell'environment appropriato.
- **Limitations:** Vercel ha tre environment predefiniti Local/Preview/Production; i Custom Environments e relativi entitlement dipendono dal piano corrente. Nessun custom staging viene creato in questa fase.
- **Official source:**
  - https://vercel.com/docs/deployments/overview
  - https://vercel.com/docs/deployments/environments
  - https://vercel.com/docs/environment-variables
  - https://vercel.com/docs/environment-variables/manage-across-environments
  - https://vercel.com/docs/cli/env
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
