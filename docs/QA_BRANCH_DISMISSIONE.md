# Dismissione del vecchio branch QA `qa-reel-engine-20261113`

**Stato al 15/11/2026, 12:32 UTC:**
- **Passo 2 eseguito** con l'ok di Alessandro: compute `ep-fragrant-mud-ara6ysty` disabilitato. Le connessioni vengono rifiutate con "The endpoint has been disabled".
- Produzione verificata subito dopo: health 200 `postgres_ready`, conteggi invariati (2 utenti, 6 profili, 25 varianti, 3 asset, 15 publication job).
- reel-qa verificato: index 200, stato dei job e self-test di render PASS.
- **Osservazione fino al 17/11/2026 12:32 UTC.** Solo dopo si potrà proporre il passo 4 (eliminazione), che richiede un nuovo ok.

## Cosa è

| Voce | Valore |
|---|---|
| Progetto Neon | `post-automatici-free-recovery` (`snowy-boat-33879785`), lo stesso della produzione |
| Branch | `qa-reel-engine-20261113` (`br-quiet-math-arr5l21f`), figlio di `auth-recovery-v2` (produzione), creato il 13/11/2026 20:31 UTC |
| Compute | `ep-fragrant-mud-ara6ysty`, autosospensione attiva |
| Data API | attiva, ma non funziona più con i token QA dopo la rotazione delle chiavi del 14/11 (vedi `QA_ENV_SECURITY.md`) |
| Ruoli con login | `neondb_owner`, `authenticator`, `reel_preview_app` (creato per la vecchia preview) |
| Contenuto | copia dei dati di produzione al 13/11: 4 utenti, 27 sessioni, 4 connessioni social con token cifrati, profili e contenuti |

**Perché dismetterlo:** non serve più, perché la QA ora gira sul progetto separato `post-automatici-reel-qa`. Contiene però una copia dei dati reali, compresi i token social cifrati, e il ruolo `reel_preview_app` può ancora fare login. È superficie di attacco senza alcuna utilità.

## Dipendenze verificate (15/11/2026)

| Controllo | Esito |
|---|---|
| Branch figli | Nessuno: nessun branch ha come padre `br-quiet-math-arr5l21f` |
| Ambiente Vercel `reel-qa` | Usa il progetto separato: job, costi e asset QA dal 14/11 compaiono solo in `sparkling-frog-58730535` |
| Altre env Vercel | Produzione punta a `auth-recovery-v2`; l'ambiente Preview generico ha solo `BLOB_READ_WRITE_TOKEN` e `AUTH_PREVIEW_ORIGIN`, nessun database |
| Worker Cloudflare | Usa il DB di produzione, non questo branch |
| Codice | Nessun riferimento all'host `ep-fragrant-mud` né al ruolo `reel_preview_app`. Il branch è citato solo nei documenti `QA_ENV_SECURITY.md` e `REEL_PRIMO_TEST.md` |
| Scritture recenti | Nessuna dal 14/11 04:04 UTC (ultima sessione). Ultimo render job 13/11 21:33 (annullato, costo 0). Nessun evento AI, asset o variante creati dopo il fork |
| Dati unici da salvare | Nessuno: l'unico record non presente in produzione è il job annullato del primo tentativo |
| Attività compute | Riattivato il 15/11 tra le 12:00 e le 12:05 UTC senza alcuna scrittura. L'origine non è determinabile, perché i log Neon non sono disponibili per questa regione: è un motivo in più per chiuderlo |

## Procedura (dal più reversibile al definitivo)

1. **Verifica preliminare (gratuita, sola lettura).** Ripetere i controlli della tabella. Sulla produzione `auth-recovery-v2` registrare il conteggio di utenti, profili e varianti, da confrontare al passo 5.
2. **Blocco reversibile delle connessioni.** Disabilitare il compute del branch (`update_postgres_endpoint` con `disabled: true`). Nessun client può più connettersi e non si consuma compute. Si annulla con `disabled: false`.
3. **Osservazione 24–48 ore.** Health della produzione (`/api/health` 200, `postgres_ready`), errori runtime Vercel di produzione e reel-qa invariati, dry run su reel-qa ancora PASS.
4. **Eliminazione** (`delete_branch` su `br-quiet-math-arr5l21f`). Elimina anche compute, ruoli (`reel_preview_app` compreso) e Data API del branch. **Non tocca la produzione:** in Neon un branch figlio non condivide scritture con il padre. Gli MP4 e le immagini su Vercel Blob non vengono eliminati.
5. **Verifica finale.** Conteggi della produzione identici al passo 1, health 200. Il branch compare solo tra quelli eliminati recuperabili (`list_branches include_deleted`) per la finestra di recupero di Neon, poi sparisce.
6. **Pulizia documentale.** Aggiornare `QA_ENV_SECURITY.md` e la memoria del progetto con la data di dismissione.

**Rollback:**
- Passo 2: riabilitare il compute.
- Passo 4: ripristino dal cestino Neon entro la finestra di recupero. Oltre quella finestra non serve, perché il branch non contiene dati unici.

**Non fa parte di questa procedura:**
- Gli altri branch archiviati del 22–29/09 (`canonical-*`, `qa-*`, `backup-pre-global-ai-budget-20260928`) vanno valutati separatamente: il backup va tenuto finché non lo decidi tu.
- Il branch `production` (default, non usato) resta com'è.
