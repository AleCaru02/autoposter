# Testing

## Strategia

Durante lo sviluppo la foundation backend viene validata senza costi con Supabase CLI + Docker. GitHub Actions avvia uno stack Supabase locale completo, applica migrations/seed da zero e testa sia PostgreSQL sia Auth/Data API.

Nessun test CI pubblica sui social reali e nessuno dei progetti Supabase cloud esistenti viene usato.

## Workflow locale/CI

File: `.github/workflows/tenant-isolation.yml`.

Sequenza:

1. installa Supabase CLI;
2. `supabase start`;
3. `supabase db reset --local`;
4. verifica migration history;
5. `supabase db lint`;
6. Security Advisors;
7. Performance Advisors;
8. pgTAP;
9. ricava soltanto le chiavi effimere dello stack locale;
10. crea due utenti Auth locali;
11. esegue i test Tenant A/Tenant B e quota;
12. distrugge lo stack senza backup.

## Risultato validato 2026-08-09

- 6/6 migrations applicate da zero: PASS.
- Migration history locale: PASS.
- Schema lint: PASS — `No schema errors found`.
- Security Advisors: PASS — `No issues found`.
- Performance Advisors: PASS — `No issues found`.
- pgTAP: **20/20 PASS**.
- Integration Auth/RLS/quota: **14/14 PASS**.

## Test pgTAP attuali

`supabase/tests/database_security.test.sql` verifica tra l'altro:

- RLS su tutte le tabelle applicative `public`;
- esistenza e isolamento di `app_private`;
- impossibilità client di leggere integration credentials;
- assenza di colonne secret/token plaintext;
- foreign key composte tenant-aware;
- quota RPC non eseguibili da `authenticated`;
- quota RPC disponibili a `service_role`;
- grant server-side necessari a `service_role`;
- `publication_jobs` non scrivibile dal client;
- grant client intenzionali per `websites`;
- bucket Storage privati;
- migration history completa;
- extension `vector` fuori da `public`;
- seed locale e policy plans corrette.

## Test integration attuali

`tests/integration/tenant-isolation.test.ts` crea utenti e tenant effimeri e verifica:

- ogni owner vede solo il proprio tenant;
- SELECT Tenant A → Tenant B restituisce zero righe;
- INSERT A con `tenant_id` B viene rifiutato;
- CRUD completo sulle risorse proprie;
- UPDATE/DELETE A → B non modifica righe;
- FK cross-tenant rifiutata;
- service-only tables non scrivibili da authenticated;
- `app_private` non esposto al client;
- read path anon limitato alle risorse pubbliche intenzionali;
- entitlements leggibili soltanto per tenant autorizzato;
- client non può riservare quota direttamente;
- `reserve → replay → release → replay` idempotente;
- `reserve → commit → replay` exactly-once;
- quota limit e isolamento contatori fra tenant.

## Suite richiesta da completare

- Unit: quality score e altri helper AI deterministici.
- Integration: onboarding → brand profile.
- Tenant isolation esteso: social metadata, analytics, posts, assets e job.
- Publishing mock: idempotency + timeout-after-provider-success.
- Duplicate: exact/normalized/semantic/topic/hook/visual.
- Scheduler mock: lock/batch/retry/dead state.
- Approval: AUTO/MANUALE per provider.
- Telegram callback mock: firma/nonce/user mapping.
- Website scanner: coverage/error/redirect/content hashing.
- Public support bot: nessun accesso tenant.
- Tenant support bot: scope rigorosamente limitato al tenant corrente.

## Anti-clone acceptance

Fixture obbligatorie:

- Pizzeria A/B/C stessa città, 10 post ciascuna.
- Property Manager A/B/C stessa città, 10 post ciascuno.

Verificare mix topic, hook, caption, visual direction e CTA differenti. Il test cross-tenant usa soltanto fingerprint/score server-side e non espone contenuti di un tenant ad altri tenant.

## Da ripetere su Supabase remoto

Quando verrà creato il progetto dedicato, la stessa suite database dovrà essere ripetuta contro l'ambiente remoto prima di beta/test pubblico. Fino a quel momento la validazione remota è intenzionalmente posticipata, non un blocco dello sviluppo.

## Production safety

I test automatici usano provider mock. Nessun test CI deve pubblicare sui social reali o usare token provider di produzione.
