# Local E2E — costo fisso €0

Questa procedura avvia l'intero percorso cliente senza usare i progetti Supabase cloud esistenti e senza provider social/AI reali.

## Prerequisiti

- Node.js 22+
- npm
- Docker Desktop / Docker Engine
- Supabase CLI 2.110.0 o compatibile

## 1. Installa le dipendenze

```bash
npm install --no-audit --no-fund
```

## 2. Avvia e ricostruisci Supabase locale

```bash
supabase start
supabase db reset --local
```

`db reset --local` applica tutte le migrations in ordine e carica automaticamente `supabase/seed.sql`. Non sono necessarie modifiche manuali al database.

## 3. Recupera le chiavi dello stack locale

Linux/macOS/WSL:

```bash
eval "$(supabase status -o env \
  --override-name api.url=LOCAL_SUPABASE_URL \
  --override-name auth.anon_key=LOCAL_SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=LOCAL_SUPABASE_SERVICE_ROLE_KEY)"
export LOCAL_SUPABASE_URL LOCAL_SUPABASE_ANON_KEY LOCAL_SUPABASE_SERVICE_ROLE_KEY
```

Le chiavi sono esclusivamente quelle dello stack Docker locale. Non salvarle come secret cloud.

## 4. Avvia il local API

Terminale 1:

```bash
LOCAL_E2E_ENABLED=true \
LOCAL_SUPABASE_URL="$LOCAL_SUPABASE_URL" \
LOCAL_SUPABASE_ANON_KEY="$LOCAL_SUPABASE_ANON_KEY" \
LOCAL_SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SUPABASE_SERVICE_ROLE_KEY" \
LOCAL_API_HOST=127.0.0.1 \
LOCAL_API_PORT=8787 \
npm run dev --workspace=@socialpilot/local-api
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Deve restituire `mode: local-e2e` e `publishing: mock-only`.

## 5. Avvia la web app

Terminale 2:

```bash
VITE_LOCAL_API_URL=http://127.0.0.1:8787 \
npm run dev --workspace=@socialpilot/web -- --host 127.0.0.1 --port 5173
```

Apri:

```text
http://127.0.0.1:5173
```

## 6. Percorso cliente verificabile

Dalla UI:

1. crea account locale;
2. crea tenant durante onboarding;
3. inserisci attività e sito;
4. usa una fixture locale, per esempio `http://127.0.0.1:8787/fixture-site/pizza-a/`, oppure un sito raggiungibile dal tuo ambiente;
5. esegui website scan;
6. rivedi/versiona/conferma/locka il Brand Profile;
7. scegli obiettivi e target;
8. seleziona Instagram, Facebook, LinkedIn e/o Google Business Profile;
9. configura frequenza e AUTO/MANUALE per piattaforma;
10. completa onboarding e genera strategia;
11. genera quattro settimane di calendario;
12. genera contenuti e varianti per canale;
13. usa Approval Center per i canali MANUALI;
14. usa `Publish now · MOCK` per eseguire lo scheduler senza attendere un cron;
15. verifica dashboard, analytics, learning e AI usage ledger;
16. prova chatbot pubblico e chatbot tenant-aware.

## 7. Simulazione errori provider

Nel Post Editor locale sono disponibili:

- provider timeout;
- rate limit;
- auth expired;
- validation error;
- platform rejection;
- successful publish + timeout response.

Lo scheduler conserva idempotency key, tentativi, error class e mock external ID.

## 8. Test automatici completi

Con Supabase/API/web già avviati:

```bash
E2E_API_URL=http://127.0.0.1:8787 \
E2E_WEB_URL=http://127.0.0.1:5173 \
npm test --workspace=@socialpilot/e2e
```

Oppure lascia eseguire `.github/workflows/local-e2e.yml`, che parte da un runner pulito e avvia automaticamente Docker, Supabase, local API, Vite e Chromium.

## 9. Arresto

```bash
supabase stop --no-backup
```

I dati locali sono sacrificabili. Il successivo `supabase db reset --local` ricrea lo stato iniziale dal repository.

## Safety

- nessun terzo progetto Supabase remoto;
- nessun OAuth reale;
- nessun provider social reale;
- nessuna chiamata OpenAI reale;
- nessun Telegram reale;
- nessun checkout Stripe;
- nessun deploy production richiesto;
- `app_private` resta non accessibile ai client;
- l'helper per il primo platform-admin esiste solo nel seed locale;
- la PR #1 resta draft.
