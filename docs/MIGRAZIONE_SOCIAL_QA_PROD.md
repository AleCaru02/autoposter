# Trasferimento delle 4 connessioni social da reel-qa a produzione (preparato il 16/11/2026, NON eseguito)

## Compatibilità verificata (sola lettura)
| Social | ID account in QA | ID account in produzione | App/client | Esito |
|---|---|---|---|---|
| Facebook | Pagina 712256075315337 | uguale | Meta 900306149763443 (stessa app) | compatibile |
| Instagram | 17841477250068182 (@iltuopropertymanager.it) | uguale | stessa app Meta | compatibile |
| LinkedIn | 9HlznvdfdK | uguale | client 77gm5otb0kan9y (stesso) | compatibile; il token QA scade il 15/01/2027, quello attuale di produzione il 27/11/2026 |
| Google Business Profile | locations/15404740388602514137, accounts/113689094494224746086 | uguale | client 822017806014-h145… (stesso; il secret nuovo è in entrambi gli ambienti) | compatibile; refresh token valido 7 giorni dal consenso (modalità Test) |

- **Profilo di destinazione:** "Il Tuo Property Manager" `73486d3c-dca0-4aaa-a69e-d4b08cc6430f`; in QA il profilo è `08d029d7-…`.
- **Tipo di token:** i token Meta sono di Pagina, LinkedIn è un token membro, Google usa un refresh token. Nessuno è legato al dominio di redirect, quindi funzionano anche in produzione.

## Perché serve una procedura dedicata
Le connessioni QA sono cifrate con la `SOCIAL_TOKEN_KEY` di QA, mentre la produzione ha una chiave diversa. Nessun ambiente le ha entrambe e i valori Sensitive non sono leggibili.

## Procedura (i token in chiaro esistono solo nella memoria di una funzione server di reel-qa)
1. **Chiave K:** generata in memoria (32 byte), mai mostrata, mai salvata su disco. Viene scritta come `SOCIAL_TOKEN_KEY_NEXT` su reel-qa e **sostituisce** la `SOCIAL_TOKEN_KEY` di Production.
   - La chiave di Production creata il 16/11 alle 12:3x non cifra ancora nulla: le 4 righe di produzione sono ancora quelle del Worker di settembre.
   - Si aggiunge `SOCIAL_KEY_EXPORT_ENABLED=true` **solo** su reel-qa.
2. **Deploy di reel-qa** dal branch `tools/social-key-migration` (commit `ba5eb21`).
3. **Esportazione:** `POST /api/social/key-export` sul profilo QA, solo per il proprietario.
   - Per ogni connessione già verificata: decifra con la chiave QA, ricifra con K, verifica che il risultato si riapra con K.
   - Salva **solo il testo cifrato** nella tabella QA `social_token_exports`, che il browser non può leggere.
   - Nessun log.
4. **Backup in produzione:** le 4 righe attuali (token del Worker) vengono copiate nella tabella `social_connections_legacy_20261116`, leggibile solo dal server. Esiste anche il branch Neon `pre-pr332-20261116`.
5. **Aggiornamento delle 4 righe di produzione:**
   - si copiano testo cifrato, permessi, scadenze e metadati;
   - `last_validated_at` viene azzerato, così il collegamento non risulta valido prima della verifica;
   - nessuna riga viene eliminata.
   - Nota: il testo cifrato con K passa dallo strumento SQL dell'agente. Senza K, che nessuno vede, non è decifrabile.
6. **Ridistribuzione della produzione** con la nuova chiave e **verifica reale:**
   - verifica automatica dal cron delle :00, oppure con il pulsante «Verifica»;
   - un social risulta "Collegato" solo se la lettura API riesce.
7. **Pulizia su reel-qa:** rimozione di `SOCIAL_KEY_EXPORT_ENABLED` e `SOCIAL_TOKEN_KEY_NEXT`, eliminazione della tabella `social_token_exports` e nuovo deploy di reel-qa da `main`, così l'endpoint torna disattivo.

## Rollback
- Le righe di produzione si ripristinano da `social_connections_legacy_20261116` con un solo `UPDATE` ... `FROM` (nessuna perdita).
- La chiave K può essere rimossa da Production; le righe ripristinate restano quelle del Worker.

## Rischi residui
- Dopo il trasferimento QA e produzione condividono gli stessi token. In QA `SAFE_MODE=true` e nessun cron è attivo; facoltativamente si possono scollegare le connessioni QA, senza revocarle presso i social.
- Google in modalità Test: il refresh token scade circa il 23/11/2026. Va ricollegato oppure va pubblicata l'app OAuth (serve il branding).
