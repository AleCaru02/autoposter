# Local E2E — costo fisso €0

Questa procedura avvia l'intero percorso cliente, incluso il visual workflow persistente, senza Supabase cloud e senza provider social/AI reali.

## Prerequisiti

- Node.js 22+
- npm
- Docker Desktop / Docker Engine
- Supabase CLI 2.110.0 o compatibile

## 1. Dipendenze

```bash
npm install --no-audit --no-fund
```

## 2. Supabase locale

```bash
supabase start
supabase db reset --local
```

`db reset --local` applica tutte le migrations e `supabase/seed.sql`. Nessun editing manuale del database è richiesto.

## 3. Chiavi locali

Linux/macOS/WSL:

```bash
eval "$(supabase status -o env \
  --override-name api.url=LOCAL_SUPABASE_URL \
  --override-name auth.anon_key=LOCAL_SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=LOCAL_SUPABASE_SERVICE_ROLE_KEY)"
export LOCAL_SUPABASE_URL LOCAL_SUPABASE_ANON_KEY LOCAL_SUPABASE_SERVICE_ROLE_KEY
```

Sono chiavi dello stack Docker locale, non secret cloud.

## 4. Local API

Terminale 1:

```bash
LOCAL_E2E_ENABLED=true \
LOCAL_SUPABASE_URL="$LOCAL_SUPABASE_URL" \
LOCAL_SUPABASE_ANON_KEY="$LOCAL_SUPABASE_ANON_KEY" \
LOCAL_SUPABASE_SERVICE_ROLE_KEY="$LOCAL_SUPABASE_SERVICE_ROLE_KEY" \
LOCAL_ASSET_MAX_BYTES=8388608 \
LOCAL_API_HOST=127.0.0.1 \
LOCAL_API_PORT=8787 \
npm run dev --workspace=@socialpilot/local-api
```

`LOCAL_ASSET_MAX_BYTES` è configurabile. Se omesso, il local API usa 8 MiB. La CI usa un limite più piccolo soltanto per testare rapidamente il caso oversized.

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Deve indicare `mode: local-e2e`, `publishing: mock-only` e visual deterministic local.

## 5. Web app

Terminale 2:

```bash
VITE_LOCAL_API_URL=http://127.0.0.1:8787 \
npm run dev --workspace=@socialpilot/web -- --host 127.0.0.1 --port 5173
```

Apri `http://127.0.0.1:5173`.

## 6. Percorso cliente completo

1. crea account locale;
2. crea tenant;
3. inserisci attività/sito;
4. esegui website scan;
5. rivedi/conferma/locka il Brand Profile;
6. apri **Asset Library** e carica logo/fotografie/PDF;
7. verifica classificazione, tag, qualità e preview;
8. modifica type/description/alt/tags/preferred/brand-lock oppure archivia/blocca;
9. in **Brand Profile → Brand Visual Settings** seleziona logo principale/alternativo e visual style;
10. scegli obiettivi/target/social/frequenza/AUTO-MANUALE;
11. completa onboarding e genera strategia;
12. genera calendario;
13. genera contenuti: il local API genera automaticamente anche i visual delle varianti applicabili;
14. Asset Selection Engine preferisce asset reali pertinenti e applica fallback branded/mock image quando necessario;
15. renderer salva SVG/carousel in `post-assets` e Visual QA/versions nel DB;
16. apri `/approvals`;
17. usa preview, MODIFICA TESTO, CAMBIA GRAFICA, RIGENERA GRAFICA, CAMBIA FOTO, RIFIUTA o APPROVA;
18. usa `Publish now · MOCK` per lo scheduler locale;
19. verifica dashboard, analytics, learning e cost ledger;
20. prova chatbot pubblico e tenant-aware.

Fixture sito locale, esempio:

```text
http://127.0.0.1:8787/fixture-site/pizza-a/
```

## 7. Asset / visual safety verificabili

- upload identico nello stesso tenant → dedup, nessuna copia inutile;
- MIME non supportato → errore controllato;
- immagine corrotta/dimensioni invalide → errore controllato;
- file sopra il limite → errore controllato;
- `BLOCKED`/`ARCHIVED` → esclusi dal selection engine;
- asset già collegato a un post → delete rifiutato;
- Tenant A non può vedere/modificare/eliminare/usare asset B;
- Tenant A non può scrivere nel path Storage di B;
- render e usage evidence sono server-generated/read-only per il client.

## 8. Visual QA / selective repair

Il renderer controlla overflow headline/body/CTA, contrasto e forbidden fact claims.

Repair mirati supportati:

- hook only;
- caption only;
- hashtag only;
- CTA only;
- visual text/contrast only;
- template rotation only.

Ogni repair/rerender mantiene versioni persistenti. Un forbidden fact claim resta blocker.

## 9. Carousel

L'API visuale può renderizzare carousel locali `educational`, `checklist`, `mistakes`, `step_by_step`, `before_after`, `faq`, `tips`. Ogni slide viene salvata come SVG separato e l'Approval Center mostra la sequenza tramite signed URL.

## 10. Simulazione errori provider social

Nel Post Editor locale restano disponibili:

- provider timeout;
- rate limit;
- auth expired;
- validation error;
- platform rejection;
- successful publish + timeout response.

Lo scheduler conserva idempotency key, tentativi, error class e mock external ID.

## 11. Test automatici completi

Con Supabase/API/web avviati:

```bash
E2E_API_URL=http://127.0.0.1:8787 \
E2E_WEB_URL=http://127.0.0.1:5173 \
npm test --workspace=@socialpilot/e2e
```

Database:

```bash
supabase db lint --local --level warning --fail-on error
supabase db advisors --local --type security
supabase db advisors --local --type performance
supabase test db --local
```

Regression runtime/web:

```bash
npm run typecheck --workspace=@socialpilot/runtime
npm test --workspace=@socialpilot/runtime
npm run typecheck --workspace=@socialpilot/local-api
npm run typecheck --workspace=@socialpilot/web
npm test --workspace=@socialpilot/web
npm run build --workspace=@socialpilot/web
```

Oppure usa `.github/workflows/local-e2e.yml`, che avvia automaticamente Docker, Supabase, local API, Vite e Chromium da runner pulito.

## 12. Arresto

```bash
supabase stop --no-backup
```

Il successivo `supabase db reset --local` ricrea lo stato dal repository.

## Safety

- nessun Supabase remoto nuovo;
- nessun OAuth/provider social reale;
- nessuna chiamata OpenAI/Vision reale;
- image generation corrente = `MockImageGenerationProvider`;
- nessun Telegram reale;
- nessun checkout Stripe;
- nessun deploy production;
- `app_private` non accessibile ai client;
- Storage privato e tenant-safe;
- helper first platform-admin solo seed locale;
- PR #1 resta draft.

Dettagli visual: `VISUAL_PIPELINE.md`.
