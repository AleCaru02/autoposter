# Primo Reel reale: preventivo e piano (da autorizzare)

Nessun credito AI viene consumato prima della tua autorizzazione esplicita.

## Cosa viene generato

- **Profilo:** Il Tuo Property Manager (`73486d3c-dca0-4aaa-a69e-d4b08cc6430f`), sul **branch Neon di test** `qa-reel-engine-20261113`. Il database di produzione non viene toccato.
- **Contenuto sorgente:** post Instagram `12d672b4-e505-4d3d-80d3-178854bec946`, *"Prima di scegliere la formula locativa, apri una cartella. Non un portale."*, argomento "Checklist per preparare il confronto tra affitto breve, medio termine e 4+4 a Milano". Alternativa: `d92f565f-5954-4e91-b160-66c6b38e44ba`.
- **Output:** un Reel MP4 9:16 di 20-40 s, 1080x1920, 30 fps, H.264 + AAC 48 kHz, con sottotitoli italiani e voce generica. Viene creato come variante REEL in Revisioni, in stato da approvare. **Nessuna pubblicazione.**

## Provider e risorse

| Step | Provider / risorsa | Chiamate |
|---|---|---|
| Script | OpenAI `gpt-5.6-terra` (Responses, structured output) | 1 |
| Immagini scene | OpenAI `gpt-5.6-terra` (art direction) + `gpt-image-2.5-sunburst` 1440x2560, qualità high | 3-6 coppie (una per scena) |
| Voce | OpenAI `gpt-4o-mini-tts`, voce `alloy`, italiano | 1 |
| Montaggio | FFmpeg 4.1 dentro una Vercel Function di preview (verificato: 9 s renderizzati in 12,3 s) | 1 render da circa 40-60 s |
| Storage | Vercel Blob: scene, voce, MP4, copertina (circa 15-25 MB in tutto) | 8-10 upload |
| Coda e costi | `render_jobs`, entitlement e budget del profilo sul branch QA | — |

## Preventivo

| Voce | Stima | Tetto riservato dal sistema |
|---|---|---|
| Script (circa 3k token in, 1,5k out) | circa 0,02-0,03 $ | 0,08 $ |
| Art direction per scena | circa 0,01 $ × scene | inclusa nella riserva immagine |
| Immagine high 9:16 | circa 0,15-0,25 $ × scene | 0,25 $ × scene |
| Voce TTS (circa 30 s) | circa 0,01 $ | 0,05 $ |
| Render, storage e coda | circa 0,00-0,01 $ | — |
| **Totale, 4 scene** | **circa 0,70-1,10 $** | 1,13 $ |
| **Totale, 6 scene (massimo)** | **circa 1,00-1,60 $** | 1,63 $ |

Il costo reale viene registrato in `render_jobs.cost_usd`, `ai_usage_events` e `provider_cost_attempts`. Se il budget del profilo non basta, il job va in BLOCKED senza spendere.

## Durata attesa

- Elaborazione end-to-end: circa 3-6 minuti, quasi tutti per la generazione delle immagini.
- La pipeline si spezza in step: se supera i 270 s per invocazione riprende al tick successivo.

## Ambiente di test (configurato il 14/11/2026)

- Ambiente Vercel custom `reel-qa` (tipo preview), alias stabile: https://post-automatici-canonical-env-reel-qa-ales-projects-b8ec22ac.vercel.app (protetto da Vercel; serve login Vercel o share link).
- Database: branch Neon `qa-reel-engine-20261113`, ruolo `reel_preview_app` esistente solo su quel branch.
- Data API e Auth: endpoint del branch QA (`ep-fragrant-mud-ara6ysty`), verificati con `/api/health` → `runtime.isolatedNeon=true`.
- Storage: Vercel Blob `post-automatici-reel-preview` (quota inclusa nel piano Pro, nessuno store preesistente).
- `SAFE_MODE=true`, `REEL_ENGINE_ENABLED=true`, nessuna `OPENAI_API_KEY`: il motore è fermo con "Da configurare: chiave OpenAI".

## Unico passo per eseguire il test (solo con autorizzazione)

```
vercel env add OPENAI_API_KEY --environment reel-qa --sensitive
```

Incolla la chiave di produzione quando la CLI la chiede; poi rideploy di `reel-qa` e "Crea Reel" dal pannello Contenuti con il contenuto sorgente indicato sopra.
