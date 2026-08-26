# Stato operativo — Post Automatici

Data audit: 2026-08-26

## Gate

1. GitHub fonte unica — PASS
   - repository canonico: `AleCaru02/autoposter`
   - branch canonico: `main`
2. GitHub/Lovable/Vercel stesso codice — PARTIAL
   - GitHub -> Vercel: build canonica READY e HTTP 200
   - Lovable source-control nativo: richiede autorizzazione GitHub nella UI Lovable; API non disponibile
3. PostgreSQL reale — PASS
   - Neon project dedicato `post-automatici`
   - schema applicativo creato
   - test insert -> nuova query -> read riuscito
   - nessun uso di SQLite
4. Health check reale — IN CORSO
5. Autenticazione reale — DA FARE
6. Profili isolati — DA FARE
7. Dashboard/onboarding/routes — DA FARE
8. Brand persistente — DA FARE
9. Crawler pagina-per-pagina — DA FARE
10. OpenAI testi — DA FARE
11. OpenAI immagini — DA FARE
12. Workflow contenuti — DA FARE
13. Calendario/frequenze — DA FARE
14. OAuth social — DA FARE
15. Pubblicazione reale — DA FARE
16. Metriche reali — DA FARE
17. Apprendimento — DA FARE
18. Retry/errori — DA FARE
19. Bonifica nomi/config — DA FARE
20. QA iPhone/desktop — DA FARE
21. Link candidato — DA FARE

## Regola
Un gate passa a PASS solo con evidenza verificabile.
