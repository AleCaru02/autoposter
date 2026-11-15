# Reel engine — confronto tecnologie (13/11/2026, avatar aggiornato 15/11/2026)

Stato: **documentale**. Budget test live autorizzato = 0 €, quindi nessun provider avatar/voce è stato provato. Nessuna qualità "fotorealistica" è dichiarata finché non esistono campioni reali.

## Architettura scelta (implementata, faceless)

| Livello | Scelta | Stato |
|---|---|---|
| A. Immagini statiche | OpenAI `gpt-image-2.5-sunburst` (già in uso, autorizzato) | IMPLEMENTATO, live non eseguito |
| B. Video/avatar/lip-sync | Nessuno in v1 (Reel faceless: still + Ken Burns) | MISSING per avatar, BLOCKED budget |
| C. Voce | OpenAI `gpt-4o-mini-tts`, voce generica (non clonata) | IMPLEMENTATO, live PASS (Reel 14/11) |
| D. Render/montaggio | FFmpeg 4.1 statico dentro Vercel Function (300 s, 3 GB) | PASS in CI Linux e locale; self-test cloud su preview |
| Storage | Vercel Blob pubblico con suffisso casuale | Codice pronto, store da attivare |
| Coda | `render_jobs` su Neon (lease, retry, ripresa per step) | PASS su branch Neon QA |

## Avatar fotorealistico con volto e voce di Alessandro: analisi del 15/11/2026

Stato: **analisi, nessuna spesa**. Nessun campione reale è stato generato, quindi nessuna qualità è dichiarata come misurata. "Ufficiale" indica una pagina del fornitore letta il 15/11/2026; i dati tratti da indici o blog sono segnalati.

### Requisito
Reel verticali 9:16 da 20 a 40 s in cui parla Alessandro (volto e voce suoi), in italiano. Tutto nel cloud, con consenso documentato. Il motore esistente fornisce già script, coda `render_jobs`, budget, Blob, sottotitoli, loudness e QA.

### Opzioni verificate

| Soluzione | Come funziona | Prezzo API | Requisiti di registrazione | Cloud e API | Note |
|---|---|---|---|---|---|
| **HeyGen Digital Twin (Avatar IV)** | Avatar addestrato su un video reale. La voce viene clonata in automatico dallo stesso video | Avatar IV Digital Twin **4,83 $/min** (≈ 2,42 $ per 30 s) e Avatar V 7,20 $/min, fatturati al secondo. Fonte: help center HeyGen, aggiornato al 09/11/2026; la tabella è dinamica e la cifra viene dall'indice di ricerca della pagina, **da riconfermare alla ricarica**. Wallet API in dollari separato dal piano web, ricarica libera, crediti validi 12 mesi (ufficiale) | Ufficiale (developers.heygen.com, avatar-from-video): 15–600 s di footage, **consigliati circa 2 min** di parlato naturale, 1080p, una sola persona sempre frontale e in quadro, audio pulito senza musica, mp4 fino a 200 MB con upload diretto | REST v3: `POST /v3/assets`, `POST /v3/avatars`, `POST /v3/avatars/{group}/consent` (link valido 24 h, registrazione del consenso in webcam), `POST /v3/videos`, webhook. Addestramento in pochi minuti | Fedeltà attesa maggiore perché il modello è addestrato su un video. Voce clonata inclusa. Il consenso caricato come file è riservato all'Enterprise; per noi va bene il link |
| **ElevenLabs** (solo voce) | Clone professionale della voce (PVC) | TTS Multilingual v2/v3 **0,08 $ per 1.000 caratteri** (≈ 0,04 $ per 30 s). Piano **Creator 22 $/mese** (primo mese 11 $) con 1 slot PVC (ufficiale) | Ufficiale: **minimo 30 min** di audio, ideale 1–3 h, un solo parlante, nessun rumore né eco, livello tra −23 e −18 dB RMS con picchi a −3 dB, MP3 ≥192 kbps, stile costante, verifica vocale del titolare. **Italiano supportato.** Addestramento 3–6 h (fino a 24 h) | REST, output MP3 da passare al nostro motore o all'avatar | Qualità vocale da misurare. Si clona solo la propria voce |
| **Hedra Character-3** | Volto animato da **una foto più un audio** (per esempio la voce ElevenLabs) | 1080p **0,0625 $/s** (≈ 1,88 $ per 30 s), 720p 0,05 $/s, 540p 0,025 $/s. Wallet API prepagato separato dall'abbonamento (ufficiale) | Una foto frontale e un audio da 0,5 a 600 s | REST v3 con endpoint di stima del costo prima dell'esecuzione | Non serve un video di addestramento. Il 9:16 non risulta confermato nella pagina del modello. Attesa più "foto animata" che ripresa reale |
| **Tavus (Phoenix-4.5)** | Avatar addestrato su un video | Video **1 $/min** (Starter 22 $/mese con 1 volto personalizzato), 0,90 $/min (Growth). Volti oltre la quota 40–65 $ (ufficiale, ma la pagina mostra versioni discordanti) | Ufficiale: ripresa continua di 30 s di parlato più 30 s da fermo, ≥1080p, ≥25 fps, inquadratura dal petto in su all'altezza degli occhi, volto ≥25% del quadro, mp4/webm fino a 750 MB. Anteprima in pochi minuti, rifinitura in alcune ore | REST | Costo per Reel più basso (≈ 0,50 $). Prodotto orientato alla conversazione; l'italiano non risulta dalla documentazione letta |
| **Higgsfield Intone** | Talking-head da 1–2 immagini del personaggio più registrazioni vocali | In crediti, **prezzo per generazione non pubblicato** (si vede solo in interfaccia). Saldo attuale: 36 crediti, piano lite | Foto con volto frontale leggibile e audio da 2 a 30 s | Già collegato via MCP; in PR #330 c'è anche un adapter API. 9:16 e 1080p supportati | Limite di 30 s compatibile con i Reel. Soul ID è già integrato per le immagini |
| OpenAI Sora 2 | Video generativo con "characters" da video di riferimento | sora-2 0,10 $/s a 720p, sora-2-pro 0,70 $/s a 1080p (ufficiale) | Non verificato che accetti una persona reale come character | REST | **Scartato per ora:** genera audio proprio, quindi niente lip-sync sulla tua voce, e l'uso del volto reale non è verificato |
| Synthesia | Avatar personale | Avatar compatibile con API come componente aggiuntivo da **1.000 $ per avatar** (help center) | Video | REST | **Scartato:** costo d'ingresso troppo alto |
| D-ID | Avatar | Nessuna tariffa API al minuto pubblica trovata | — | — | **Scartato:** prezzo non verificabile |

