# Stato operativo — Post Automatici

Data audit: 2026-08-26

## Gate

1. GitHub fonte unica — PASS
   - repository canonico: `AleCaru02/autoposter`
   - branch canonico: `main`
2. GitHub/Lovable/Vercel stesso codice — PARTIAL
   - GitHub è la fonte unica
   - Lovable source-control nativo richiede autorizzazione GitHub nella UI Lovable; l'API disponibile non espone il collegamento
   - deployment Vercel canonico ancora da riallineare al main corrente
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
10. OpenAI testi — PASS
   - Responses API + Structured Outputs implementati
   - modello finale bloccato su `gpt-5.6-terra`; nessun downgrade a Luna per risparmiare
   - reasoning medio e verifica completezza varianti
   - una singola chiamata genera tutte le piattaforme/formati richiesti
   - selezione locale delle pagine sito pertinenti + grounding su dati confermati
   - tracking utilizzo in `ai_usage_events`
   - nessuna generazione automatica in background
   - prova live reale del 26/08/2026: `PASS OpenAI live: gpt-5.6-terra, response ricevuta, structured output valido.`
   - nessun fallback/mock se la chiave manca
11. OpenAI immagini — IN IMPLEMENTAZIONE / QA
   - modello consentito esclusivamente `gpt-image-2`
   - Images API server-side, chiave mai esposta al client
   - qualità finale `high`; il controllo costi avviene riducendo chiamate inutili, non degradando il modello
   - una immagine per azione esplicita; nessuna generazione automatica
   - dimensione 1024x1024 per post/carosello e 1024x1536 per storie
   - limite applicativo predefinito 20 generazioni immagini/mese, configurabile senza necessità di variabile aggiuntiva
   - UI collegata alle bozze testo; anteprima immagine non finge persistenza (salvataggio/approvazione è gate 12)
   - contract test e prova live GPT-Image-2 ancora da completare prima del PASS
12. Workflow contenuti — BLOCCATO DA 11
13. Calendario/frequenze — BLOCCATO DA 11
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
