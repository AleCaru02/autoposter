# Stato operativo — Post Automatici

Audit completo: 2026-08-26
Exact GitHub main verificato: `6f9cea143751834a9e8da0ced01648363e6fda22`

## Regola operativa

Problema → correzione → verifica → PASS → problema successivo.

Nessun gate viene considerato PASS end-to-end solo perché il codice esiste o la CI passa. Quando il gate dipende dal runtime Vercel, il PASS finale richiede anche il deployment consolidato e un test reale del flusso.

## Audit gate 1 → 21

1. GitHub fonte unica — PASS, CON HARDENING PENDENTE
   - repository canonico: `AleCaru02/autoposter`
   - branch canonico: `main`
   - exact main: `6f9cea143751834a9e8da0ced01648363e6fda22`
   - GitHub Actions run `32925891967`: typecheck, crawler, workflow contenuti, calendario, contratti OpenAI e build PASS
   - repository attualmente `public` e branch `main` non protetto: non cambia la source-of-truth, ma va corretto prima della fase commerciale

2. Lovable / GitHub / Vercel stesso codice — BLOCKED
   - GitHub è la source-of-truth corrente
   - Lovable project `760d39d1-7dc2-45ce-a074-cd08593c4f2a` è ancora sul commit interno `ff86e0862ac41cd398827fa564f6494ac30f3395`, con nomi legacy `Brand Spark AI` / `SocialPilot AI`
   - GitHub main è `6f9cea143751834a9e8da0ced01648363e6fda22`: Lovable non è allineato
   - Vercel production è READY ma è un deployment precedente alle modifiche correnti; quindi non è l'exact main
   - documentazione Lovable Git Sync verificata il 26/08/2026: collegare un progetto Lovable crea un nuovo repository GitHub; non offre il collegamento diretto del progetto esistente al repository canonico `autoposter`
   - decisione architetturale richiesta prima di modificare la source-of-truth o creare un secondo repository

3. PostgreSQL reale — PASS
   - Neon project dedicato `post-automatici`
   - nuova verifica read-only: database `neondb`, 18 tabelle `public`
   - tutte le 18 tabelle operative risultano con RLS attiva
   - nessun uso di SQLite nel runtime canonico

4. Health check reale — FAIL RUNTIME
   - source `api/health.ts` è corretta: usa `DATABASE_URL` e `SELECT 1`
   - test production del 26/08/2026: HTTP 503, `ready:false`, `database:"not_configured"`
   - il deployment Vercel attuale non ha `DATABASE_URL` disponibile al runtime
   - questo gate non può essere PASS finché Vercel non viene configurato e ridistribuito

5. Autenticazione reale — PASS BACKEND / RUNTIME CONSOLIDATO PENDING
   - frontend usa Neon Auth reale tramite `@neondatabase/neon-js`
   - smoke reale precedente: signup 200 + signin 200 + persistenza verificata e dati QA rimossi
   - nessuna modifica successiva ha sostituito l'auth con mock
   - nuovo test browser sul deployment consolidato ancora richiesto

6. Profili illimitati e isolati — PASS BACKEND / RUNTIME CONSOLIDATO PENDING
   - nessun limite applicativo sul numero di profili
   - `profiles` isolata da `owner_auth_user_id = current_auth_user_id()`
   - tabelle per profilo protette da `owns_profile(profile_id)`
   - test A/B precedente: utente B vede/modifica 0 righe di A
   - nuova verifica RLS conferma isolamento su brand, sito, contenuti, asset, calendario, social, metriche e apprendimento

7. Dashboard / onboarding / route — PASS SOURCE+CI / RUNTIME CONSOLIDATO PENDING
   - route reali per dashboard, profili, brand, sito, contenuti, approvazioni e calendario
   - guard auth e redirect onboarding presenti
   - social, analytics e apprendimento sono ancora placeholder espliciti, coerenti con i gate successivi
   - exact main build PASS

8. Brand e dati attività persistenti — PASS DB / RUNTIME CONSOLIDATO PENDING
   - `brand_profiles` persistente e isolata via RLS
   - create → read → update → read già verificato su PostgreSQL

9. Crawler pagina-per-pagina — PASS ENGINE+DB+CI / RUNTIME CONSOLIDATO PENDING
   - crawler same-origin pagina-per-pagina
   - sitemap/robots, normalizzazione URL, limiti e protezioni SSRF presenti
   - regressione CI PASS
   - persistenza `website_scans` / `website_pages` isolata via RLS

