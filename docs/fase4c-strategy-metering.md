# FASE 4C — `ai.strategy.generate`

## Unità commerciale

Una unità logica corrisponde a un ciclo di generazione o refresh del piano strategico per profilo e giorno UTC. Il ciclo `STRATEGY_PLAN` può produrre due chiamate tecniche OpenAI (`AGENT_STRATEGIST` e `AGENT_PLANNER`); il ciclo `PLAN` ne produce una. I sotto-costi tecnici non incrementano la quota commerciale.

## Ordine applicativo

1. risoluzione tenant e contesto del profilo;
2. riserva atomica di `ai.strategy.generate` quantità `1`;
3. chiamata provider;
4. persistenza affidabile e deduplicata di ogni evento tecnico;
5. persistenza di strategia e piano;
6. cache del risultato e commit della riserva logica;
7. release della riserva su qualsiasi errore prima del commit.

La chiave di idempotenza è derivata server-side da profilo, tipo di ciclo e giorno UTC. Una ripetizione conclusa restituisce il risultato in cache; una ripetizione concorrente non richiama il provider.

## Superfici coperte

- endpoint autenticato `/api/editorial-agents/strategy-plan` su Vercel e Cloudflare;
- refresh Strategist/Planner usato dal percorso applicativo `/api/autopilot/run`;
- isolamento tenant applicato prima dell'ingresso nel planner;
- outbox logico con stato `PENDING_RECONCILIATION` se il ledger tecnico non è persistibile.
