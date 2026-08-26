import assert from "node:assert/strict";
import {
  clampPostsPerWeek,
  createCalendarIdempotencyKey,
  formatZonedDateTime,
  isoToZonedInput,
  normalizePreferredSlots,
  zonedLocalToIso,
} from "../src/features/calendar/calendar-workflow.js";

assert.equal(clampPostsPerWeek(-4), 0);
assert.equal(clampPostsPerWeek(3.8), 3);
assert.equal(clampPostsPerWeek(999), 21);
assert.deepEqual(normalizePreferredSlots([
  { day: 5, time: "18:30" },
  { day: 1, time: "09:00" },
  { day: 1, time: "09:00" },
  { day: 0, time: "09:00" },
  { day: 2, time: "25:00" },
]), [
  { day: 1, time: "09:00" },
  { day: 5, time: "18:30" },
]);

assert.equal(zonedLocalToIso("2026-08-26T09:30", "Europe/Rome"), "2026-08-26T07:30:00.000Z");
assert.equal(zonedLocalToIso("2026-12-15T09:30", "Europe/Rome"), "2026-12-15T08:30:00.000Z");
assert.equal(isoToZonedInput("2026-08-26T07:30:00.000Z", "Europe/Rome"), "2026-08-26T09:30");
assert.throws(() => zonedLocalToIso("2026-03-29T02:30", "Europe/Rome"), /ora non esiste/);
assert.match(formatZonedDateTime("2026-08-26T07:30:00.000Z", "Europe/Rome"), /09:30/);
assert.equal(createCalendarIdempotencyKey("abc"), "calendar:abc");

console.log("PASS calendar workflow: frequenze normalizzate, slot deduplicati, timezone Europe/Rome e DST verificati.");
