# Social: stato verificato e configurazione (aggiornato al 16/11/2026)

**Nessun valore segreto è stato stampato o salvato nel repository.** I secret sono stati copiati dai portali negli appunti con il pulsante "copia" e passati direttamente a `vercel env add --sensitive`; poi gli appunti sono stati svuotati.

Unica eccezione: il primo secret Google creato il 16/11 è comparso in un'etichetta del browser letta dall'agente. È stato considerato compromesso: prima disattivato, poi eliminato (non era mai stato usato). Al suo posto ne è stato creato un altro, copiato senza visualizzarlo.

## Stato al 16/11/2026

| Voce | Stato |
|---|---|
| Vercel Production | Aggiunte `LINKEDIN_CLIENT_SECRET` e `GOOGLE_CLIENT_SECRET` (Sensitive). Mancano `META_APP_SECRET` (Meta chiede di reinserire la password) e `SOCIAL_TOKEN_KEY` (vedi sotto). Le variabili diventano attive solo al prossimo deploy di produzione |
| Vercel reel-qa | `SOCIAL_TOKEN_KEY` (chiave solo QA), `LINKEDIN_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`, `META_APP_ID`, `LINKEDIN_CLIENT_ID`, `GOOGLE_CLIENT_ID`. Manca `META_APP_SECRET` |
| App Meta 900306149763443 | Facebook Login for Business → URI di reindirizzamento: i 2 del Worker invariati, più `/api/social/callback/facebook` e `/instagram` sul dominio canonico e su reel-qa |
| App LinkedIn 77gm5otb0kan9y | Redirect: localhost e Worker invariati, più `/api/social/callback/linkedin` sul dominio canonico e su reel-qa. Prodotti: Share on LinkedIn e Sign In with OpenID. Community Management API non approvata: niente Pagina aziendale né metriche |
| Google, progetto `post-automatici`, client "Post Automatici Web" | Redirect: Worker invariato, più `/api/social/callback/gbp` sul dominio canonico e su reel-qa. Secret: `****RAO3` (Worker) invariato e attivo, più un secret nuovo per Vercel. API abilitate: Account Management, Business Information, **Google My Business API (v4, Local Post)** e **Business Profile Performance API (metriche)**, le ultime due abilitate il 16/11. Quota Account Management: 300 richieste/min, quindi l'accesso alle API GBP è approvato |
| Schermata di consenso Google | Stato **Test**: i refresh token scadono dopo 7 giorni, per questo il token GBP risulta scaduto. Per token stabili serve pubblicare l'app ("In produzione"), dopo aver completato il Branding. È una decisione del proprietario |
| Collegamenti in produzione (DB) | 4 righe ACTIVE, cifrate con la `SOCIAL_TOKEN_KEY` del Worker. Nessuna è stata modificata |
| Worker Cloudflare | Il 16/11 è stato rimosso dal pannello il solo trigger orario (autopilot + learning, già eseguiti dal cron Vercel). Resta `*/5` (pubblicazioni, bloccate da SAFE_MODE; su `main` Vercel non pubblica). Anche `wrangler.jsonc` della PR dichiara solo `*/5`. Ripristino: Settings → Trigger events → Add `0 * * * *` |

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
