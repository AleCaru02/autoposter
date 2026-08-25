# Free Live Foundations — 2026-08-11

Questa fase chiude lavoro preparatorio a costo aggiuntivo €0 senza creare risorse cloud, usare credenziali provider o attivare Stripe/OpenAI.

## Dati cliente

`tenants.data_mode` separa `DEMO` da `REAL`.

- `DEMO`: può usare fixture esplicitamente indicate.
- `REAL`: i percorsi mock AI/social/publishing vengono bloccati finché il provider reale non è configurato; il frontend non usa fallback demo impliciti.
- Il passaggio amministrativo DEMO → REAL elimina analytics, published posts e social connections fixture del tenant prima di cambiare modalità.

## Admin manuale senza Stripe

Il backend platform-admin espone operazioni server-side per:
- lista utenti Auth e tenant;
- assegnazione piano `provider=manual`;
- override quote/entitlements;
- sospensione e riattivazione tenant;
- passaggio DEMO/REAL;
- budget AI tenant;
- uso, AI ledger, scheduler failures, connessioni e audit;
- richieste lifecycle/cancellazione.

Stripe resta disattivato.

## Website knowledge

Il crawler ora supporta senza AI:
- fetch HTTP con redirect manuali e limite redirect;
- blocco target localhost/reti private per mitigare SSRF;
- timeout e limite bytes;
- robots.txt;
- sitemap e sitemap index;
- canonical, description, headings, testo e internal links;
- favicon, logo candidates e image candidates;
- stylesheet same-origin e colori CSS principali;
- raw page/resource evidence;
- errori parziali senza interrompere l'intero scan.

`website_resources` prepara la persistenza di robots, sitemap, CSS e asset candidates oltre alle `website_pages` già esistenti.

## AI cost control

Il database include:
- `tenant_ai_budgets`;
- `app_private.global_ai_budget`;
- `ai_cost_reservations`;
- soft/hard limit;
- idempotency reservation;
- operation type/capability/model key;
- estimated e actual cost;
- link dal ledger `ai_usage_events` alla reservation.

Il default è fail-closed: nessuna futura chiamata AI live deve partire finché budget tenant e globale non sono configurati e abilitati.

## Scheduler

`publication_jobs` era già persistente con status, attempts, idempotency, scheduled/next-attempt, lock ed error fields. La foundation aggiunge:
- reconciliation state;
- reconciled_at;
- provider_request_id.

L'`InMemoryPublicationScheduler` resta disponibile esclusivamente per unit test/runtime fixture e non è il target live.

## Account lifecycle

Aggiunti:
- richieste cancellazione ACCOUNT/TENANT;
- revoke di tutte le connessioni tenant;
- lifecycle audit privato che sopravvive alla cancellazione tenant;
- cleanup best-effort degli oggetti Storage prima della cancellazione tenant;
- protezione contro cancellazione account che possiede ancora tenant attivi.

## Backend hardening

Preparati:
- CORS allowlist configurabile;
- security headers;
- body-size limit;
- rate limiting auth/scanner/future-AI;
- error sanitization fuori da LOCAL;
- schema privato per rate-limit windows condivisi quando il backend remoto sarà attivo.

## Legal foundation

Route pubbliche:
- `/privacy`;
- `/termini`;
- `/cookie-policy`.

Tutte riportano esplicitamente `DA REVISIONARE PRIMA DEL LANCIO COMMERCIALE`.

## Non attivato

- OpenAI live;
- provider social reali;
- Telegram live;
- Stripe;
- Supabase remoto dedicato;
- merge PR #1;
- Lovable.
