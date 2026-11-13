# Reel engine — confronto tecnologie (13/11/2026)

Stato: **documentale**. Budget test live autorizzato = 0 €, quindi nessun provider avatar/voce è stato provato. Nessuna qualità "fotorealistica" è dichiarata finché non esistono campioni reali.

## Architettura scelta (implementata, faceless)

| Livello | Scelta | Stato |
|---|---|---|
| A. Immagini statiche | OpenAI `gpt-image-2.5-sunburst` (già in uso, autorizzato) | IMPLEMENTATO, live non eseguito |
| B. Video/avatar/lip-sync | Nessuno in v1 (Reel faceless: still + Ken Burns) | MISSING per avatar, BLOCKED budget |
| C. Voce | OpenAI `gpt-4o-mini-tts`, voce generica (non clonata) | IMPLEMENTATO, live non eseguito |
| D. Render/montaggio | FFmpeg 4.1 statico dentro Vercel Function (300 s, 3 GB) | PASS in CI Linux e locale; self-test cloud su preview |
| Storage | Vercel Blob pubblico con suffisso casuale | Codice pronto, store da attivare |
| Coda | `render_jobs` su Neon (lease, retry, ripresa per step) | PASS su branch Neon QA |

## Avatar fotorealistico e voce clonata — candidati da provare (quando autorizzato)

I prezzi sotto vengono da fonti di terze parti e sono discordanti: vanno riconfermati sui listini ufficiali il giorno dell'attivazione.

| Provider | Uso | API | Prezzo indicativo (da verificare) | Note consenso/diritti |
|---|---|---|---|---|
| HeyGen (Digital Twin / Avatar IV-V) | avatar realistico + voce clonata + lip-sync IT | Sì, wallet API separato dal piano web; ricarica minima 5 $; crediti gratuiti API rimossi feb. 2026 | Avatar III ~1 $/min; Avatar IV ~3–6 $/min (fonti discordanti) | Richiede video di consenso del soggetto |
| Higgsfield (Kling 4 text-to-video, Soul ID) | clip generative 9:16, identità volto via Soul ID | Sì (adapter già in PR #330), saldo API prepagato separato | non verificato | Soul ID già integrato per immagini personal brand |
| ElevenLabs (Professional Voice Clone) | voce clonata italiana di alta qualità | Sì | PVC dal piano Creator 22 $/mese; overage ~0,15–0,30 $/min | Verifica vocale del titolare obbligatoria |
| OpenAI TTS | voce generica italiana | Sì (in uso) | ~0,015 $/min (stima community) | Nessuna clonazione |
| Tavus / Hedra / Sync.so | alternative avatar/lip-sync | Sì | non verificato | da valutare solo se HeyGen non soddisfa |

Requisiti materiale (da confermare sul provider scelto, non numeri arbitrari): HeyGen Digital Twin chiede un video frontale continuo con audio pulito e un video di consenso; ElevenLabs PVC chiede registrazioni vocali pulite con verifica. La UI di onboarding (upload foto/video/voce su Blob privato + tabella `identity_consents`) è progettata ma non implementata finché il provider non è scelto con un test reale.

**Proposta di test (da autorizzare):** 1 Reel da 30 s con HeyGen Digital Twin + 1 con voce ElevenLabs PVC sul Reel faceless esistente. Tetto suggerito 30 €. Valutazione su: somiglianza volto, sincronizzazione labiale, pronuncia italiana, artefatti mani/occhi, tempo di elaborazione, costo reale.

## Repository open source analizzati

Verificati via API GitHub il 13/11/2026.

| Repository | Licenza | Attività | Decisione |
|---|---|---|---|
| harry0703/MoneyPrinterTurbo (★143k, Python) | MIT | attivo | Non installato (Python + MoviePy locale). Ripreso il **pattern**: script → visual per scena → TTS → sottotitoli → montaggio. Possibile futuro: clip stock Pexels per scene reali. |
| social-media-skills/remotion-shorts-skill (TS) | MIT (Remotion: licenza propria) | attivo | Non adottato: Remotion richiede Chromium/Lambda e licenza aziendale oltre 3 dipendenti; FFmpeg copre il caso con meno infrastruttura. Rivalutare per animazioni tipografiche avanzate. |
| waseemnasir2k26/reelforge | MIT | attivo, piccolo | Idea utile per fase futura: Reel da una ripresa talking-head reale con trascrizione (faster-whisper) → sottotitoli. Locale, non portato. |
| artbyjazi/autoclip (★285) | MIT | ultimo push 08/2026 | Clip da video lunghi con speaker tracking: fuori scope v1 (richiede GPU/whisper locale). |
| sergebulaev/instagram-skills (★827) | MIT | attivo | Linee guida caption/hook/caroselli: già assorbite da #330 come template editoriali. |
| social-media-skills/instagram-skill | MIT | attivo | Principi di preflight già in #330. |
| het8802/OpenNolan (★17) | NOASSERTION (licenza non chiara) | ultimo push 08/2026 | Escluso per licenza non dichiarata. |

Nessun codice di terze parti è stato copiato. Dipendenze aggiunte: `@ffmpeg-installer/*` e `@ffprobe-installer/*` (binari FFmpeg GPL eseguiti come processo separato, uso personale non distribuito), `@vercel/blob` (Apache-2.0), `@vercel/functions` (Apache-2.0).
