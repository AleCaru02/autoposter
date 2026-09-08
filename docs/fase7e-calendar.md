# FASE 7E — Calendar

The calendar remains readable through tenant-scoped RLS. All customer mutations now cross the authenticated same-origin API boundary.

- Frequency settings are validated and upserted by a server-owned database function.
- Manual job creation reserves `schedule.job.create` once and commits that logical unit in the same transaction as the publication job.
- Creation is idempotent by profile and operation ID.
- Reschedule and remove lock the job and reject stale tabs.
- Only the profile owner, while not banned, can mutate the calendar.
- Direct authenticated writes to `schedules` and `publication_jobs` fail closed.
- A variant must be eligible, approved and connected to a real active provider before it can be scheduled.

The static regression proves the boundary and transaction contract. Runtime certification is tracked separately before the calendar capabilities can be marked `LIVE_VERIFIED`.
