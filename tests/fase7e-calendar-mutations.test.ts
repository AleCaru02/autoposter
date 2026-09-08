import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleWorkerCalendar } from "../cloudflare/calendar.js";

const [migration, server, store, page, entry] = await Promise.all([
  readFile("db/migrations/20260908_fase7e_server_calendar.sql", "utf8"),
  readFile("api/_lib/calendar-mutations.ts", "utf8"),
  readFile("src/features/calendar/calendar-store.ts", "utf8"),
  readFile("src/pages/calendar-page.tsx", "utf8"),
  readFile("cloudflare/entry.ts", "utf8"),
]);

assert.match(migration, /schedules_customer_write_guard/);
assert.match(migration, /publication_jobs_customer_write_guard/);
assert.match(migration, /current_user = 'authenticated'/, "authenticated customers must not bypass server-owned calendar mutations");
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.save_profile_schedule/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_profile_calendar_job/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.manage_profile_calendar_job/);
assert.match(migration, /FOR UPDATE;/, "job mutations and usage events must be serialized");
assert.match(migration, /CALENDAR_JOB_STALE/);
assert.match(migration, /capability_key = 'schedule\.job\.create'/);
assert.match(migration, /PERFORM public\.commit_capability_usage\(v_event\.id\)/, "job creation and usage commit must share the transaction");
assert.match(migration, /connection\.status = 'ACTIVE'/);
assert.match(migration, /profile\.owner_auth_user_id = p_actor_auth_user_id/);
assert.match(migration, /coalesce\(auth_user\.banned, false\) IS FALSE/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.create_profile_calendar_job[\s\S]*FROM PUBLIC, authenticated/);

assert.match(server, /capabilityKey: "schedule\.job\.create"/);
assert.match(server, /calendar-create:v1:/);
assert.match(migration, /IF v_event\.state = 'COMMITTED'/, "a committed replay must return the original job");
assert.match(migration, /job\.idempotency_key = v_key/, "concurrent calls must converge on one job");
assert.match(server, /releaseUsage\(eventId\)/);
assert.match(store, /fetch\("\/api\/calendar"/);
assert.doesNotMatch(store, /from\("schedules"\)\.(insert|update|delete)/, "schedule writes must not originate in the browser");
assert.doesNotMatch(store, /from\("publication_jobs"\)\.(insert|update|delete)/, "job writes must not originate in the browser");
assert.match(store, /expectedUpdatedAt: input\.expectedUpdatedAt/);
assert.match(page, /expectedUpdatedAt: job\.updated_at/);
assert.ok(entry.indexOf('path === "/api/calendar"') < entry.indexOf("return worker.fetch(request, env)"), "canonical Worker must route calendar mutations before asset fallback");

const method = await handleWorkerCalendar(new Request("https://example.test/api/calendar", { method: "GET" }), {});
assert.equal(method.status, 405);
const missingDatabase = await handleWorkerCalendar(new Request("https://example.test/api/calendar", { method: "POST" }), {});
assert.equal(missingDatabase.status, 503);
const unauthenticated = await handleWorkerCalendar(new Request("https://example.test/api/calendar", { method: "POST" }), { DATABASE_URL: "postgres://unused" });
assert.equal(unauthenticated.status, 401);

console.log("FASE 7E calendar mutation regression: PASS — server authorization, atomic metering, stale-write denial and direct-write guards.");
