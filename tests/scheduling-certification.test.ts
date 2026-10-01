import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { processDuePublications } from "../api/_lib/social.js";
import { isoToZonedInput, zonedLocalToIso } from "../src/features/calendar/calendar-workflow.js";

const [publicationMigration, qaGuardMigration, calendarMigration, wrangler] = await Promise.all([
  readFile("db/migrations/20260908_fase7f_safe_publication_engine.sql", "utf8"),
  readFile("db/migrations/20260930_zz_publication_qa_guard.sql", "utf8"),
  readFile("db/migrations/20260908_fase7e_server_calendar.sql", "utf8"),
  readFile("wrangler.jsonc", "utf8"),
]);

assert.match(calendarMigration, /scheduled_at timestamptz/i);
assert.match(calendarMigration, /pg_catalog\.pg_timezone_names/);
assert.match(publicationMigration, /job\.scheduled_at <= clock_timestamp\(\)/);
assert.match(publicationMigration, /coalesce\(job\.next_attempt_at, job\.scheduled_at\) <= clock_timestamp\(\)/);
assert.match(publicationMigration, /FOR UPDATE SKIP LOCKED/i);
assert.match(publicationMigration, /state='PROCESSING'/);
assert.match(publicationMigration, /claim_token=gen_random_uuid\(\)/);
assert.match(qaGuardMigration, /public\.is_variant_publish_ready/);
assert.match(qaGuardMigration, /state='BLOCKED_APPROVAL'/);
assert.match(qaGuardMigration, /mark_publication_request_started/);

assert.equal(zonedLocalToIso("2026-07-01T10:00", "Europe/Rome"), "2026-07-01T08:00:00.000Z");
assert.equal(zonedLocalToIso("2026-12-01T10:00", "Europe/Rome"), "2026-12-01T09:00:00.000Z");
assert.equal(isoToZonedInput("2026-07-01T08:00:00.000Z", "Europe/Rome"), "2026-07-01T10:00");
assert.throws(() => zonedLocalToIso("2026-03-29T02:30", "Europe/Rome"), /ora non esiste/);

const config = JSON.parse(wrangler.replace(/^\s*\/\/.*$/gm, ""));
assert.equal(config.vars?.SAFE_MODE, "true");

const safeRun = await processDuePublications({ SAFE_MODE: "true" } as Parameters<typeof processDuePublications>[0]);
const safe = safeRun as Record<string, unknown>;
assert.equal(safe.blocked, true);
assert.equal(safe.reason, "SAFE_MODE_ACTIVE");
assert.equal(safe.checked, 0);
assert.equal(safe.published, 0);

console.log("SCHEDULING CERTIFICATION runtime: PASS — UTC/timestamptz, Europe/Rome DST, due boundary, atomic claim and SAFE_MODE no-write boundary verified.");
