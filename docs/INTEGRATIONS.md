# Integration Registry

Ultima verifica documentale: 2026-08-09. Usare solo fonti ufficiali e ricontrollare prima di cambiare versione/scopes in produzione.

| Provider | API/capability | Version policy | Permissions/access | Fonte ufficiale | Verificato |
|---|---|---|---|---|---|
| OpenAI | Responses API, Structured Outputs, web tools, image generation | Model IDs configurabili; niente hardcode diffuso | API key server-side | https://platform.openai.com/docs/api-reference/responses ; https://platform.openai.com/docs/guides/structured-outputs | 2026-08-09 |
| Meta Facebook | Pages publishing | Pin versione Graph tramite config dopo verifica app | Page permissions + App Review secondo use case | https://developers.facebook.com/docs/pages-api/posts/ | 2026-08-09 |
| Meta Instagram | Content Publishing per account professionali supportati | Pin Graph version tramite config | Instagram/FB permissions richieste dal flusso ufficiale | https://developers.facebook.com/docs/instagram-platform/content-publishing/ | 2026-08-09 |
| LinkedIn | Posts API / Community Management | Usare header/versione corrente documentata, non tutorial legacy | Community Management access review + scopes/ruoli richiesti | https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api | 2026-08-09 |
| Google Business Profile | Locations, Local Posts, Media, Reviews | API separate GBP; evitare assunzioni da vecchie Google My Business API | Cloud project + GBP API access + OAuth | https://developers.google.com/my-business/content/posts-data ; https://developers.google.com/my-business/content/review-data | 2026-08-09 |
| Telegram | Bot API, webhook, inline keyboard/callback query | Bot API corrente | Bot token + webhook secret/validation | https://core.telegram.org/bots/api | 2026-08-09 |
| Stripe | Billing Subscriptions + webhooks | API version gestita centralmente | Secret key + verified webhook signature | https://docs.stripe.com/billing/subscriptions/overview ; https://docs.stripe.com/webhooks/signature | 2026-08-09 |
| Supabase | Auth/RLS/Edge Functions/Cron/Queues | Project migrations source of truth | service role server-only | https://supabase.com/docs/guides/database/postgres/row-level-security ; https://supabase.com/docs/guides/cron ; https://supabase.com/docs/guides/queues | 2026-08-09 |
| Vercel | Git deployments/environments | GitHub source of truth | project/team access | https://vercel.com/docs/git/vercel-for-github ; https://vercel.com/docs/environment-variables | 2026-08-09 |

## Note provider

### Google Business Profile
È un provider distinto: Local Posts supporta categorie/CTA proprie e la strategia deve poter scegliere di non riusare un post social. Product Posts non vanno assunti come creati via API senza supporto documentato corrente. L'accesso alle GBP APIs richiede approvazione.

### LinkedIn
Il codice adapter può essere implementato prima dell'access approval, ma il go-live rimane bloccato finché l'app non possiede i prodotti/scopes necessari.

### Meta
Non usare endpoint copiati da tutorial. Versione Graph e permission list finali devono essere registrate qui dopo la creazione della Meta App e prima del primo test live.