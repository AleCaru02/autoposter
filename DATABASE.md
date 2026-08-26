# Database — Post Automatici

## Provider

PostgreSQL gestito su Neon.

- progetto: `post-automatici`
- project id: `morning-tree-82685366`
- database: `neondb`
- branch produzione: `main`

La stringa di connessione non deve mai essere committata. In Vercel viene fornita come `DATABASE_URL` server-only.

## Isolamento

Ogni oggetto applicativo è associato a `profile_id` oppure deriva da un record che lo contiene. Nessuna query applicativa può operare su brand, sito, contenuti, social, calendario, metriche o apprendimento senza lo scope del profilo corrente.

## Tabelle principali

- `app_users`
- `profiles`
- `profile_members`
- `brand_profiles`
- `website_scans`
- `website_pages`
- `content_strategies`
- `assets`
- `content_items`
- `content_variants`
- `social_connections`
- `schedules`
- `publication_jobs`
- `publication_attempts`
- `metric_snapshots`
- `learning_insights`
- `ai_usage_events`
- `audit_log`

## Regole

- niente SQLite in produzione;
- niente metriche casuali o demo nella modalità reale;
- token social non salvati in chiaro: il DB conserva solo un riferimento al secret;
- `publication_jobs.idempotency_key` impedisce doppie pubblicazioni;
- gli eventi AI e gli audit devono essere attribuibili al profilo.

## Verifica iniziale

Il 26/08/2026 è stato eseguito un test reale insert -> nuova connessione/query -> read sul profilo QA. La lettura ha restituito lo stesso UUID e gli stessi dati. Il record QA è stato poi rimosso.
