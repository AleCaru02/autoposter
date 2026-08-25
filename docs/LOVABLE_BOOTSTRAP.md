# Lovable bootstrap strategy

## Regola

Una sola passata ampia per generare design system + landing + auth shell + onboarding + dashboard/app pages + admin + mock service layer. Subito dopo collegare GitHub e fare diventare GitHub source of truth.

## Backend

Non abilitare un backend Lovable separato. Collegare il Supabase dedicato posseduto dal progetto.

## Cosa NON chiedere a Lovable

- OAuth social reali
- migrations/RLS
- Edge Functions complesse
- OpenAI orchestration
- scheduler/queue
- test backend
- secret management

Queste parti vivono nel repository e vengono implementate direttamente.

## Blocco corrente

2026-08-09: workspace Lovable principale senza crediti disponibili. Nessun ulteriore tentativo automatico fino a ripristino crediti, per evitare sprechi.