# Social: stato verificato e configurazione (aggiornato al 16/11/2026)

**Nessun valore segreto è stato stampato o salvato nel repository.** I secret sono stati copiati dai portali negli appunti con il pulsante "copia" e passati direttamente a `vercel env add --sensitive`; poi gli appunti sono stati svuotati.

Unica eccezione: il primo secret Google creato il 16/11 è comparso in un'etichetta del browser letta dall'agente. È stato considerato compromesso: prima disattivato, poi eliminato (non era mai stato usato). Al suo posto ne è stato creato un altro, copiato senza visualizzarlo.

## Stato al 16/11/2026

| Voce | Stato |
|---|---|
| Vercel Production | Aggiunte `LINKEDIN_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET` e `META_APP_SECRET` (Sensitive; per il secret Meta la password l'ha reinserita il proprietario). Manca solo `SOCIAL_TOKEN_KEY` (vedi sotto). Le variabili diventano attive solo al prossimo deploy di produzione |
| Vercel reel-qa | Completo: `SOCIAL_TOKEN_KEY` (chiave solo QA), `META_APP_ID`, `META_APP_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| App Meta 900306149763443 | Facebook Login for Business → URI di reindirizzamento: i 2 del Worker invariati, più `/api/social/callback/facebook` e `/instagram` sul dominio canonico e su reel-qa |
| App LinkedIn 77gm5otb0kan9y | Redirect: localhost e Worker invariati, più `/api/social/callback/linkedin` sul dominio canonico e su reel-qa. Prodotti: Share on LinkedIn e Sign In with OpenID. Community Management API non approvata: niente Pagina aziendale né metriche |
| Google, progetto `post-automatici`, client "Post Automatici Web" | Redirect: Worker invariato, più `/api/social/callback/gbp` sul dominio canonico e su reel-qa. Secret: `****RAO3` (Worker) invariato e attivo, più un secret nuovo per Vercel. API abilitate: Account Management, Business Information, **Google My Business API (v4, Local Post)** e **Business Profile Performance API (metriche)**, le ultime due abilitate il 16/11. Quota Account Management: 300 richieste/min, quindi l'accesso alle API GBP è approvato |
| Schermata di consenso Google | Stato **Test**: i refresh token scadono dopo 7 giorni, per questo il token GBP risulta scaduto. Per token stabili serve pubblicare l'app ("In produzione"), dopo aver completato il Branding. È una decisione del proprietario |
| Collegamenti in produzione (DB) | 4 righe ACTIVE, cifrate con la `SOCIAL_TOKEN_KEY` del Worker. Nessuna è stata modificata |
| Worker Cloudflare | Il 16/11 è stato rimosso dal pannello il solo trigger orario (autopilot + learning, già eseguiti dal cron Vercel). Resta `*/5` (pubblicazioni, bloccate da SAFE_MODE; su `main` Vercel non pubblica). Anche `wrangler.jsonc` della PR dichiara solo `*/5`. Ripristino: Settings → Trigger events → Add `0 * * * *` |

## Verifica API reale su reel-qa (16/11/2026, profilo QA "Il Tuo Property Manager", DB QA)

I consensi OAuth sono stati dati dal proprietario. Il pulsante **Verifica** è stato premuto da Playwright su iPhone/WebKit e lo stato ricontrollato su desktop Chromium e su Pixel 7. Tutte le chiamate sono in sola lettura e nulla è stato pubblicato.

| Social | Account | Verifica di base | Post | Metriche | Token |
|---|---|---|---|---|---|
| Instagram | @iltuopropertymanager.it (Business, Pagina 712256075315337) | PASS | PASS (`/media`) | PASS (`followers_count`, `media_count`, `/insights` reach) | Token di Pagina senza scadenza; accesso ai dati Meta da rinnovare entro il **14/02/2027** (`debug_token` PASS) |
| Facebook | Pagina "Il Tuo Property Manager - Alessandro Caruso" | PASS | PASS (`/published_posts`) | PASS (`followers_count`, `fan_count`) | Come Instagram |
| LinkedIn | Profilo personale Alessandro Caruso | PASS (`/v2/userinfo`) | Pubblicazione sul profilo autorizzata (`w_member_social`), non eseguita | Non disponibili: scope analytics non concesso. Pagina aziendale non disponibile senza Community Management | Scade il **15/01/2027**, senza refresh token: ricollegare prima |
| Google Business Profile | "Il tuo Property Manager a Milano" (account PERSONAL) | PASS (Business Information) | PASS (v4 `localPosts` in lettura) | PASS (Performance `fetchMultiDailyMetricsTimeSeries`) | Access token di 1 ora con refresh token. In modalità **Test** il refresh token scade dopo 7 giorni |

Altri controlli:
- **Isolamento:** un secondo utente QA non membro riceve 404 su stato, verifica e scollega. La Data API restituisce `[]`.
- **Sicurezza:** con la migrazione `20261118`, il browser non legge più `token_reference` e non può più scrivere `social_connections`, `publication_jobs`, `publication_attempts`, `ai_usage_events` e `audit_log`. Le richieste rispondono 403; prima erano consentite.
- **Ricollega interrotto:** un "Ricollega" avviato e non completato non modifica il collegamento esistente.

## Google: branding e pubblicazione (decisione del proprietario)
- Il branding contiene solo il nome "Post automatici". Mancano home page, privacy policy, termini e l'email di contatto dello sviluppatore. L'app non ha una pagina privacy propria: sul dominio canonico ogni percorso risponde 200 perché è una SPA.
- In stato "Test" il refresh token dura 7 giorni, poi va ricollegato.
- Per pubblicare "In produzione" senza verifica Google servono gli URL reali di privacy e home page. È consentito fino a 100 utenti, ma il consenso mostra l'avviso "app non verificata"; in cambio il refresh token non scade più dopo 7 giorni.
- L'invio del logo o la richiesta di verifica avviano una revisione Google.

## SOCIAL_TOKEN_KEY: la chiave originale non è recuperabile senza un deploy del Worker
- **Dove si trova:** solo come secret del Worker Cloudflare, che si può scrivere ma non rileggere. Non è tra i secret di GitHub Actions: il workflow `deploy-worker` la passa solo se presente, e non lo è.
- **Precauzioni prese:** non è stata sovrascritta e Vercel Production non ha ancora una chiave sua.

Procedura consigliata, senza perdere dati, da eseguire al momento del rilascio autorizzato:
1. Merge della PR e deploy di produzione. Il Worker con `WORKER_SCHEDULER_ENABLED=false` smette di pubblicare e Vercel diventa l'unico runtime.
2. Genero una `SOCIAL_TOKEN_KEY` nuova (32 byte casuali, mai visualizzati) e la scrivo solo su Vercel Production.
3. In Social premi **Verifica** sui 4 account: risponde `SOCIAL_TOKEN_KEY_MISMATCH` e non scrive nulla nel database.
4. Premi **Ricollega** su ogni account e dai il consenso OAuth. La riga viene sovrascritta con il token nuovo; contenuti, calendario, metriche e altri dati non vengono toccati.
5. Premi **Verifica** di nuovo. Un social risulta "Collegato" solo se la lettura API riesce.

Alternative:
- se hai salvato la chiave originale, la inserisci tu come `SOCIAL_TOKEN_KEY` (Sensitive) su Production;
- oppure autorizzi un deploy una tantum del Worker con un endpoint di migrazione.

## Verifica dopo la configurazione, senza pubblicare nulla
In Social, il pulsante **Verifica** chiama `POST /api/social/verify` (commit `266cb44` e successivi), che fa solo letture:
- **Meta:** `GET /{page-id}?fields=id,name` per Facebook, `GET /{ig-user-id}?fields=id,username` per Instagram, poi `GET /me/permissions`.
- **LinkedIn:** `GET /v2/userinfo`.
- **Google:** se serve, rinnovo del token di accesso; poi `GET locations/{id}?readMask=name,title`.

Come gestisce gli esiti:
- **Successo:** aggiorna `last_validated_at` e il provider risulta "Collegato".
- **401, 403, errore Meta 190 o `invalid_grant`:** lo stato diventa `RECONNECT_REQUIRED`. Il token cifrato non viene cancellato.
- **Guasto del provider o client Google non configurato:** nessun cambio di stato.
- **Chiave diversa da quella usata per cifrare:** risponde `SOCIAL_TOKEN_KEY_MISMATCH` senza scrivere nel DB. Così una chiave reinserita si può provare senza rischi.
- **Riga ACTIVE mai verificata:** non risulta più collegata.

Requisiti e limiti:
- La verifica richiede solo `DATABASE_URL` e `SOCIAL_TOKEN_KEY`. App secret e client secret servono per nuovi OAuth e per il rinnovo dei token Google.
- La pubblicazione resta bloccata da SAFE_MODE.
- Per verificare i 4 token di produzione serve una versione con `/api/social/verify` collegata al DB di produzione, cioè questa PR in produzione. `main` non ha ancora l'endpoint.

Test nel cloud (reel-qa, iPhone WebKit, 16/11), su una riga QA fittizia cifrata con un'altra chiave:
- **Verifica:** 409 `SOCIAL_TOKEN_KEY_MISMATCH`, messaggio visibile all'utente, riga invariata.
- **Scollega:** 200, riga ripulita.
