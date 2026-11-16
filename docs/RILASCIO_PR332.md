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

## Blocco verificato il 16/11: limite di branch Neon
Il progetto di produzione `snowy-boat-33879785` ha **10 branch su 10**, il limite del piano gratuito. `create_branch` risponde `422 branches limit exceeded`. Nel progetto ci sono:
- `production` (default), `auth-recovery-v2` (il DB in uso);
- il vecchio QA `qa-reel-engine-20261113`, disattivato;
- 7 branch archiviati di settembre: `qa-force-tenant-rls-20260929`, `canonical-repro-20260922`, `qa-global-ai-budget-20260928`, `canonical-validation-20260922`, `canonical-clean-20260922`, `qa-canonical-bootstrap-20260922`, `backup-pre-global-ai-budget-20260928`.

Senza liberare almeno 2 posti non si possono creare né il branch di backup (passo 0) né la prova delle migrazioni su una copia dei dati di produzione. **Serve la tua autorizzazione per eliminare branch.**
- **Proposta:** eliminare 2 o più branch archiviati di settembre già superati (per esempio `canonical-repro-20260922` e `canonical-clean-20260922`) oppure il vecchio QA.
- **Rete di sicurezza alternativa:** il ripristino point-in-time di Neon entro la finestra di storia del piano.

Prove già disponibili senza copia di produzione:
- la CI applica l'intera catena di migrazioni su un DB vuoto (verde);
- il DB QA `sparkling-frog-58730535` ha le migrazioni 14–18 applicate e l'app funziona (audit con Playwright);
- la `20261118` è stata testata con utenti autenticati: 403 su token e scritture, 200 sulle letture.

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

## Scheduler dopo il rilascio
| Scheduler | Prima del rilascio | Dopo il rilascio |
|---|---|---|
| Vercel `/api/cron` (ogni ora) | Learning + autopilot (`maxGenerations: 1`) | Ricontrollo in sola lettura dei social non verificati da 20 ore + learning + autopilot |
| Vercel `/api/cron-social` (ogni ora) | Assente su `main` | Presente ma disattivo finché `AUTO_SOCIAL_PUBLISH_ENABLED` / `AUTO_SOCIAL_ANALYTICS_ENABLED` non valgono `true`; la pubblicazione resta comunque bloccata da SAFE_MODE |
| Worker `*/5` | Attivo, bloccato da SAFE_MODE | Inattivo (`WORKER_SCHEDULER_ENABLED=false`) |
| Worker orario | Rimosso il 16/11 | Assente (anche in `wrangler.jsonc`) |

## Verifiche obbligatorie dopo ogni passo
- `/api/health` di Vercel e del Worker: 200.
- `get_runtime_errors` di Vercel: nessun errore nuovo.
- Cron delle :00: log `vercel.cron` con `socialCheck`. Gli eventi `GENERATE_SOCIAL_TEXT` cadono solo dentro la finestra di esecuzione del cron Vercel.
- `publication_attempts`: nessuna riga nuova finché SAFE_MODE è attivo.
- Data API con un utente autenticato: 403 su `token_reference`, sulle scritture di `social_connections` e sui registri; 200 sulle letture consentite e su `customer_ai_budget_overview`.
- Audit dell'app con Playwright: 12 sezioni su iPhone/WebKit, Chromium mobile e desktop; logout → /login.

## Costi
- Gratuito: migrazioni, deploy, store Blob privato (credito incluso nel piano Pro), chiave, verifiche social e audit.
- A pagamento, solo con autorizzazione: generazioni AI dell'autopilot (già attive in produzione con i limiti esistenti), Reel reali, avatar.

## Scadenze da pianificare dopo il rilascio
- LinkedIn: il token dura 60 giorni senza refresh. Il collegamento QA scade il 15/01/2027.
- Meta: accesso ai dati da rinnovare entro 90 giorni. Il collegamento QA scade il 14/02/2027.
- Google: in modalità "Test" il refresh token dura 7 giorni. Serve pubblicare l'app OAuth dopo aver completato il branding.

## Fuori da questo rilascio
- Cancellazione del vecchio branch Neon QA `qa-reel-engine-20261113`, che resta disattivato: richiede un consenso specifico.
- Test A/B dell'avatar con spesa reale e secondo Reel reale senza volto: richiedono autorizzazione con un tetto di spesa.
