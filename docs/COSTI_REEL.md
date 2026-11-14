# Costi Reel — ipotesi e scenari (13/11/2026)

Valori in USD, IVA esclusa. Le cifre provider sono stime da verificare; il sistema registra i costi reali in `ai_usage_events` e `provider_cost_attempts` per ogni Reel (`render_jobs.cost_usd`).

## Costi reali misurati (14/11/2026, primo Reel reale su reel-qa)

Tariffe ufficiali `gpt-image-2.5-sunburst` (verificate il 14/11/2026 su developers.openai.com): input testo 5 $/M token, input immagine 8 $/M, output immagine 30 $/M. Il sistema ora calcola il costo dall'usage restituito da OpenAI:
- se l'input è suddiviso tra testo e immagini, applica le tariffe esatte (`cost_basis = OPENAI_USAGE_X_PUBLISHED_RATES`);
- altrimenti prezza tutto l'input alla tariffa più alta (`CONSERVATIVE_ESTIMATE_UNSPLIT_INPUT`);
- se manca l'usage, addebita la riserva di 0,25 $ (`RESERVE_FALLBACK_MISSING_USAGE`).

| Voce (Reel da 6 scene, 53 s) | Costo |
|---|---|
| Script `gpt-5.6-terra` | 0,011 $ |
| Direzione artistica 6 immagini `gpt-5.6-terra` | 0,085 $ |
| 6 immagini 1440×2560 high (~1.050 token in, 1.843 out ciascuna) | 0,382 $ (stima prudenziale; 0,064 $/immagine) |
| Voce `gpt-4o-mini-tts` 52,8 s | 0,013 $ |
| **Totale registrato** | **0,491 $** |

Con il limite 20–40 s (3–6 scene) il costo atteso è **0,30–0,50 $ per Reel**. In caso di riscrittura correttiva dello script si aggiungono circa 0,01 $. Il tetto per singolo Reel resta di 2 $ (`REEL_JOB_MAX_COST_USD`).

## Ipotesi Reel faceless (ipotesi iniziale 13/11, superata dai dati reali)

- Durata 25–35 s, 1080×1920, 30 fps, 4–5 scene.
- Script: 1 chiamata `gpt-5.6-terra` (~2–4k token) ≈ 0,02–0,05 $.
- Immagini: 4–5 × `gpt-image-2.5-sunburst` 9:16 qualità alta. Il codice riserva 0,25 $/immagine (OpenAI fattura a token; per gpt-image-2 high 1024² fonti esterne indicano ~0,21 $) → **~1,00–1,25 $**.
- Voce: OpenAI TTS ~0,015 $/min → < 0,01 $.
- Content QA del Reel (testo + copertina): ~0,05–0,10 $.
- Render: Vercel Function ~60–120 s di CPU attiva → pochi centesimi.
- Storage Blob: ~10 MB/Reel; 0,023 $/GB-mese → trascurabile.

**Costo per Reel: ~1,15–1,45 $. Con 30% di rigenerazioni: ~1,5–1,9 $.**

## Scenari mensili (solo variabili, per profilo)

| Reel/mese | Stima | Con rigenerazioni |
|---|---|---|
| 30 | ~35–45 $ | ~45–57 $ |
| 60 | ~70–87 $ | ~90–114 $ |
| 90 | ~104–131 $ | ~135–171 $ |
| 90 × N profili | N × ~104–131 $ | N × ~135–171 $ |

Costi fissi: piano Vercel attuale (Pro, cron orari già in uso), Neon free, nessun nuovo abbonamento.

## Limiti attuali in produzione (letti dal DB il 13/11/2026)

- Budget per profilo: 30 € hard cap, di cui 20 € categoria OpenAI → **~12–15 Reel/mese per profilo**.
- Budget account (tutti i profili): **60 €/mese** → ~40 Reel/mese in totale.
- Pacchetto personale: tetto costo provider 100 $/mese per profilo.
- Capability nuove: 200 script, 200 voci, 150 render al mese per profilo.

Per 30 Reel/mese su un profilo va alzato il budget del profilo (≥ 50 €) e dell'account: è una tua decisione, il sistema blocca (`BLOCKED`) senza spendere oltre.

## Avatar fotorealistico (non attivo)

Stima indicativa da verificare: 30 s di avatar HeyGen Avatar IV ≈ 1,5–3 $ in più per Reel; voce clonata ElevenLabs ≈ 22 $/mese fissi + overage. 90 Reel avatar/mese ≈ 135–270 $ di solo avatar. Nessuna attivazione senza tua autorizzazione.