10. OpenAI testi — PASS API+LIVE+CI / RUNTIME CONSOLIDATO PENDING
   - solo `gpt-5.6-terra` per il testo finale
   - Responses API + Structured Outputs + `store:false`
   - grounding e selezione locale delle pagine rilevanti
   - live probe reale già PASS il 26/08/2026
   - test live successivi sono on-demand per evitare costi inutili
   - nota di cleanup: il guard economico interno è ancora espresso in USD nel codice/config; la UI finale deve essere tutta in euro

11. OpenAI Immagini 2 — PASS API+LIVE+CI / RUNTIME CONSOLIDATO PENDING
   - esclusivamente `gpt-image-2`
   - qualità `high`, `n=1`, nessuna generazione automatica
   - live probe reale PASS il 26/08/2026
   - limite mensile applicativo presente
   - salvataggio immagine collegato alle varianti contenuto dal gate 12

12. Creazione / modifica / approvazione contenuti — PASS SOURCE+DB+CI / RUNTIME CONSOLIDATO PENDING
   - bozze salvate esplicitamente in `content_items` + `content_variants`
   - modifica persistente di hook, caption, CTA, hashtag, visual brief e alt text
   - stati `PENDING`, `APPROVED`, `CHANGES_REQUESTED`
   - immagini persistenti via `assets` e `image_asset_id`
   - modifica/rigenerazione riapre la revisione
   - test PostgreSQL reale e cleanup QA PASS

13. Calendario e frequenze — PASS SOURCE+DB+CI / RUNTIME CONSOLIDATO PENDING
   - configurazione separata Instagram/Facebook/LinkedIn/GBP per profilo
   - post/settimana, fuso, slot preferiti, enable e auto-choice persistenti
   - solo varianti idonee e approvate programmabili
   - trigger DB impedisce scheduling incoerente
   - modifica contenuto porta `SCHEDULED → BLOCKED_APPROVAL`; riapprovazione futura ripristina `SCHEDULED`
   - timezone/DST regression PASS
   - exact main CI PASS

14. OAuth social reale — NOT STARTED
   - `/app/social` è correttamente un placeholder che dichiara la dipendenza OAuth
   - tabella `social_connections` esiste ed è isolata per profilo
   - nessuna connessione live viene simulata
   - non procedere finché i gate precedenti non sono stabilizzati end-to-end

15. Pubblicazione social reale — NOT STARTED / BLOCKED DA 14
   - non esiste ancora adapter live di pubblicazione
   - `publication_jobs` resta scheduling interno e non finge invio ai provider

16. Metriche reali — NOT STARTED / BLOCKED DA 15
   - `metric_snapshots` esiste e ha RLS
   - `/app/analytics` è placeholder esplicito
   - nessuna metrica mock viene presentata come live nel prodotto canonico

17. Apprendimento / ottimizzazione — NOT STARTED / BLOCKED DA 16
   - `learning_insights` esiste e ha RLS
   - `/app/apprendimento` è placeholder esplicito
   - nessun miglioramento automatico viene dichiarato senza metriche reali

18. Errori / retry / idempotenza end-to-end — PARTIAL, NON PASS
   - sono presenti error states locali, idempotency del calendario e controlli API specifici
   - manca ancora una politica completa per retry/backoff, publication attempts, error classification e recovery end-to-end

19. Bonifica nomi / config — FAIL
   - Lovable mantiene `Brand Spark AI` / `SocialPilot AI`
   - `.env.example` contiene ancora variabili Supabase legacy non coerenti con il backend Neon corrente
   - budget testo interno usa ancora `OPENAI_TEXT_MONTHLY_BUDGET_USD`; l'esperienza finale richiesta è in euro
   - bonifica da eseguire solo dopo aver risolto i gate precedenti, senza introdurre regressioni

20. QA completo iPhone + desktop — NOT STARTED SULL'EXACT MAIN
   - componenti 12/13 hanno CSS mobile-first e CI build PASS
   - manca il test browser reale dell'exact main consolidato su iPhone/mobile e desktop
   - il deployment Vercel attuale è troppo vecchio per certificare il prodotto corrente

21. Link candidato principale — BLOCKED
   - dominio Vercel esiste ma non è un candidato finale
   - health production attuale è 503
   - non fornire il link come prodotto testabile finché tutti i gate richiesti non passano

## Primo problema da risolvere

Il primo gate non PASS è il n. 2. Non aprire OAuth o nuove feature finché non viene deciso il rapporto corretto tra Lovable e il repository GitHub canonico e finché Vercel non può essere riallineato con un deployment consolidato.
