# Testing

## Suite richiesta

- Unit: model router, score, quota, error classifier, fingerprint normalization.
- Integration: onboarding → brand profile; publishing adapters con mock.
- RLS: utente tenant A non può SELECT/INSERT/UPDATE/DELETE su tenant B.
- Tenant isolation: social credentials, analytics, posts, assets e job.
- Publishing: idempotency + timeout-after-provider-success.
- Duplicate: exact/normalized/semantic/topic/hook/visual.
- Scheduler: lock/batch/retry/dead state.
- Quota: endpoint diretto non può aggirare limiti.
- Approval: AUTO/MANUALE per provider.
- Telegram callback: firma/nonce/user mapping.

## Anti-clone acceptance

Fixture obbligatorie:
- Pizzeria A/B/C stessa città, 10 post ciascuna.
- Property Manager A/B/C stessa città, 10 post ciascuno.

Verificare mix topic, hook, caption, visual direction e CTA differenti. Il test cross-tenant usa soltanto fingerprint/score server-side e non espone contenuti di un tenant ad altri tenant.

## Production safety

I test automatici usano mock provider. Nessun test CI deve pubblicare sui social reali.