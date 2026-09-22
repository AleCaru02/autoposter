# Final personal readiness

Tooling QA interno per portare Post Automatici dalla release candidate alla certificazione personale finale. Non è una funzionalità cliente e non sostituisce il verifier #170: ne importa gli esiti desktop/mobile invece di duplicarne il browser harness.

## Ordine di rilascio obbligatorio

1. Verificare che Neon e Managed Auth siano nuovamente disponibili.
2. Applicare **PRIMA la migration** `20260920_persistent_demo_tenant.sql` in una transazione.
3. Verificare il commit della transazione e i nuovi oggetti database.
4. Eseguire **POI il deploy** dello stesso SHA candidato.
5. Avviare il runner e completare le fasi in ordine.

Il codice candidato usa `profile_tenant_modes` ed `execution_mode`: non va distribuito prima della migration. La migration è invece backward-compatible con il codice precedente, quindi la finestra sicura è migration → deploy.

Dopo la migration, il deploy è sicuro anche se il demo non è ancora stato creato: la tabella modalità resta vuota, i profili esistenti continuano come `CUSTOMER_REAL` e nessun seed parte automaticamente. Se Auth torna disponibile ma il provisioning demo fallisce, la chiamata amministrativa viene annullata come singola transazione, il runner classifica il primo errore e i tenant reali restano invariati.

## Prerequisiti

- Node 22 e dipendenze del repository installate.
- SHA candidato noto.
- URL applicazione in `FINAL_QA_APP_BASE` oppure il production URL predefinito.
- `FINAL_QA_DATA_API` per le verifiche Data API.
- Credenziali personali e demo fornite soltanto come variabili d’ambiente o secret temporanei.
- Bearer amministrativo temporaneo in `FINAL_QA_ADMIN_BEARER` solo per il provisioning demo.
- Verifier #170 ancora OPEN/DRAFT e disponibile per produrre il report browser desktop/mobile.

Non inserire credenziali nella riga di comando, nel checkpoint, in Git, nei log Actions o in artifact. Il runner rifiuta evidenze che sembrano contenere password, bearer, cookie, session secret o API key.

## Entry point

```bash
npm run qa:final-readiness -- plan
npm run qa:final-readiness -- init --candidate-sha <sha>
npm run qa:final-readiness -- baseline --evidence <url-gate-candidato>
npm run qa:final-readiness -- run
npm run qa:final-readiness -- resume
npm run qa:final-readiness -- report
```

Il checkpoint predefinito è `.qa/final-personal-readiness.json`, ignorato da Git e scritto con permessi `0600`. Contiene solo stati, riferimenti a evidenze non sensibili, contatori e l’ID del profilo demo.

Per generare localmente una password iniziale senza salvarla:

```bash
npm run qa:final-readiness -- generate-password
```

Il comando è rifiutato dentro GitHub Actions. La password viene mostrata una volta nel terminale e deve essere trasferita direttamente nel secret runtime `FINAL_QA_DEMO_PASSWORD`.

## Fasi

| ID | Fase | Automazione |
|---:|---|---|
| 01 | Auth readiness | Probe same-origin dopo il reset quota |
| 02 | Email/password | Login, sessione e bearer |
| 03 | Google Login | Consenso umano, poi resume |
| 04 | Password Recovery | Consegna email e link reale obbligatori |
| 05 | Demo provisioning | Utente, internal user, tenant, membership, package e guard |
| 06 | Demo seed | Brand, sito, contenuti, metriche, insight e assenza connessioni reali |
| 07 | Demo desktop | Import report verifier #170 |
| 08 | Demo mobile | Import report verifier #170 |
| 09 | GBP | OAuth separato da Google Login; consenso umano se necessario |
| 10 | Facebook | Connessione, pubblicazione appropriata e Analytics reali |
| 11 | Instagram | Connessione, pubblicazione appropriata e Analytics reali |
| 12 | Content | Testo, immagine, review e calendario via report runtime |
| 13 | Autopilot | Piano, contenuto, approvazione, scheduling e pausa |
| 14 | Learning | Conteggio reale deduplicato e runtime solo da 10/10 |
| 15 | Security/Cleanup | Tenant isolation, sensitive scan, P0/P1 e cleanup QA |

## Stati consentiti

Ogni fase e check usa esclusivamente:

- `PASS`
- `FAIL_PRODUCT`
- `FAIL_CONFIGURATION`
- `BLOCKED_EXTERNAL`
- `WAITING_MANUAL_ACTION`
- `WAITING_REAL_DATA`
- `NOT_RUN`

GBP e LinkedIn Analytics, che non fanno parte dei 24 requisiti obbligatori, accettano anche il risultato esterno finale `BLOCKED_EXTERNAL_VERIFIED`.

## Checkpoint, record e ripresa

Quando una fase restituisce `WAITING_MANUAL_ACTION`, il runner salva il checkpoint, stampa una sola istruzione e si ferma. Dopo l’azione:

```bash
npm run qa:final-readiness -- record \
  --phase 03 --status PASS \
  --check AUTH_GOOGLE=PASS --check SESSION=PASS \
  --evidence <url-o-id-run-senza-secret>
npm run qa:final-readiness -- resume --from 04
```

Per importare il report non sensibile prodotto dal verifier #170:

```bash
npm run qa:final-readiness -- import --file <report-json>
npm run qa:final-readiness -- resume
```

