# Deployment

## Source of truth

GitHub `main` è la fonte autorevole. Lovable viene usato per bootstrap UI e, solo quando conviene, grandi interventi visuali.

## Vercel

Target frontend: Vercel collegato a GitHub.
- PR/branch → Preview.
- `main` → Production quando CI e staging sono verdi.
- Env separati per Development/Preview/Production.

## Supabase

Usare un progetto dedicato al prodotto. Non riutilizzare database di altri SaaS. Le migrations sotto `supabase/migrations` sono la fonte autorevole dello schema.

## Publishing safety

`APP_ENV=development` e `SOCIAL_PUBLISHING_ENABLED=false` sono il default. L'abilitazione reale richiede feature flag + connessione valida + quota + approval policy.

## Release gate

Prima di production:
- tenant isolation test verde;
- RLS advisor senza finding critici;
- OAuth state/redirect verificati;
- webhook signatures verificate;
- idempotency/retry test verdi;
- social test account verificati;
- data deletion/revoke flows verificati.