# FASE 6 — UX audit e direzione di rebrand

## Perimetro osservato

L’audit combina navigazione del runtime pubblico di produzione e inventario dei route/componenti effettivamente pubblicati. Le superfici autenticate saranno ricontrollate con sessioni QA effimere durante i browser smoke dei rispettivi sottoblocchi; nessun dato demo viene introdotto per rendere possibile la revisione.

| Area | Schermate e stati rilevati |
| --- | --- |
| Accesso | Login, registrazione, recupero e reset password; busy, errore e conferma invio |
| Onboarding | Dati attività, crawl sito, analisi brand, errore recuperabile e completamento |
| Operatività | Dashboard, contenuti/Autopilot, revisioni, calendario e pubblicazioni |
| Presenza digitale | Attività, brand, scansione sito, collegamenti social |
| Risultati | Analytics e apprendimento progressivo |
| Account | Impostazioni attività, account, password e logout |
| Backoffice | Overview, clienti, dettaglio, attività, audit, ban/unban, sessioni e impersonation |

## Problemi ordinati per severità

1. **Critico — dashboard orientata al runtime:** espone PostgreSQL, RLS e OpenAI al cliente invece di priorità, contenuti e problemi operativi.
2. **Alto — architettura piatta:** undici destinazioni hanno lo stesso peso e non comunicano il percorso crea → approva → pianifica → misura.
3. **Alto — identità debole:** palette azzurro/grigio, accesso senza promessa di prodotto e backoffice prevalentemente scuro non rispettano la direzione bianco/verde/antracite.
4. **Medio — stati non sistemici:** loading, empty, errore e feedback usano pattern e densità differenti.
5. **Medio — responsive:** la bottom navigation è una base utile, ma “Altro” concentra sette destinazioni; tabelle e azioni amministrative richiedono una revisione dedicata.
6. **Medio — terminologia:** più superfici descrivono garanzie tecniche invece del risultato comprensibile al cliente.

## Design system canonico

- Superfici bianche su canvas `#f6f9f7`, testo antracite `#111713`, verde principale `#19c95d`.
- Scala condivisa per spacing, raggi, bordi, ombre e stati di focus.
- CTA primaria verde, secondaria neutra, pericolo rosso riservato ad azioni distruttive.
- Gerarchia tipografica con titoli compatti, testo operativo leggibile e metadati secondari attenuati.
- Riduzione del movimento rispettata; touch target e breakpoints mobile/tablet mantenuti.

## Nuova architettura di navigazione

| Gruppo | Destinazioni | Intento cliente |
| --- | --- | --- |
| Oggi | Dashboard | Capire priorità e stato del lavoro |
| Crea e pubblica | Contenuti, Revisioni, Calendario | Preparare e portare online i post |
| Canali e risultati | Social, Analytics, Apprendimento | Collegare canali e migliorare i risultati |
| La tua attività | Attività, Brand, Sito, Impostazioni | Gestire identità e configurazione |

## Suddivisione

- 6A: design system, identità, shell globale e navigazione.
- 6B: dashboard cliente orientata alle azioni.
- 6C: flussi cliente principali e stati condivisi.
- 6D: leggibilità e responsive del backoffice senza cambiare authorization.
- 6E: responsive 375/tablet/1440, accessibilità, regressioni e certificazione finale.
