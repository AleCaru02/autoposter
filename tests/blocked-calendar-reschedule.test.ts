import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration,page,server] = await Promise.all([
  readFile("db/migrations/20260930_zzz_blocked_job_reschedule.sql","utf8"),
  readFile("src/pages/calendar-page.tsx","utf8"),
  readFile("api/_lib/calendar-mutations.ts","utf8"),
]);

assert.match(migration,/manage_profile_calendar_job/);
assert.match(migration,/v_job\.state NOT IN \('SCHEDULED','BLOCKED_APPROVAL'\)/);
assert.match(migration,/p_scheduled_at<=v_now\+interval '1 minute'/);
assert.match(migration,/is_variant_publish_ready\(v_job\.variant_id,v_job\.profile_id,v_job\.provider\)/);
assert.match(migration,/state=CASE WHEN v_ready THEN 'SCHEDULED' ELSE 'BLOCKED_APPROVAL' END/);
assert.match(migration,/REVOKE ALL ON FUNCTION public\.manage_profile_calendar_job/);

assert.match(page,/\["SCHEDULED","BLOCKED_APPROVAL"\]\.includes\(selectedJob\.state\).*job-/s);
assert.match(page,/Puoi comunque spostarlo a una nuova data futura/);
assert.match(server,/action === "RESCHEDULE_JOB"/);
assert.match(server,/expectedUpdatedAt/);

console.log("Blocked calendar reschedule: PASS — blocked jobs can move to a future slot without bypassing QA/approval.");
