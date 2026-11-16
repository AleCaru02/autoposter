# Piano di rilascio della PR #332 (preparato il 16/11/2026, NON ancora eseguito)

**Nessun passo va eseguito senza l'autorizzazione esplicita del proprietario.** Ogni passo ha una verifica e un rollback.

## Stato di partenza verificato (16/11/2026)

| Voce | Stato |
|---|---|
| Produzione Vercel | `main` 5fae111; `/api/health` 200; cron `/api/cron` ogni ora: 24 esecuzioni su 24 nelle ultime 26 ore |
| Worker Cloudflare | Solo il trigger `*/5` (pubblicazioni, bloccate da SAFE_MODE). Trigger orario rimosso il 16/11 |
| DB di produzione | Neon `snowy-boat-33879785`, branch `auth-recovery-v2` (br-wandering-cherry-arpz0cfm). 15 job in `BLOCKED_APPROVAL`, 0 tentativi di pubblicazione |
| Social in produzione | 4 righe ACTIVE del 27–28/09, cifrate con la `SOCIAL_TOKEN_KEY` del Worker, che non è leggibile |
| Social su reel-qa | 4/4 verificati con API reale (vedi `docs/SOCIAL_SETUP_PIANO.md`) |
| CI della PR | verde |

## Migrazioni Neon da applicare in produzione (in quest'ordine)

| # | File | Contenuto | Rischio | Rollback |
|---|---|---|---|---|
| 1 | `20261114_reel_render_jobs.sql` | Tabella `render_jobs` con RLS forzata, formato REEL, asset VIDEO/AUDIO, capability video/voce | Basso, additiva | Ripristino dallo snapshot (passo 0) |
| 2 | `20261115_reel_duration_policy.sql` | Durata configurabile dei Reel | Basso, additiva | Snapshot |
| 3 | `20261116_render_jobs_single_active.sql` | Un solo job attivo per sorgente (indice unico parziale) | Basso, perché in produzione la tabella è nuova e vuota | Snapshot |
| 4 | `20261117_identity_avatar.sql` | Consensi identità, materiali e setup avatar, passo AVATAR, capability avatar | Basso, additiva | Snapshot |
| 5 | `20261118_social_connections_server_owned.sql` | Il browser non legge più `token_reference` e non scrive `social_connections` né i registri (`publication_jobs`, `publication_attempts`, `ai_usage_events`, `audit_log`) | Basso. Verificato che il codice di `main` e della PR legge solo colonne consentite | `GRANT` dei privilegi precedenti (script sotto) |

**La #5 è una correzione di sicurezza compatibile anche con `main`.** Si può applicare subito, prima del resto del rilascio, se autorizzata. Oggi in produzione un utente autenticato può leggere i token cifrati del proprio profilo e falsificare lo stato "verificato".

Rollback della #5:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_connections TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.publication_jobs, public.publication_attempts, public.ai_usage_events, public.audit_log TO authenticated;
```

## Sequenza

0. **Snapshot o branch Neon di backup** di `auth-recovery-v2`, con nome `pre-pr332-<data>`. Verifica: il branch esiste. Rollback del DB: ripristino da questo branch.
1. **Archivio privato dell'identità in produzione:** creare uno store Vercel Blob privato `post-automatici-identity-prod` e collegarlo **solo** a Production come `IDENTITY_BLOB_READ_WRITE_TOKEN`. Non usare mai uno store pubblico per i materiali biometrici. Rientra nel credito incluso del piano Pro.
2. **Migrazioni 1–5**, applicate una alla volta sul branch di produzione. Dopo ciascuna: `to_regclass` e privilegi attesi, health 200.
3. **Merge della PR #332 in `main`**, solo con autorizzazione. Il deploy di produzione Vercel parte dal merge.
   - Verifiche dopo il deploy:
     - `/api/health` 200;
     - nessun errore runtime nuovo;
     - cron delle :00 con `socialCheck` nel log;
     - nessun evento AI doppio;
     - `publication_attempts` invariata.
   - Rollback: "Promote" del deploy precedente in Vercel (istantaneo, `main` 5fae111). Il DB resta compatibile perché le migrazioni sono additive.
4. **Worker Cloudflare:** il workflow `deploy-worker` su `main` ridistribuisce il Worker con `WORKER_SCHEDULER_ENABLED=false` e il solo trigger `*/5`, ormai inattivo. Da quel momento Vercel è l'unico runtime che pianifica.
   - Rollback: redeploy della versione precedente dal pannello Cloudflare (Deployments → Rollback).
5. **`SOCIAL_TOKEN_KEY` di produzione** (vedi sotto).
6. **Riconnessione dei 4 social sul dominio canonico** e «Verifica». Un social è "Collegato" solo se la lettura API riesce.
7. **SAFE_MODE resta attivo.** La prima pubblicazione reale, una per social, richiede un'autorizzazione separata.

## SOCIAL_TOKEN_KEY

- **Dipendenze attuali:**
  - le 4 righe ACTIVE di produzione sono cifrate con la chiave del Worker, che non è recuperabile;
  - nessun'altra tabella usa quella chiave;
  - le connessioni di reel-qa usano una chiave solo QA, su un DB separato.
- **Metodo:** `new-social-token-key.ps1`. Genera 32 byte casuali (base64url, 43 caratteri) e li scrive **solo** su Vercel Production come Sensitive. Si interrompe se la variabile esiste già; il valore non passa da disco, log o appunti.
- **Effetto:**
  - «Verifica» sulle righe esistenti risponde `SOCIAL_TOKEN_KEY_MISMATCH` senza scritture;
  - il cron di ricontrollo le salta, senza declassarle e senza cancellarle;
  - con «Ricollega» la riga viene sovrascritta con il token nuovo; i vecchi token non vengono cancellati prima.
- **Rollback:** rimuovere la variabile da Vercel Production. Le righe non ricollegate restano intatte; quelle già ricollegate richiedono una nuova riconnessione.

## Scadenze da pianificare dopo il rilascio
- LinkedIn: il token dura 60 giorni senza refresh. Il collegamento QA scade il 15/01/2027.
- Meta: accesso ai dati da rinnovare entro 90 giorni. Il collegamento QA scade il 14/02/2027.
- Google: in modalità "Test" il refresh token dura 7 giorni. Serve pubblicare l'app OAuth dopo aver completato il branding.

## Fuori da questo rilascio
- Cancellazione del vecchio branch Neon QA `qa-reel-engine-20261113`, che resta disattivato: richiede un consenso specifico.
- Test A/B dell'avatar con spesa reale e secondo Reel reale senza volto: richiedono autorizzazione con un tetto di spesa.
