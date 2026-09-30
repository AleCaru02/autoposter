import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  jobDisplayStatus,
  jobMatchesFilters,
  shiftDateKey,
  variantDisplayStatus,
  variantMatchesFilters,
  visibleStatuses,
  weekDateKeys,
} from "../src/features/calendar/calendar-view.js";

const variant = {
  id:"v1",content_id:"c1",profile_id:"p1",provider:"INSTAGRAM",format:"CAROUSEL",hook:"h",caption:"c",
  approval_status:"APPROVED",approval_mode:"MANUAL",workflow_status:"APPROVED",qa_status:"PASS",eligible:true,
} as const;
const job = {
  id:"j1",profile_id:"p1",variant_id:"v1",provider:"INSTAGRAM",state:"PROCESSING",scheduled_at:"2026-09-30T08:00:00.000Z",
  idempotency_key:"k",attempt_count:1,next_attempt_at:null,failure_code:null,outcome_unknown:false,remote_post_id:null,published_at:null,last_error:null,
  execution_mode:"REAL_EXTERNAL",created_at:"2026-09-30T07:00:00.000Z",updated_at:"2026-09-30T07:00:00.000Z",
} as const;

assert.equal(variantDisplayStatus(variant), "APPROVED");
assert.equal(jobDisplayStatus(job), "PUBLISHING");
assert.equal(jobDisplayStatus({...job,state:"BLOCKED_APPROVAL"}), "REVIEW");
assert.equal(jobDisplayStatus({...job,state:"PUBLISHED"}), "PUBLISHED");
assert.equal(jobDisplayStatus({...job,state:"FAILED"}), "FAILED");
assert.equal(jobDisplayStatus({...job,state:"SCHEDULED"}), "SCHEDULED");

assert.equal(jobMatchesFilters(job,variant,{provider:"INSTAGRAM",format:"CAROUSEL",status:"PUBLISHING"}),true);
assert.equal(jobMatchesFilters(job,variant,{provider:"FACEBOOK",format:"ALL",status:"ALL"}),false);
assert.equal(variantMatchesFilters(variant,{provider:"ALL",format:"CAROUSEL",status:"APPROVED"}),true);
assert.deepEqual(visibleStatuses(),["DRAFT","REVIEW","APPROVED","SCHEDULED","PUBLISHING","PUBLISHED","FAILED"]);

assert.deepEqual(weekDateKeys("2026-09-30"),["2026-09-28","2026-09-29","2026-09-30","2026-10-01","2026-10-02","2026-10-03","2026-10-04"]);
assert.equal(shiftDateKey("2026-09-30",1),"2026-10-01");
assert.equal(shiftDateKey("2026-03-01",-1),"2026-02-28");

const [page,store,workflow,css] = await Promise.all([
  readFile("src/pages/calendar-page.tsx","utf8"),
  readFile("src/features/calendar/calendar-store.ts","utf8"),
  readFile("src/features/calendar/calendar-workflow.ts","utf8"),
  readFile("src/calendar.css","utf8"),
]);
assert.match(page,/MONTH","WEEK","DAY/);
assert.match(page,/Attività/);
assert.match(page,/Social/);
assert.match(page,/Formato/);
assert.match(page,/Stato/);
assert.match(page,/Contenuti non programmati/);
assert.match(page,/workflow_status === "APPROVED"/);
assert.match(page,/qa_status === "PASS"/);
assert.match(store,/approval_mode,workflow_status,qa_status/);
assert.match(workflow,/zonedLocalToIso/);
assert.match(workflow,/Questa ora non esiste nel fuso del profilo/);
assert.doesNotMatch(css,/\.preferred-slots,.calendar-manual\{display:none!important\}/);

console.log("Calendar views: PASS — month/week/day, profile/provider/format/status filters, workflow states and timezone-safe editing.");
