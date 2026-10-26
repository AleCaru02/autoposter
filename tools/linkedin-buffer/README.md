# LinkedIn personal brand — Buffer Free

Modulo isolato del repository esistente Post Automatici. Non sostituisce il prodotto, non crea una seconda app SaaS, non tocca i profili esistenti e non richiede OpenAI API, database, Vercel, Cloudflare o altre API a pagamento.

## Policy editoriale

- Quattro pilastri bilanciati su ogni ciclo di quattro post: property management; network marketing/Chogan; impresa/AI/digital; obiettivi personali/Tenerife.
- Un post ogni **3 giorni** alle **09:00 Europe/Rome**, compreso il passaggio tra ora legale e solare. Data iniziale proposta 29 ottobre 2026.
- Vietati contenuti sulle relazioni sentimentali e sull'occupazione come operaio. Non inserire dati privati di terzi.
- Vietati rendimenti garantiti, successi non verificati, guadagni inventati, testimonianze e dati operativi non autorizzati.
- Nessun contenuto generato al volo da un'AI a pagamento: archivio iniziale di **40 post originali = 10 per categoria = circa 120 giorni**. Terminata la raccolta, il motore NON ripete e non inventa: si ferma finché non vengono aggiunti nuovi contenuti.
- La rotazione è 25% per categoria sui post pianificati, non può garantire quattro post effettivamente pubblicati se LinkedIn/Buffer fallisce.

## Architettura

1. Workflow GitHub Actions quotidiano alle 05:17 UTC (non è l'ora di pubblicazione).
2. Lo scheduler calcola i prossimi 10 giorni su un calendario esatto ogni tre giorni alle 09:00 Europe/Rome.
3. Prima di ogni scrittura, verifica identità del canale LinkedIn in Buffer e legge fino a 2.000 post pregressi programmati/inviati, fallendo in modo chiuso se i dati non sono completi.
4. Controlla sempre il file state.json: slot, SHA-256 del contenuto, categoria, orario, identificativo post Buffer, stato.
5. Confronta gli hash dell'archivio locale anche con i testi remoti Buffer. Non pubblica di nuovo contenuti già identificati.
6. Per ogni post nuovo, salva prima lo stato uncertain, poi usa l'API GraphQL di Buffer per programmarlo. Se la risposta è ambigua, si ferma e riconcilia al successivo controllo, senza ritentare alla cieca.
7. Il workflow salva state.json su GitHub anche dopo errori. Non eliminare la cronologia.

**Limiti:** il registro e i post preparati sono visibili nel repository attualmente pubblico. Non inserire mai credenziali, dati ospiti o informazioni private. Prima dell'uso accertare che il motore LinkedIn nativo di Post Automatici sia disattivato per il medesimo profilo.

## Setup — nessuna chiave segreta in chat

1. Crea un account **Buffer Free**: https://buffer.com/pricing
2. Collega **solo il tuo profilo LinkedIn personale**, non la pagina aziendale.
3. Buffer → Account Settings → API: genera una personal API key (gratuita nel piano Free).
4. Trova Organization ID e Channel ID tramite il Buffer API Explorer: https://developers.buffer.com/guides/data-model.html
5. Nel repository GitHub, vai a **Settings → Secrets and variables → Actions → New repository secret** e aggiungi:
   - BUFFER_API_KEY: la chiave personale Buffer.
   - BUFFER_ORGANIZATION_ID: l'organizzazione che contiene il profilo.
   - BUFFER_CHANNEL_ID: l'ID del canale LinkedIn personale.
   - BUFFER_EXPECTED_CHANNEL_NAME: il nome visualizzato da Buffer per il profilo personale.
   - OTHER_LINKEDIN_AUTOMATION_DISABLED: inizialmente false, poi true SOLO dopo aver disattivato qualunque altro motore di pubblicazione sul medesimo profilo.
   - BUFFER_PUBLISH_ENABLED: inizialmente false, poi true SOLO dopo verifica identità e prova autorizzata.
6. Prima di attivare, avvia **Actions → LinkedIn personal brand - Buffer Free → Run workflow** con publishing disattivato. La fase validate mostra un'anteprima e testa le regole senza pubblicare.
7. Attiva i due switch soltanto dopo aver verificato account corretto, connessione e assenza di un secondo scheduler.

Questa PR non attiva lo scheduler finché non viene integrata in main. Anche dopo il merge, senza le due variabili su true **non vengono creati post**.

## Verifiche offline

Esegui dal percorso principale del repository:

python -m unittest discover -s tools/linkedin-buffer -p "test_*.py" -v

python tools/linkedin-buffer/runner.py

La prima prova non usa la rete, la seconda stampa soltanto i prossimi slot.

## Budget zero

- Buffer Free: massimo 10 post programmati simultaneamente per canale, con accesso API gratuito.
- GitHub Actions: runner standard gratuiti per il repository pubblico.
- Python: sola libreria standard, nessuna dipendenza/API AI.
- Archiviazione dello storico: file JSON versionato su GitHub.
- Se un provider modifica le regole o si esaurisce il catalogo, il sistema si ferma anziché acquistare servizi o duplicare contenuti.

## Limiti operativi

- I 40 testi sono editoriali evergreen basati su informazioni già fornite: non deducono automaticamente fatti nuovi dal CRM o dalla vita personale.
- Il controllo duplicati remoto copre i post accessibili nell'account Buffer collegato, fino a 2.000. Non può leggere tutti i vecchi post LinkedIn pubblicati fuori Buffer.
- Non pubblicare contemporaneamente sullo stesso profilo con questo modulo e l'autopilot LinkedIn già implementato nel repository.
- La pubblicazione è affidata a Buffer al momento programmato; GitHub pianifica in anticipo.
- Nuovi contenuti autentici oltre i primi 40 richiedono nuove informazioni verificate o aggiornamenti al catalogo. La creatività nuova illimitata non è garantita da questo sistema gratuito.
