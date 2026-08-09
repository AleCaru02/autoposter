# AI Pipeline

## Pipeline locale validata

1. verifica utente/tenant/ruolo;
2. carica Brand Profile + lock;
3. carica strategia;
4. carica editorial memory e contenuti recenti;
5. seleziona topic/pillar dal calendario;
6. genera core concept;
7. genera varianti specifiche per piattaforma;
8. Google Business Profile decide `native_variant | separate_concept | skip`;
9. genera hook, caption, CTA, hashtag e visual brief;
10. anti-duplicate same-tenant + fingerprint cross-tenant server-side;
11. quality gate;
12. salva concept/varianti/score;
13. applica AUTO/MANUALE per singola piattaforma;
14. scheduler idempotente;
15. publish mock con external ID;
16. analytics snapshot;
17. editorial memory;
18. evidence-gated learning.

Il runtime mock è deterministico ma varia per tenant, correlation/topic e piattaforma. Non restituisce una caption statica comune a tutti i brand.

## Strategy planner

Input:

- brand/industry/sub-industry;
- target;
- goals;
- services/differentiators;
- social attivi;
- posts/settimana;
- giorni/orari;
- editorial memory;
- competitor themes mock.

Profili settoriali già testati:

- Pizzeria;
- Property Manager;
- Networker;
- attività locale generica.

Output:

- pillars;
- content mix;
- objective per pillar;
- formati;
- piattaforme;
- topic seed;
- CTA strategy;
- temi da evitare;
- calendario.

## Platform adaptation

Instagram privilegia resa visuale/conversazionale; Facebook community/local general audience; LinkedIn angolo professionale/argomentato; GBP intento locale, servizio/attività e CTA compatibile.

GBP non è obbligatorio per ogni concept.

## Quality gate

Score interni:

- `brandMatch`;
- `relevance`;
- `novelty`;
- `clarity`;
- `platformFit`;
- `visualFit`;
- `factConfidence`;
- `ctaQuality`;
- `duplicateRisk`.

La UI riduce questi segnali a stati cliente come Pronto / Da controllare / Problema rilevato.

## Anti-duplicate

Same tenant: topic/hook/caption/visual recenti.

Cross tenant: esclusivamente fingerprint/score server-side. Il contenuto raw di un altro tenant non viene restituito al browser.

## Approval

Ogni variante ha `approval_mode` e `approval_status`.

- MANUALE → Approval Center;
- AUTO + QA verde → publication job indipendente.

Edit utente salva valore AI, valore utente e diff. Reject salva feedback/motivo.

## Publishing resilience

Testati:

- provider timeout;
- rate limit;
- auth expired;
- validation error;
- platform rejection;
- provider crea il post ma la risposta va in timeout.

L'ultimo caso viene riconciliato con la stessa idempotency key/external mock ID senza doppia pubblicazione.

## Analytics / learning

Gli snapshot contengono solo metriche previste dal provider mock contract. Il learning usa performance, approvazioni, rifiuti e modifiche utente.

L'optimizer richiede un campione minimo prima di proporre/applicare variazioni: con campione insufficiente produce un insight di attesa, non una falsa conclusione.

## Cost control

Ogni generazione crea `ai_usage_event` mock con task/model/work unit e correlation ID. Eventuali prezzi teorici arrivano da env/config, non sono hardcoded come prezzi provider reali.

## Cosa resta live da collegare

L'interfaccia è pronta ma non sono attivi:

- OpenAI reale;
- web search AI live;
- image generation live;
- social provider reali;
- Telegram reale.

Il quality repair selettivo per singola sottoparte è ancora da completare: la UI può rigenerare l'intero contenuto anziché soltanto il componente fallito.