### Costo per Reel da 30 s (solo la parte avatar e voce, il resto del motore costa circa 0,05–0,10 $)

| Pipeline | Per Reel | Costo fisso |
|---|---|---|
| A. HeyGen Digital Twin (voce clonata inclusa) | ≈ 2,42 $ | nessuno (wallet) |
| B. ElevenLabs PVC + Hedra 1080p | ≈ 1,92 $ | 22 $/mese |
| C. Tavus | ≈ 0,50 $ | 22 $/mese |
| D. ElevenLabs PVC + Higgsfield Intone | da quotare in crediti | 22 $/mese più crediti |

Con 12 Reel al mese: A ≈ 29 $, B ≈ 45 $, C ≈ 28 $. Sono ipotesi da confermare con il primo test reale.

### Registrazioni da preparare (una sessione copre tutti i fornitori)
1. **Video:** 3–5 minuti continui in italiano, 1080p o 4K, ≥25 fps (meglio 30), inquadratura dal petto in su con la camera all'altezza degli occhi, volto frontale e sempre in quadro, luce morbida uniforme, stanza silenziosa senza musica, parlato naturale con pochi gesti. Alla fine **30 secondi da fermo**, bocca chiusa e sguardo in camera (richiesto da Tavus).
2. **Consenso:** registrato nel flusso del fornitore scelto (HeyGen: link valido 24 h). Nel nostro database viene annotato chi, cosa, fornitore, data e revoca.
3. **Voce per il clone professionale:** almeno 30 minuti di parlato pulito, ideale 1–2 ore, stesso microfono e stesso tono dei Reel, livello tra −23 e −18 dB RMS, MP3 ≥192 kbps. Si può dividere in più sessioni.
4. **Foto:** 3–5 foto frontali nitide, solo per Hedra o Intone.

### Compatibilità con il motore esistente
Sono tutte API REST asincrone, con polling o webhook, senza GPU locale. Cosa c'è già:
- il vincolo `render_jobs.kind` prevede già `REEL_AVATAR`;
- `steps_total` arriva fino a 10;
- budget, idempotenza e ripresa automatica sono riutilizzabili;
- l'MP4 dell'avatar viene salvato su Blob e poi passa dal nostro FFmpeg per sottotitoli, b-roll eventuale, loudness e QA.

**Implementato il 15/11/2026 (PR #332), senza spesa:**
- consenso esplicito, versionato e revocabile;
- materiali privati per profilo (store Vercel Blob **privato** separato, URL firmati di 5 minuti);
- stato di volto e voce, scelta del provider;
- adapter `AvatarVideoProvider` con HeyGen v3, disattivato da `AVATAR_PROVIDER_LIVE_ENABLED`;
- job `REEL_AVATAR` nella pipeline esistente, con anteprima simulata gratuita in preview;
- capability `video.avatar.render`.

Procedura di confronto: `docs/AVATAR_AB_TEST.md`. Materiali da preparare: `docs/AVATAR_MATERIALI.md`.

### Raccomandazione
**Test A/B autorizzato, tetto suggerito 25 $:**
- A: HeyGen Digital Twin, ricarica minima e 2 Reel da 30 s, ≈ 5 $;
- B: ElevenLabs Creator (11 $ il primo mese) + Hedra 1080p, 2 Reel da 30 s, ≈ 4 $ di wallet.

Tutti e due usano lo stesso script e le stesse registrazioni. Si valutano somiglianza del volto, labiale in italiano, naturalezza della voce, artefatti di occhi, denti e mani, tempi e costo reale. Tavus resta l'opzione economica se A e B non giustificano il costo. Prima del test non si attiva nessun pagamento.

**Fonti ufficiali consultate il 15/11/2026:**
- [HeyGen avatar-from-video](https://developers.heygen.com/docs/avatar-from-video), [HeyGen API pricing (help center)](https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api), [ElevenLabs PVC](https://elevenlabs.io/docs/product-guides/voices/voice-cloning/professional-voice-cloning)
- [Hedra Character-3](https://www.hedra.com/develop/models/video/hedra-character-3)
- [Tavus pricing](https://www.tavus.io/pricing), [Tavus Phoenix-4.5 video requirements](https://docs.tavus.io/sections/faces/phoenix-45-video-requirements)
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- [Synthesia, avatar types](https://help.synthesia.io/en/articles/15197011-which-avatar-type-is-right-for-me)

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
