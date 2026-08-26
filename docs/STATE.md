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
   - live probe CI reso esplicito/on-demand per evitare costi ricorrenti
   - nessun fallback/mock se la chiave manca
11. OpenAI immagini — PASS API+CI / RUNTIME VERCEL PENDING
   - modello consentito esclusivamente `gpt-image-2`
   - Images API server-side, chiave mai esposta al client
   - qualità finale `high`; il controllo costi riduce chiamate inutili e non degrada il modello
   - una immagine per azione esplicita; nessuna generazione automatica
   - dimensione 1024x1024 per post/carosello e 1024x1536 per storie
   - limite applicativo predefinito 20 generazioni immagini/mese, configurabile
   - utilizzo e costo tecnico stimato da token registrabili in `ai_usage_events`; la UI utente resta in euro
   - contract test PASS: solo `gpt-image-2`, qualità high, n=1, PNG, protezione chiave e anti-invenzione
   - prova live reale del 26/08/2026: `PASS OpenAI image live: gpt-image-2, quality=high, size=1024x1024, immagine reale ricevuta.`
   - prova live resa on-demand dopo il PASS per evitare ulteriori spese CI
12. Workflow contenuti — PASS SOURCE+DB+CI / RUNTIME VERCEL PENDING
   - generazione testo non crea record fantasma: salvataggio esplicito in `content_items` + `content_variants`
   - ogni variante mantiene provider/formato separati e stato `PENDING`, `APPROVED` o `CHANGES_REQUESTED`
   - modifica persistente di hook, caption, CTA, hashtag, brief visuale e alt text
   - una modifica o rigenerazione immagine riapre automaticamente la revisione
   - stato contenuto coerente: `IN_REVIEW`, `APPROVED`, `CHANGES_REQUESTED`
   - `/app/approvazioni` è una route reale con modifica, salva, approva, da correggere, riapri ed elimina
   - immagini GPT-Image-2 salvabili nel profilo e collegate alla variante tramite `assets` + `image_asset_id`
   - storage fase personale dichiarato `DATABASE_DATA_URL_V1`; non viene presentato come object storage definitivo SaaS
   - caricamento approvazioni limitato ai 50 contenuti più recenti e ai soli asset referenziati
   - RLS verificata sulle tre tabelle: `owns_profile(profile_id)` in lettura/scrittura
   - test PostgreSQL reale: create -> edit -> asset link -> approve -> read -> cleanup PASS; leftovers 0
   - test capacità storage: data URL da 3.000.022 caratteri persistita e rimossa correttamente
   - GitHub Actions: typecheck, crawler, content workflow regression, contratti OpenAI e build PASS
13. Calendario/frequenze — PROSSIMO GATE
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
