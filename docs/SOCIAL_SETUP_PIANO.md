# Social: stato verificato e passi per attivarli su Vercel (15/11/2026)

**Nessun valore segreto è stato letto, stampato o salvato.** Le verifiche sui portali sono state fatte in sola lettura, con la sessione del browser già aperta.

## Stato reale

| Voce | Stato verificato |
|---|---|
| Variabili su Vercel produzione | Presenti: `META_APP_ID`, `META_GRAPH_VERSION`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_API_VERSION`, `LINKEDIN_ORGANIZATION_ACCESS`, `GOOGLE_CLIENT_ID`, `APP_BASE_URL`, `SAFE_MODE`. **Mancano** `SOCIAL_TOKEN_KEY`, `META_APP_SECRET`, `LINKEDIN_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` |
| Variabili su reel-qa | `SOCIAL_TOKEN_KEY` presente (chiave solo QA); app ID e secret social assenti |
| Collegamenti in produzione (DB) | 4 righe ACTIVE del profilo "Il Tuo Property Manager": Instagram e Facebook (27/09, token di Pagina senza scadenza), LinkedIn (28/09, scade il **27/11/2026**), Google Business Profile (28/09, token d'accesso scaduto). Tutti i token sono cifrati (`enc:`) con la `SOCIAL_TOKEN_KEY` del Worker Cloudflare |
| Interfaccia | Corretta: uno stato ACTIVE "storico" non viene mostrato come collegato senza verifica server |
| App Meta | "AutoPoster Il Tuo Property Man" (ID 900306149763443), modalità sviluppo: va bene per uso personale, perché sei amministratore. Gli URI di reindirizzamento validi puntano **solo** al Worker (`…workers.dev/api/social/callback/facebook` e `/instagram`) |
| App LinkedIn | "AutoPoster iltuopropertymanager" (client 77gm5otb0kan9y). Prodotti: **Share on LinkedIn** e **Sign In with OpenID**. Scope: `openid profile email w_member_social`. URI di reindirizzamento: solo Worker e localhost. **Community Management API non approvata**: niente pubblicazione su Pagina aziendale e niente metriche dei post. Esiste anche un'app "AutoPoster Analytics" (client 78rg6t1mlauhno), ancora da collegare a un uso preciso |
| Google Cloud | La console non si carica nella sessione del browser (errore della console): credenziali OAuth e accesso alla Business Profile API sono **da verificare** |
| Worker Cloudflare | La versione su `main` ha ancora i cron `*/5` e orario **senza** il blocco `WORKER_SCHEDULER_ENABLED`, che esiste solo nella PR #332. È una doppia pianificazione attiva insieme ai cron Vercel. La pubblicazione doppia è impedita dai claim sul DB, la generazione AI doppia no |

## SOCIAL_TOKEN_KEY: tre strade (scegli tu)
1. **Riusare la chiave originale**, se l'hai salvata, inserendola tu su Vercel. Instagram e Facebook tornano operativi subito, senza ricollegarli. LinkedIn funziona fino al 27/11.
2. **Migrazione senza che nessuno veda le chiavi:**
   - genero una chiave nuova e la scrivo direttamente come segreto su Vercel e sul Worker, senza mostrarla;
   - un endpoint temporaneo del Worker, protetto da `CRON_SECRET`, ricifra i 4 token con la nuova chiave e tiene un backup;
   - verifico, poi Vercel usa la chiave nuova.
   - Richiede un deploy del Worker in produzione.
3. **Chiave nuova e ricollegamento dei 4 account via OAuth.** È la strada più semplice; il ricollegamento serve comunque per LinkedIn a breve e per Google.

## Operazioni che richiedono la tua approvazione o il tuo intervento
1. **Inserire i secret, solo tu:** i portali mostrano i secret solo dopo aver reinserito la password, e io non inserisco password né leggo segreti.
   - Percorso: Vercel → progetto `post-automatici-canonical` → Settings → Environment Variables → Add → spunta "Sensitive".
   - Ambienti: **Production** e **reel-qa**.
   - Nomi: `META_APP_SECRET`, `LINKEDIN_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`. Per la strada 1 anche `SOCIAL_TOKEN_KEY`.
2. **Aggiungere gli URI di reindirizzamento** (lo faccio io dal browser dopo il tuo ok):
   - Meta: `https://post-automatici-canonical.vercel.app/api/social/callback/facebook`, `…/instagram` e gli stessi due sul dominio reel-qa;
   - LinkedIn: `…/api/social/callback/linkedin` su entrambi i domini;
   - Google: `…/api/social/callback/gbp` su entrambi i domini.
3. **Fermare la doppia pianificazione del Worker:** deploy in produzione del Worker con `WORKER_SCHEDULER_ENABLED=false`, già nel codice della PR, oppure rimozione dei cron dal Worker.
4. **LinkedIn:** se vuoi pubblicare sulla Pagina aziendale e leggere le metriche, devi chiedere a LinkedIn l'accesso alla Community Management API. Senza, si pubblica solo sul profilo personale.

## Verifica dopo la configurazione, senza pubblicare nulla
- **Meta:** OAuth, poi `GET /me/accounts` e `GET /{ig-user-id}?fields=username`. Si controllano i permessi concessi, senza pubblicare.
- **LinkedIn:** OAuth, poi `GET /v2/userinfo`.
- **Google:** OAuth, poi elenco account e sedi della Business Profile API.
- Un provider risulta "Collegato" solo dopo queste letture riuscite; la pubblicazione resta bloccata da SAFE_MODE.
