import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { variantReadyForPublishing } from "../api/_lib/social.js";

const ready = {
  approval_status:"APPROVED",
  workflow_status:"APPROVED",
  qa_status:"PASS",
  qa_fingerprint:"fp-1",
  approved_fingerprint:"fp-1",
  approved_by:"SYSTEM_AUTOPILOT",
  approved_at:"2026-09-30T12:00:00.000Z",
  eligible:true,
} as const;

assert.equal(variantReadyForPublishing(ready),true);
assert.equal(variantReadyForPublishing({...ready,qa_status:"PENDING"}),false);
assert.equal(variantReadyForPublishing({...ready,workflow_status:"REVIEW_REQUIRED"}),false);
assert.equal(variantReadyForPublishing({...ready,approved_fingerprint:"old"}),false);
assert.equal(variantReadyForPublishing({...ready,approved_by:""}),false);
assert.equal(variantReadyForPublishing({...ready,approved_at:null}),false);
assert.equal(variantReadyForPublishing({...ready,eligible:false}),false);

const [migration,social,calendarMigration] = await Promise.all([
  readFile("db/migrations/20260930_zz_publication_qa_guard.sql","utf8"),
  readFile("api/_lib/social.ts","utf8"),
  readFile("db/migrations/20260930_z_approval_workflow.sql","utf8"),
]);

assert.match(migration,/is_variant_publish_ready/);
assert.match(migration,/workflow_status='APPROVED'/);
assert.match(migration,/qa_status='PASS'/);
assert.match(migration,/approved_fingerprint=v\.qa_fingerprint/);
assert.match(migration,/approved_at IS NOT NULL/);
assert.match(migration,/content_carousel_slides/);
assert.match(migration,/s\.qa_status<>'PASS'/);
assert.match(migration,/state='BLOCKED_APPROVAL'/);
assert.match(migration,/mark_publication_request_started/);
assert.match(migration,/is_variant_publish_ready\(variant_id,profile_id,provider\)/);

assert.match(social,/variantReadyForPublishing/);
assert.match(social,/workflow_status, v\.qa_status, v\.qa_fingerprint, v\.approved_fingerprint/);
assert.match(social,/if \(!variantReadyForPublishing\(variant\)\) throw new Error\("CONTENT_NOT_APPROVED"\)/);
assert.match(social,/if \(!current \|\| !variantReadyForPublishing\(current\)\)/);
assert.match(social,/pubblicazione multi-media Instagram resta disabilitata/);
assert.match(calendarMigration,/approved_fingerprint/);

console.log("Publication QA guard: PASS — remote writes require immutable approved QA fingerprint and real carousel readiness.");
