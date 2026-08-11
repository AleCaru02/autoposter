# Zero-cost remote backend decision

Status: **DECISIONE TECNICA — nessun servizio a pagamento attivato**

## Decisione

Per il primo backend remoto reale di Autoposter, la strada primaria e' un **progetto Supabase Free creato e posseduto da un collaboratore reale**, in una organizzazione Free dedicata solo ad Autoposter. Alessandro viene invitato come **Developer**, non Owner/Admin.

Motivo: il limite Free di due progetti si applica alle organizzazioni nelle quali l'utente e' Owner o Administrator. Il ruolo Developer non rientra in quel conteggio. Questa configurazione conserva Auth, Postgres, RLS, Storage, pgvector e le 12 migrations gia' validate senza introdurre un secondo stack di identita/storage.

Fonti ufficiali correnti:
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/billing-faq
- https://supabase.com/docs/guides/platform/access-control
- https://supabase.com/docs/guides/platform/project-transfer
- https://supabase.com/pricing

## Guardrail non negoziabili

Non collegare mai Autoposter ai progetti esistenti:
- `ipazbzctivqquwndifxh` (`clerkai-production-candidate`)
- `lcrmqklqtkmufqbwfkhh`

Il nuovo progetto deve chiamarsi esattamente `autoposter-production`.

Prima di `supabase link`, push migrations, deploy Functions o configurazione Vercel eseguire:

```bash
SUPABASE_TARGET_PROJECT_REF=<new-ref> \
SUPABASE_TARGET_PROJECT_NAME=autoposter-production \
npm run check:remote-supabase-target
```

Quando e' disponibile un `SUPABASE_ACCESS_TOKEN` del membro Developer, il controllo puo' verificare anche i metadata reali del progetto senza stampare il token:

```bash
SUPABASE_ACCESS_TOKEN=<secret> \
SUPABASE_TARGET_PROJECT_REF=<new-ref> \
SUPABASE_TARGET_PROJECT_NAME=autoposter-production \
npm run check:remote-supabase-target -- --verify-remote
```

## Responsabilita' del collaboratore Owner

Il collaboratore deve:
1. creare una nuova organizzazione Free dedicata ad Autoposter;
2. creare `autoposter-production` nella regione concordata;
3. rimanere Owner;
4. invitare Alessandro con ruolo **Developer**;
5. configurare le impostazioni di progetto che un Developer non puo' cambiare, in particolare Auth URL/Site URL/redirect, provider Auth, SMTP/template/rate-limit se necessari, configurazioni di progetto e creazione/rotazione dei secrets Edge Functions;
6. ripristinare il progetto se il Free project viene auto-pausato e il ruolo Developer non consente il restore;
7. effettuare in futuro il transfer del progetto verso una organizzazione Pro posseduta da Alessandro quando verra' deciso il passaggio a pagamento.

Non deve condividere password o secret in chat. I segreti vanno inseriti direttamente nei secret store appropriati.

## Operazioni del Developer

In base alla matrice Access Control corrente, il Developer ha content access alle risorse di progetto e puo' lavorare sul database/SQL, gestire utenti Auth, bucket/file Storage e il codice delle Edge Functions secondo i permessi del ruolo. Non puo' cambiare le impostazioni del progetto e non deve essere promosso ad Admin/Owner durante la fase Free, per non coinvolgere la sua quota Free.

Il provisioning sara' diviso in due parti:
- **Owner one-time setup:** creazione progetto + invito Developer + impostazioni Auth + eventuali function secrets;
- **Developer automation:** migrations, verifiche DB/RLS, dati seed minimi, deploy del codice backend consentito dal ruolo, test online e collegamento del frontend.

## Limiti Free rilevanti per il beta

Al 2026-08-11 Supabase documenta per Free:
- $0/mese;
- 2 progetti attivi per gli utenti che sono Owner/Admin;
- 500 MB database per progetto;
- 1 GB file Storage;
- 5 GB egress;
- 50.000 MAU;
- 500.000 Edge Function invocations;
- 2 milioni Realtime messages e 200 peak connections;
- auto-pause dopo circa una settimana di inattivita/attivita molto bassa.

Per il primo uso personale/beta questi limiti sono compatibili con il percorso minimo. L'auto-pause e' il rischio operativo principale: il proprietario del progetto deve essere disponibile per il restore se necessario.

## Trasferimento futuro

Supabase supporta il project transfer tra organizzazioni. La documentazione distingue il transfer dalla migrazione di progetto: il transfer serve a cambiare organizzazione **senza toccare l'infrastruttura**. Quando Autoposter avra' ricavi:
1. Alessandro crea/aggiorna una propria organizzazione Pro;
2. diventa membro della target organization;
3. il collaboratore, Owner della source organization, avvia il transfer;
4. si ricontrollano ruoli, integrazioni e configurazioni dopo il trasferimento.

Non e' necessario pianificare oggi una migrazione Neon o una ricostruzione del database.

## Cosa resta OFF

- Stripe: OFF
- OpenAI: OFF fino a backend/Auth/Storage/scanner remoto reale
- Meta/Instagram/LinkedIn/GBP/Telegram: OFF
- Lovable: non utilizzato
