import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, review, store, page, autopilot, qa, calendarMigration] = await Promise.all([
  readFile("db/migrations/20260930_z_approval_workflow.sql","utf8"),
  readFile("api/_lib/content-review.ts","utf8"),
  readFile("src/features/content/content-store.ts","utf8"),
  readFile("src/pages/approvals-page.tsx","utf8"),
  readFile("api/_lib/autopilot.ts","utf8"),
  readFile("api/_lib/content-qa.ts","utf8"),
  readFile("db/migrations/20260826_gate13_calendar.sql","utf8"),
]);

for (const column of ["approval_mode","workflow_status","approved_by","approved_at","rejected_reason","approved_fingerprint"]) {
  assert.match(migration,new RegExp(column),`approval workflow must persist ${column}`);
}
assert.match(migration,/CHECK \(approval_mode IN \('MANUAL','AUTO'\)\)/);
assert.match(migration,/CHECK \(workflow_status IN \('DRAFT','REVIEW','REVIEW_REQUIRED','APPROVED','REJECTED'\)\)/);
assert.match(migration,/review_content_variant_v2/);
assert.match(migration,/CONTENT_REJECTION_REASON_REQUIRED/);
assert.match(migration,/CONTENT_QA_PASS_REQUIRED/);
assert.match(migration,/CONTENT_APPROVAL_METADATA_REQUIRED/);
assert.match(migration,/approved_fingerprint IS DISTINCT FROM NEW\.qa_fingerprint/);
assert.match(migration,/workflow_status := 'REVIEW_REQUIRED'/);
assert.match(migration,/auto_approve_content_variant/);
assert.match(migration,/v_variant\.approval_mode<>'AUTO'/);
assert.match(migration,/v_variant\.qa_status IS DISTINCT FROM 'PASS'/);
assert.match(migration,/a\.quality_status='PASS'/);
assert.match(migration,/a\.identity_status IN \('NOT_REQUIRED','PASS'\)/);

assert.match(review,/review_content_variant_v2/);
assert.match(review,/rejectedReason/);
assert.match(store,/approval_mode: "MANUAL"/);
assert.match(store,/workflow_status: "DRAFT"/);
assert.match(store,/approved_fingerprint/);
assert.match(page,/workflowStatusLabel/);
assert.match(page,/Motivo del rifiuto/);
assert.match(page,/variant\.qa_status !== "PASS"/);
assert.match(page,/Approvato da/);

assert.match(qa,/mark_content_variant_in_review/);
assert.match(autopilot,/runContentQa/);
assert.match(autopilot,/actorType:"AUTOPILOT"/);
assert.match(autopilot,/auto_approve_content_variant/);
assert.match(autopilot,/approvalMode==="AUTOMATIC"/);
assert.match(autopilot,/AUTOPILOT_IMAGE_REQUIRED_FOR_AUTO_APPROVAL/);

assert.match(calendarMigration,/sync_publication_jobs_on_variant_approval/);
assert.match(calendarMigration,/state = 'BLOCKED_APPROVAL'/);
assert.match(calendarMigration,/NEW\.approval_status <> 'APPROVED'/);

console.log("Approval workflow regression: PASS — MANUAL/AUTO audit state, QA-gated approval, rejection reason and post-approval invalidation.");
