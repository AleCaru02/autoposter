# Deployment

## Source of truth

GitHub è la fonte autorevole del prodotto. Durante la fase pre-merge la release candidate vive su `feat/saas-foundation`; `main` non viene aggiornato finché la PR #1 non è esplicitamente autorizzata al merge.

Lovable non è una dipendenza dell'architettura corrente e non deve bloccare sviluppo o deploy:

- GitHub = source of truth;
- Vercel = frontend/deploy;
- Supabase = Auth/DB/Storage/backend quando il progetto remoto dedicato sarà disponibile;
- Lovable = non necessario, eventuale strumento visuale futuro soltanto se conveniente.

## Vercel

Target frontend: progetto Vercel `autoposter-redesign-preview`.
- Branch/PR → Preview verificabile.
- Il dominio stabile `.vercel.app` deve puntare esclusivamente a un deployment verificato prima della promozione.
- La promozione di una Preview non implica né richiede merge su `main`.
- Env separati per Preview/Production.

## Supabase

Usare un progetto dedicato al prodotto. Non riutilizzare database di altri SaaS. Le migrations sotto `supabase/migrations` sono la fonte autorevole dello schema.

Il frontend usa `VITE_APP_DATA_MODE=REAL` come default fail-closed. La modalità `DEMO` deve essere esplicita. Un tenant `REAL` non può utilizzare i provider fixture come se fossero reali.

## Publishing safety

`AUTO_PUBLISH=false`, provider live `false` e Stripe `false` sono i default. L'abilitazione reale richiede feature flag + connessione valida + quota/budget + approval policy + live validation.

## Release gate

Prima dei primi clienti reali:
- tenant isolation/RLS verde;
- RLS advisor senza finding critici;
- OAuth state/redirect verificati;
- webhook signatures verificate;
- idempotency/retry/reconciliation verdi;
- social test account verificati;
- data deletion/revoke flows verificati;
- legal pages revisionate professionalmente;
- nessun dato DEMO visibile in un tenant REAL;
- budget AI tenant + globale configurati prima della prima API call live.