Il report deve contenere soltanto check noti e i relativi stati/evidenze. Token, password, cookie e secret fanno fallire l’importazione.

## Demo idempotente

Il provisioning:

1. crea o autentica l’utente demo senza password hardcoded;
2. risolve `neon_auth.user` e `app_users`;
3. crea al massimo un tenant `DEMO_PERSISTENT`;
4. riallinea esattamente una membership `OWNER` se l’utente cambia;
5. applica `demo_persistent:v1` soltanto se non esiste già un’assegnazione attiva;
6. esegue il seed idempotente;
7. verifica assenza di connessioni social e soli job `DEMO_SIMULATION` senza `remote_post_id`.

Una seconda esecuzione non crea un secondo tenant, una seconda membership owner, una seconda assegnazione attiva, contenuti duplicati, metriche duplicate o insight duplicati.

## Password Recovery

`PASSWORD_RECOVERY=PASS` richiede tutte le prove seguenti:

1. richiesta di reset accettata;
2. consegna reale dell’email;
3. apertura del link ricevuto;
4. impostazione della nuova password;
5. login con la nuova password;
6. secondo uso dello stesso token negato.

La sola risposta HTTP della richiesta non è sufficiente.

## Google Login e GBP

Google Login e Google Business Profile sono due OAuth distinti. Se serve consenso, il runner restituisce `WAITING_MANUAL_ACTION` e una sola istruzione. Dopo il callback si registra l’evidenza e si riprende dalla fase successiva.

GBP è `PASS` soltanto dopo callback valida, discovery account paginata, discovery location, persistenza e stato `ACTIVE`. Se Google blocca esternamente il flusso, registrare `BLOCKED_EXTERNAL_VERIFIED` con evidenza priva di token.

## Facebook e Instagram

Il runner non pubblica automaticamente contenuti indesiderati. Connessione e Analytics possono essere controllate senza scritture. La prova publishing deve usare un contenuto esplicitamente approvato come test oppure una pubblicazione reale recente già appropriata, verificandone persistenza e identificativo remoto.

## Learning reale

Il runner legge soltanto snapshot con:

- `source=PROVIDER_API`;
- provider `FACEBOOK` o `INSTAGRAM`;
- `external_post_id`, `published_at`, `captured_at`, `format` e `topic` valorizzati.

Deduplica per `provider + external_post_id`, conserva l’ultima cattura e conta solo campioni valutabili da `scorePerformanceSample`. Sotto soglia restituisce:

```text
WAITING_REAL_DATA — VALID_REAL_SAMPLES=X/10; MISSING=10-X
```

Il Learning runtime viene chiamato solo da 10/10 in avanti. Non vengono creati insight artificiali.

## Failure policy

- `FAIL_PRODUCT`: stop immediato; riportare fase, primo failure, componente/endpoint, evidenza e root cause verificata.
- `FAIL_CONFIGURATION`: correggere la configurazione prima di proseguire con fasi dipendenti.
- `BLOCKED_EXTERNAL`: salvare evidenza e continuare soltanto con fasi indipendenti.
- `WAITING_MANUAL_ACTION`: checkpoint e stop; una sola istruzione.
- `WAITING_REAL_DATA`: nessun dato sintetico; mantenere il conteggio X/10.

## Modello deterministico del 100%

I check obbligatori sono esattamente 24. Il report restituisce `COMPLETED_REQUIRED_CHECKS=A/24`.

Il prodotto è pronto al 100% soltanto se:

- tutti i 24 check sono `PASS`;
- non esiste alcun `FAIL_PRODUCT`;
- `SENSITIVE_FINDINGS=0`;
- `P0_P1_OPEN=0`;
- GBP e LinkedIn Analytics sono `PASS` oppure `BLOCKED_EXTERNAL_VERIFIED`.

Non vengono calcolate percentuali soggettive.

## Migration safety e rollback

`20260920_persistent_demo_tenant.sql` è transazionale e viene applicata dopo `20260917_fase7i_learning_runtime.sql`.

| Operazione | Classificazione | Impatto esistente |
|---|---|---|
| `profile_tenant_modes` | Additive | Nessuna riga creata automaticamente |
| colonne `data_origin`, `execution_mode`, `source_type` | Alterazione compatibile | Default coerente per righe reali esistenti |
| check constraint | Alterazione compatibile | I default fanno superare la validazione alle righe esistenti |
| package `demo_persistent:v1` | Dato di configurazione idempotente | Non modifica package o entitlement reali |
| funzioni e trigger demo | Additive | Inerti finché non esiste un tenant `DEMO_PERSISTENT` |
| seed demo | Data migration esplicita | Eseguita solo dal provisioning amministrativo |
| reset demo | Distruttiva ma strettamente tenant-scoped | Elimina solo dati marcati demo del profilo demo |

Non esiste una down migration automatica perché eliminare colonne o dati dopo il go-live sarebbe il vero rischio. Se il deploy applicativo deve essere ritirato, si effettua rollback del Worker al precedente version ID lasciando gli oggetti database additivi inerti: **non è un rollback distruttivo**. Se la migration fallisce prima del `COMMIT`, PostgreSQL annulla l’intera transazione.

## Cleanup

Il cleanup dei verifier elimina esclusivamente profili `QA_EPHEMERAL`. Il tenant `DEMO_PERSISTENT`, utenti reali, profili reali, connessioni social reali e publication job reali non sono target validi. Il reset demo è amministrativo, idempotente e limitato ai dati demo.
