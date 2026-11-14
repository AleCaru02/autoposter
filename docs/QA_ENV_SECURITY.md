# Ambienti di test isolati: chiavi di autenticazione

## Problema (rilevato il 14/11/2026)

Un branch Neon copia anche `neon_auth.jwks`, cioè la chiave di firma dei JWT di produzione. Fino a una rotazione, un token emesso dall'Auth del branch QA era accettato dalla Data API di produzione (HTTP 200). Inoltre la chiave privata di produzione, cifrata, risiedeva nel DB QA, raggiungibile con la credenziale della preview.

## Procedura obbligatoria per ogni nuovo branch di test

Va eseguita solo sul branch QA, mai sulla produzione.

1. `delete from neon_auth.jwks;` sul branch QA. Alla prima richiesta `/token` l'Auth QA genera una chiave nuova e propria.
2. Data API del branch QA con provider esplicito: `external`, JWKS `https://<endpoint-qa>.neonauth…/neondb/auth/.well-known/jwks.json`, audience = origine dell'Auth QA.
3. Verifiche (tutte devono passare):

| Test | Atteso |
|---|---|
| Token QA → Data API produzione | 401 `jwk not found` |
| Token QA con `kid` di produzione falsificato → Data API produzione | 401 `signature error` |
| Utente solo-QA → login Auth produzione | 401 `INVALID_EMAIL_OR_PASSWORD` |
| Cookie di sessione QA → `get-session` / `/token` produzione | `null` / 401 |
| JWKS produzione | kid invariato |
| Firma token QA (verifica Ed25519 locale) | valida con la JWKS QA, non valida con quella di produzione |

## Esito 14/11/2026 (branch `qa-reel-engine-20261113`)

- Kid produzione: `fce8cf0d…`, invariato. Kid QA: `b753f7fe…`, nuovo.
- Tutti i test di isolamento verso la produzione: PASS.
- Gli utenti reali non sono toccati: la tabella delle chiavi di produzione e la configurazione della Data API di produzione non sono state modificate.
