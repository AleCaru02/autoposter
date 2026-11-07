# Integrazione open source per Instagram — Creator Toolkit

Questo ramo aggiunge al progetto **Post Automatici** un primo set di strumenti creativi, senza sostituire il motore editoriale e senza installare applicazioni esterne complete.

## Funzionalità implementate in questo ramo

- **Modelli editoriali direttamente nel compositore:** guida pratica, confronto, FAQ, dietro le quinte e storia interattiva. Compilano tema, obiettivo e formato con un clic, restano modificabili e chiamano l'attuale pipeline AI.
- **Anteprima della caption Instagram:** mostra le prime 125 lettere e il totale complessivo di hook + testo + CTA + hashtag.
- **Preflight editoriale locale:** segnala caption oltre 2.200 caratteri, hashtag ripetuti, più di 5 hashtag come suggerimento di leggibilità, hook mancante e caroselli non completi (4–10 slide). Non modifica automaticamente il testo.
- **Protezioni attuali preservate:** verifica dei fatti, qualità visuale server, approvazioni, metering/costi, isolamento dei profili e pubblicazione in SAFE_MODE.

## Progetti esaminati e decisione tecnica

| Origine | Funzione utile | Decisione |
|---|---|---|
| [Instagram Skill](https://github.com/social-media-skills/instagram-skill) — MIT | Brief per post/carousel/Story, preview e controllo formati | Princìpi di verifica + anteprima testo realizzati nel compositore; NON copiati scripts Python né WoopSocial |
| [II Content Engine](https://github.com/intelligent-iterations/ii-content-engine) — MIT | Template editoriali e concept per video/carousel | Ricette editoriali implementate; browser cookies e pubblicazione non ufficiale esclusi |
| [Postly](https://github.com/chentaymane/Postly) — AGPL-3.0 | Generazione da un brief e gestione calendario; FFmpeg + Piper per Reel | Non importato: il progetto ha già AI, calendario e approvazione. Renderer Reel locale richiede worker, hosting media e test a parte |
| [Postiz](https://github.com/gitroomhq/postiz-app) — AGPL-3.0 | Pubblicazione e analisi tramite API | Non importato: OAuth e scheduler sono già nativi. Un secondo publisher creerebbe duplicazioni e rischi di licenza/consistenza |

## Limitazioni reali da non confondere con funzionalità completate

- Il controllo locale verifica **il testo**, non codec, dimensioni, rapporti d'aspetto, audio e integrità JPEG/MP4: il QA/server deve continuare a verificarli. La creazione di template non attiva l'invio dei carousel con il provider.
- La pubblicazione dei **caroselli** richiede ancora un adapter multi-media verificato con asset JPEG pronti; il runtime social esistente espone soltanto POST/STORY su Instagram.
- I **Reel** richiedono un vero generatore video e un percorso API dedicato (video_url, media_type=REELS), non solo una caption o un'immagine animata. Questa PR non dichiara Reel automatici.
- Nessun accesso Meta, token, abbonamento a servizi terzi o dipendenza a pagamento viene creato.
- NON viene modificato il deploy di produzione. La nuova UI sarà disponibile solo dopo merge, build e rilascio controllato.
- Le licenze MIT dei due progetti utilizzati come riferimento non implicano incorporazione dei loro asset. Non sono stati copiati file, dipendenze, cookie o automazioni di terze parti.

## Verifica

```bash
npm ci
npm run test:instagram-creator-toolkit
npm run typecheck
npm run build
```

Una verifica automatica locale non sostituisce un test end-to-end su account Instagram professionale e ambiente di staging.
