# Post Automatici

Piattaforma personale per la gestione automatizzata dei contenuti social di più attività indipendenti.

## Fonte di verità

Il branch `main` di questo repository è la fonte unica del codice di Post Automatici.

Flusso obbligatorio:

`GitHub main -> build verificata -> Vercel`

Lovable viene usato come editor/prototipatore collegato a questo repository; nessuna copia parallela deve diventare sorgente di produzione.

## Fase corrente

Prima priorità: versione personale stabile per Alessandro.

Fuori scope fino al completamento della versione personale:
- landing commerciale;
- pagamenti;
- piani SaaS;
- clienti esterni;
- multiutente commerciale.

## Requisiti fondamentali

- profili/attività illimitati e isolati;
- analisi sito pagina per pagina;
- generazione testi con OpenAI;
- immagini esclusivamente tramite modello OpenAI Images previsto dal progetto;
- Instagram, Facebook, LinkedIn e Google Business Profile;
- post, caroselli, storie e formati supportati progressivamente dalle API;
- frequenza configurabile per profilo;
- metriche reali, mai simulate in modalità reale;
- apprendimento basato su metriche reali;
- funzioni non collegate mostrate come non disponibili/da configurare;
- QA prioritario su iPhone e poi desktop.

## Sviluppo

Metodo: problema -> correzione -> verifica -> PASS -> problema successivo.

```bash
npm install
npm run dev
npm run build
```

Le variabili richieste sono documentate in `.env.example`. Non committare secret.
