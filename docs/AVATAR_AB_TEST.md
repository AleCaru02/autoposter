# Test A/B dell'avatar: HeyGen Digital Twin contro Higgsfield Intone

**Stato: procedura pronta, nessun credito consumato.** Il test parte solo con un'autorizzazione esplicita di Alessandro, con un tetto di spesa scritto.

## Principio
**Stesso materiale e stesso script per entrambi i provider.** Cambia solo il motore che genera il volto che parla. Così le differenze dipendono dal provider e non dall'input.

## Input comuni (preparati una volta sola)
1. **Video di addestramento** (sezione Avatar, archivio privato):
   - 3–5 minuti in italiano, 1080p, inquadratura dal petto in su, volto sempre frontale;
   - alla fine 30 s da fermo con la bocca chiusa.
2. **Foto frontale** per Intone: il fotogramma migliore estratto dallo stesso video, oppure una foto scattata nella stessa sessione e con la stessa luce.
3. **Voce:**
   - HeyGen la clona dallo stesso video;
   - per Intone si usa un estratto audio di 25–30 s dello stesso video, perché il limite è 30 s di voce in totale. Così la voce di partenza è la stessa.
4. **Script unico:** un Reel di 25–30 s generato una volta sola dal motore (step SCRIPT) e congelato. Il testo viene salvato nel job e riusato identico per entrambi.

## Esecuzione (dopo l'autorizzazione)

| Passo | HeyGen | Higgsfield Intone |
|---|---|---|
| Identità | `POST /v3/avatars` con il video (URL firmato di 5 min), consenso con link HeyGen valido 24 h | nessun addestramento: foto e audio di riferimento |
| Generazione | `POST /v3/videos` con lo script congelato | Intone 1080p 9:16 con la foto e la voce di riferimento |
| Post-produzione | la stessa pipeline per entrambi: sottotitoli, loudness −14 LUFS, controllo qualità | la stessa |
| Costo previsto per 30 s | ≈ 2,42 $ (4,83 $/min, da riconfermare alla ricarica) | crediti: si legge il costo in interfaccia prima di confermare |

Tetto suggerito: **10 $ in totale**, cioè 2 generazioni per provider più un margine. Il motore blocca ogni job oltre `AVATAR_JOB_MAX_COST_USD` (predefinito 5 $) e conta la spesa nella capability `video.avatar.render`.

## Valutazione: cieca, dal telefono
I due MP4 vengono rinominati A e B in ordine casuale e guardati su iPhone, a schermo intero e con l'audio.

| Criterio | Peso | Come si misura |
|---|---|---|
| Somiglianza del volto | 30% | voto 1–5: "sembro io?", anche confrontando affiancati il primo fotogramma e una foto reale |
| Labiale in italiano | 25% | voto 1–5 su 3 frasi con consonanti labiali (p, b, m) e doppie |
| Naturalezza della voce | 20% | voto 1–5 su intonazione, ritmo e pronuncia dei nomi (Milano, Airbnb, Booking) |
| Qualità visiva | 15% | voto 1–5 su artefatti di occhi, denti e mani, stabilità dei bordi, nitidezza 1080p |
| Costo e tempo | 10% | $ reali dal job, minuti dall'invio al MP4 |

Si aggiungono le misure automatiche già prodotte dalla pipeline: risoluzione, codec, durata, loudness, picco e QA.

**Esito:**
- vince il provider con il punteggio pesato più alto;
- sotto 3,5/5 nessuno dei due passa e si valuta Tavus, l'alternativa economica documentata in `REEL_PROVIDER_COMPARISON.md`.

## Dopo il test
- Solo il provider vincente viene collegato in produzione: l'adapter è unico e astratto, non si integrano provider inutili.
- I materiali restano nell'archivio privato. Si possono eliminare in qualsiasi momento dalla sezione Avatar, e la revoca del consenso blocca subito ogni generazione.
