# Stato operativo — Post Automatici

Data audit: 2026-08-28

## Gate

1. GitHub fonte unica — PASS
   - repository canonico: `AleCaru02/autoposter`
   - branch canonico: `main`
2. GitHub/Lovable/Vercel stesso codice — PARTIAL
   - GitHub resta la fonte unica
   - Lovable source-control nativo richiede autorizzazione GitHub nella UI Lovable
   - il progetto Vercel canonico `post-automatici-canonical` risulta `link: null`: il collegamento GitHub del progetto canonico resta da configurare, senza creare copie sostitutive
3. PostgreSQL reale — PASS
   - Neon project dedicato `post-automatici`
   - persistenza e RLS già verificate
   - nessun uso di SQLite
4. Health check reale — BLOCKED RUNTIME CONFIG
   - `/api/health` è fail-closed: non dichiara ready senza database realmente raggiungibile
   - verifica live 28/08/2026 sul Vercel canonico: HTTP 503, `database=not_configured`
   - la dashboard ora legge il vero health check e non mostra più PostgreSQL `Attivo` in modo hardcoded
   - il PASS richiede `DATABASE_URL` configurato sul progetto Vercel canonico e successivo health 200 con `database=postgres_ready`
5. Autenticazione reale — PASS
   - Neon Auth provisionato
   - smoke test reale signup/signin e persistenza già verificati
6. Profili isolati — PASS BACKEND / CANONICAL VERCEL PENDING
   - profili senza limite applicativo
   - Neon Data API + PostgreSQL RLS
   - test A/B di isolamento già PASS
   - selezione profilo migliorata anche da tastiera; eliminazione protetta contro doppio invio
   - autosave Brand/Impostazioni vincolato al profilo della bozza: un cambio attività non può dirottare una scrittura pendente sul profilo successivo
7. Dashboard/onboarding/routes — PASS SOURCE+CI / CANONICAL VERCEL PENDING
   - route reali presenti
   - `/app/contenuti` è ora una route reale e non viene più reindirizzata al Calendario
   - navigazione desktop espone tutte le sezioni del prodotto
   - navigazione mobile espone Contenuti e un menu `Altro` con Attività, Brand, Sito, Revisioni, Analytics, Apprendimento, Impostazioni, selettore attività e logout
8. Brand persistente — PASS PERSISTENCE+SOURCE / CANONICAL VERCEL PENDING
   - create/read/update/read già verificato su PostgreSQL
   - dati isolati per `profile_id`
   - autosave hardenizzato contro perdita dati/cross-profile durante cambio attività
9. Crawler pagina-per-pagina — PASS ENGINE+STORAGE+CI / CANONICAL VERCEL PENDING
   - sitemap e collegamenti interni, robots, dominio isolato e protezioni SSRF
   - regressione e persistenza già PASS
10. OpenAI testi — PASS
   - Responses API + Structured Outputs
   - modello finale bloccato sul modello previsto dal progetto
   - grounding su pagine sito confermate
   - tracking utilizzo in `ai_usage_events`
   - live probe già PASS; probe ricorrenti disabilitati per evitare costi inutili
   - nessun fallback/mock se la chiave manca
11. OpenAI immagini — PASS API+CI / CANONICAL VERCEL PENDING
   - esclusivamente `gpt-image-2`
   - Images API server-side, qualità high, una generazione per azione esplicita
   - limiti e usage tracking implementati
   - live probe già PASS e reso on-demand
12. Workflow contenuti — PASS SOURCE+DB+CI / CANONICAL VERCEL PENDING
   - `/app/contenuti` raggiungibile realmente
   - generazione, persistenza, modifica, approvazione, immagini e stati coerenti
   - autosave Revisioni tiene traccia delle varianti sporche e forza il salvataggio quando si cambia pagina/profilo
   - autosave condiviso di Brand/Impostazioni conserva il callback/profilo associato alla bozza originale
   - l'autopilot Vercel dispone ora di endpoint reale `/api/autopilot/run`, verifica il bearer token e l'accesso al solo profilo richiesto prima di eseguire logica server-side
   - contract test dedicato impedisce regressioni della route/rewrite Vercel
13. Calendario/frequenze — PASS SOURCE+DB+CI / CANONICAL VERCEL PENDING
   - configurazione separata per Instagram, Facebook, LinkedIn e Google Business Profile
   - frequenza, fuso, auto-choice e slot per profilo/provider
   - solo varianti eleggibili e approvate possono essere programmate
   - stati e trigger DB già verificati
14. OAuth social — PARTIAL / MANUAL PROVIDER TEST REQUIRED
   - backend OAuth e storage token server-side esistono
   - Meta richiede completamento manuale della selezione Pagine Facebook/Instagram e test reale dell'account
   - Google Business Profile resta in attesa dell'accesso/approvazione Google
   - nessun provider viene dichiarato collegato se il collegamento reale manca
15. Pubblicazione reale — BLOCKED BY REAL SOCIAL CONNECTIONS
   - pipeline e processor esistono
   - il PASS richiede una pubblicazione controllata reale per ogni provider effettivamente collegato
16. Metriche reali — UI REAL-READ READY / INGESTION BLOCKED
   - `/app/analytics` legge esclusivamente `metric_snapshots` del profilo selezionato
   - zero metriche demo o inventate; empty state esplicito finché non arrivano dati API reali
   - raccolta live non può essere dichiarata PASS prima dei collegamenti social e delle relative API metriche
17. Apprendimento — UI REAL-READ READY / ENGINE BLOCKED BY REAL METRICS
   - `/app/apprendimento` legge esclusivamente `learning_insights` del profilo selezionato
   - zero suggerimenti inventati
   - ottimizzazione reale di giorni/orari/temi/formati resta bloccata finché non esiste una base di metriche reali sufficiente
18. Retry/errori — SOURCE IMPLEMENTED / LIVE VALIDATION PENDING
   - `publication_attempts` e tentativi di pubblicazione reali sono presenti
   - errori permanenti di connessione/formato non vengono mascherati come successo
   - validazione end-to-end di rate limit, token scaduto e 5xx resta legata ai provider reali
19. Bonifica nomi/config — PARTIAL
   - dashboard non dichiara più stati runtime falsi
   - conteggio connessioni social allineato allo stato backend reale `ACTIVE`
   - contratto frontend health allineato a `postgres_ready`
   - resta da completare la configurazione canonica Vercel/GitHub/env; non viene aggirata con nuovi progetti
20. QA iPhone/desktop — SOURCE HARDENED / AUTHENTICATED RUNTIME QA PENDING
   - touch target mobile portati ad almeno 44 px sui controlli principali
   - input mobile a 16 px per evitare zoom automatico iOS
   - navigazione mobile completa e logout disponibili
   - layout rinforzato anche per viewport <=360 px
   - PASS finale richiede test browser autenticato su iPhone/viewport reali dopo il deployment canonico funzionante
21. Link candidato — BLOCKED
   - non viene dichiarato un link finale finché Vercel canonico, OAuth/pubblicazione e QA runtime richiesti non sono PASS

## Regola
Un gate passa a PASS solo con evidenza verificabile. Nessuna integrazione, metrica, insight o stato runtime viene mostrato come live se manca il collegamento o il dato reale.
