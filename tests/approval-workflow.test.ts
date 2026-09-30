import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, review, store, page, autopilot] = await Promise.all([
  readFile("db/migrations/20260930_z_approval_workflow.sql", "utf8"),
  readFile("api/_lib/content-review.ts", "utf8"),
  readFile("src/features/content/content-store.ts", "utf8"),
  readFile("src/pages/approvals-page.tsx", "utf8"),
  readFile("api/_lib/autopilot.ts", "utf8"),
]);

for (const column of ["approval_mode","workflow_status","approved_by","approved_at","rejected_reason","approved_fingerprint"]) {
  assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), `approval workflow must persist ${column}`);
}
assert.match(migration, /workflow_status IN \('DRAFT','REVIEW','REVIEW_REQUIRED','APPROVED','REJECTED'\)/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.review_content_variant_v2/);
assert.match(migration, /CONTENT_REJECTION_REASON_REQUIRED/);
assert.match(migration, /CONTENT_SAVE_BEFORE_APPROVAL/);
assert.match(migration, /CONTENT_QA_PASS_REQUIRED/);
assert.match(migration, /approved_fingerprint IS DISTINCT FROM NEW\.qa_fingerprint/);
assert.match(migration, /workflow_status := 'REVIEW_REQUIRED'|workflow_status=CASE WHEN workflow_status='APPROVED'/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.auto_approve_content_variant/);
assert.match(migration, /v_variant\.approval_mode<>'AUTO'/);
assert.match(migration, /v_variant\.qa_status IS DISTINCT FROM 'PASS'/);
assert.match(migration, /s\.qa_status='PASS'/);
assert.match(migration, /a\.quality_status='PASS'/);
assert.match(migration, /a\.identity_status IN \('NOT_REQUIRED','PASS'\)/);

assert.match(review, /rejectedReason\?: string \| null/);
assert.match(review, /review_content_variant_v2/);
assert.match(store, /approval_mode: "MANUAL" \| "AUTO"/);
assert.match(store, /workflow_status: "DRAFT" \| "REVIEW" \| "REVIEW_REQUIRED" \| "APPROVED" \| "REJECTED"/);
assert.match(store, /approved_fingerprint/);
assert.match(page, /Motivo del rifiuto o delle modifiche richieste/);
assert.match(page, /variant\.qa_status !== "PASS"/);
assert.match(page, /workflowStatusLabel/);

assert.match(autopilot, /runContentQa/);
assert.match(autopilot, /finalQa\.overallStatus==="PASS"/);
assert.match(autopilot, /auto_approve_content_variant/);
assert.match(autopilot, /approval_mode,workflow_status/);
assert.doesNotMatch(autopilot, /approval_status=\$\{canAutoApprove\?"APPROVED":"PENDING"\}/, "Autopilot must not approve before final persisted QA");

console.log("Approval workflow: PASS — manual/auto audit metadata, rejection reason, QA-gated approval and post-edit invalidation.");
