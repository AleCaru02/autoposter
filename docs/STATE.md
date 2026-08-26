# Stato operativo — Post Automatici

Data audit: 2026-08-26

## Gate

1. GitHub fonte unica — PASS
   - repository canonico: `AleCaru02/autoposter`
   - branch canonico: `main`
2. GitHub/Lovable/Vercel stesso codice — PARTIAL
   - GitHub è la fonte unica
   - Lovable source-control nativo richiede autorizzazione GitHub nella UI Lovable; l'API disponibile non espone il collegamento
   - Vercel non può essere riallineato finché non si resetta il limite giornaliero `api-deployments-free-per-day`
3. PostgreSQL reale — PASS
   - Neon project dedicato `post-automatici`
   - test insert -> nuova query -> read riuscito
   - nessun uso di SQLite
4. Health check reale — PARTIAL
   - il nuovo health check non può dichiarare ready se il database non è configurato/raggiungibile
   - verifica finale su deployment canonico ancora pendente
5. Autenticazione reale — PASS
   - Neon Auth provisionato
   - smoke test reale signup 200 + signin 200 + persistenza utente verificata
6. Profili isolati — PASS BACKEND / RUNTIME VERCEL PENDING
   - profili senza limite applicativo
   - Neon Data API + PostgreSQL RLS
   - test A/B: B vede 0 righe di A e modifica 0 righe di A
7. Dashboard/onboarding/routes — PASS CI / RUNTIME VERCEL PENDING
   - route reali presenti
   - redirect onboarding funzionante a livello codice
   - GitHub Gate: typecheck + build PASS
8. Brand persistente — PASS PERSISTENCE / RUNTIME VERCEL PENDING
   - create -> read -> update -> read verificato su PostgreSQL
   - dati isolati per profile_id
9. Crawler pagina-per-pagina — PASS ENGINE+STORAGE / RUNTIME VERCEL PENDING
   - regressione: 5 pagine analizzate, robots rispettato, sitemap inclusa, dominio isolato
   - persistenza scansione/pagine verificata in nuova query
   - protezioni SSRF incluse
10. OpenAI testi — BLOCKED: SECRET MANCANTE
   - Responses API + Structured Outputs implementati
   - modello finale bloccato su `gpt-5.6-terra`; nessun downgrade a Luna per risparmiare
   - reasoning medio e verifica completezza varianti per mantenere qualità editoriale
   - una singola chiamata genera tutte le piattaforme/formati richiesti
   - selezione locale delle pagine sito più pertinenti prima di inviare contesto al modello
   - grounding su brand + pagine sito analizzate
   - tracking token, cached token, cache-write e costo USD in `ai_usage_events`
   - budget hard applicativo testi default 5 USD/mese complessivi; blocco prima della chiamata se la richiesta può superarlo
   - nessuna generazione automatica in background
   - GitHub Gate del cost guard: typecheck + crawler + OpenAI contract + build PASS
   - prova live SKIP perché `OPENAI_API_KEY` non è configurata nei GitHub Actions secrets
   - nessun fallback/mock se la chiave manca: endpoint restituisce 503 `OPENAI_NOT_CONFIGURED`
11. OpenAI immagini — BLOCCATO DA 10
12. Workflow contenuti — BLOCCATO DA 10
13. Calendario/frequenze — BLOCCATO DA 10
14. OAuth social — BLOCCATO DALLA SEQUENZA
15. Pubblicazione reale — BLOCCATO DALLA SEQUENZA
16. Metriche reali — BLOCCATO DALLA SEQUENZA
17. Apprendimento — BLOCCATO DALLA SEQUENZA
18. Retry/errori — BLOCCATO DALLA SEQUENZA
19. Bonifica nomi/config — BLOCCATO DALLA SEQUENZA
20. QA iPhone/desktop — BLOCCATO DALLA SEQUENZA
21. Link candidato — BLOCCATO FINO A TUTTI I PASS

## Regola
Un gate passa a PASS solo con evidenza verificabile. Nessuna integrazione viene mostrata come live se manca il collegamento reale.
