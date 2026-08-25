# SocialPilot AI — AI Social Media Manager SaaS

Repository principale del SaaS multi-tenant che analizza il brand, costruisce la strategia editoriale, genera contenuti nativi per piattaforma, gestisce approvazioni/pubblicazione e usa gli analytics per migliorare il piano.

## Stato

La Fase 1 costruisce la fondazione tecnica indipendente dalla UI: architettura, contratti TypeScript, schema Supabase, RLS, quote, feature flag, audit, publishing idempotente e test di isolamento. La prima UI deve essere generata con Lovable e poi sincronizzata qui; al momento il bootstrap Lovable è bloccato da crediti workspace esauriti.

## Stack target

- UI bootstrap: Lovable, una sola passata ampia
- Source of truth: GitHub
- Frontend deploy: Vercel
- Backend: Supabase Auth + PostgreSQL + Storage + Edge Functions + Cron + Queues
- AI: OpenAI Responses API + Structured Outputs + model routing
- Social: Facebook Pages, Instagram Professional, LinkedIn, Google Business Profile
- Approval/notifiche: Telegram Bot
- Billing: Stripe-ready; assegnazione piano manuale consentita prima dell'attivazione Stripe

## Principi

1. Tenant isolation server-side e RLS deny-by-default.
2. Secret e token social mai nel browser.
3. Un AI Orchestrator coordina moduli logici, non microservizi inutili.
4. Contesto brand compatto e versionato; RAW knowledge usata solo quando necessaria.
5. Contenuti specifici per piattaforma; niente cross-post cieco.
6. Google Business Profile è un provider locale distinto.
7. Publishing idempotente con retry classificati.
8. Quote e budget AI applicati server-side.
9. Asset reali preferiti alla generazione AI quando adeguati.
10. Analytics solo da metriche realmente disponibili dal provider.

Vedi `MVP_STATUS.md` per lo stato operativo.