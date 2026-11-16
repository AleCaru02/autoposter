# Post Automatici · Workspace Premium UX
Versione di lavoro · anteprima PR #330 · novembre 2026

## Obiettivo
Trasformare l'app da generatore manuale in **centrale operativa per l'automazione editoriale**, senza alterare la tecnologia o fingere servizi collegati. Solo uso personale nella fase attuale.

## Direzione creativa
Concetto: *Control room editoriale, fatti prima degli effetti.*
Tre qualità: **preciso · calmo · verificabile**.

- Palette: grafite profondo `#17221c`, verde verificato `#79e3a0`, superficie carta `#ffffff` su `#f6f9f7`.
- Tipografia: Inter/system; titoli compatti e leggibili, testo principale 14–16px, etichette secondarie 11–13px.
- Superfici: bordi chiari `#dce8de`, raggi 11–23px, pochissime ombre, niente gradienti o 3D ornamentali.
- Layout: navigazione esistente, contenuto centrale, iPhone a 390/360px, target touch minimo 44px e nessun overflow documentale.
- Motion: minimo, disabilitabile via `prefers-reduced-motion`.

## Scelte UX
1. Dashboard come riepilogo reale: *quello che devo controllare* prima dei link generici; niente anteprime Instagram finte.
2. I numeri visibili provengono dal dashboard esistente e dalla verifica del provider; `ACTIVE` salvato in database non è sinonimo di collegamento funzionante.
3. Contenuti: piano editoriale AI salvato **prima** delle preferenze, prima del modulo manuale.
4. Le preferenze sono una sezione accessibile `details/summary`: la loro visibilità non è necessaria per l'utilizzo quotidiano.
5. Frequenze configurate per profilo; temi con provider, formato e offset editoriale. Un offset non è presentato come data di pubblicazione definitiva.
6. Ricerca concorrenti: nomi mostrati solo quando la fonte web è verificata; niente risultati inventati o metriche social presunte.
7. Salvataggio preferenze con blocco delle richieste contemporanee, stato visibile e rollback in caso d'errore.
8. Autopilot e API: l'interfaccia non dichiara che un job remoto è riuscito senza un responso reale. Nessuna pubblicazione social in QA.

## Fonti Open Source esaminate
- shadcn/ui (MIT): gerarchie, controlli contestuali, card operative. Nessuna copia di un template.
- Adobe React Aria Components: semantica accessibile e interazioni keyboard/touch. Native `details` evita un runtime aggiuntivo.
- TanStack Query (MIT): pattern di server-state e stati di errore; non installato perché l'integrazione dell'intera cache richiede una migrazione di fetching e test separati.

La scelta conservativa è non introdurre pacchetti nuovi o licenze inutili per questa iterazione. Componenti originali nel repository.

## Verifiche necessarie per il rilascio
- TypeScript, build Vite, test regressione dell'editorial engine, verifica isolamento per profilo;
- browser Chrome/Chromium 1440, 1280, 390, 360px con fixture autenticata che blocca tutte le scritture;
- ordine piano → impostazioni, apertura/chiusura dettagli, navigazione, nessun overflow;
- login/OAuth e produzione con l'account reale **non certificati** dalla fixture;
- credenziali social ancora assenti da Vercel, token GBP scaduto: **non dichiarare pubblicazione funzionante**;
- nessun merge su `main` senza approvazione esplicita.

## Percorsi preservati
`/app/dashboard`, `/app/contenuti`, `/app/approvazioni`, `/app/calendario`, `/app/social`, `/app/analytics`, `/app/apprendimento`, `/app/profili`, `/app/brand`, `/app/sito`, `/app/impostazioni`.
