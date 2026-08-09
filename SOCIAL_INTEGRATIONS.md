# Social Integrations

Ogni provider implementa lo stesso contratto applicativo ma conserva le proprie limitazioni.

## Provider

- Facebook Pages
- Instagram Professional
- LinkedIn
- Google Business Profile

## Regola di distribuzione

Un `core_concept` non implica pubblicazione su tutti i provider. Il planner produce una decisione per piattaforma:

- `native_variant`: stesso concetto, copy/formato nativo.
- `separate_concept`: contenuto diverso perché la piattaforma richiede un intento diverso.
- `skip`: non idoneo.

GBP è orientato a intenti locali/Search/Maps e può ricevere un post distinto.

## Connection health

`CONNECTED`, `EXPIRING`, `EXPIRED`, `REAUTH_REQUIRED`, `PERMISSION_ERROR`.

## Token

Il browser riceve solo metadata di connessione. Access/refresh token restano server-only in storage privato cifrato.

## Idempotency

Prima di ogni publish il worker verifica `idempotency_key` e `external_post_id`. Ogni request crea un `publication_attempt` con correlation id, status HTTP/provider code e classificazione errore.