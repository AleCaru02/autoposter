import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleWorkerContentReview } from "../cloudflare/content-review.js";

const [migration, store, page, entry, server] = await Promise.all([
  readFile("db/migrations/20260908_fase7d_atomic_content_review.sql", "utf8"),
  readFile("src/features/content/content-store.ts", "utf8"),
  readFile("src/pages/approvals-page.tsx", "utf8"),
  readFile("cloudflare/entry.ts", "utf8"),
  readFile("api/_lib/content-review.ts", "utf8"),
]);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.review_content_variant/);
assert.match(migration, /FOR UPDATE;/, "review transition must lock the scoped variant");
assert.match(migration, /v_variant\.updated_at IS DISTINCT FROM p_expected_updated_at/, "stale tabs must fail closed");
assert.match(migration, /CONTENT_REVIEW_STALE/);
assert.match(migration, /bool_and\(variant\.approval_status = 'APPROVED'\)/, "parent state must be derived in the same transaction");
assert.match(migration, /bool_or\(variant\.approval_status = 'CHANGES_REQUESTED'\)/);
assert.match(migration, /content_variants_approval_guard/);
assert.match(migration, /NEW\.approval_status IN \('APPROVED', 'CHANGES_REQUESTED'\)/, "direct customer approval must be blocked");
assert.match(migration, /REVOKE ALL ON FUNCTION public\.review_content_variant[\s\S]*FROM PUBLIC, authenticated/);
assert.match(migration, /profile\.owner_auth_user_id = p_actor_auth_user_id/);
assert.match(migration, /coalesce\(auth_user\.banned, false\) IS FALSE/);

assert.match(store, /fetch\("\/api\/content-review"/);
assert.match(store, /expectedUpdatedAt: string/);
assert.doesNotMatch(store, /from\("content_variants"\)\.update\(\{ approval_status:/, "review state must not be written directly by the customer client");
assert.doesNotMatch(store, /from\("content_items"\)\.update\(\{ status:/, "parent review state must be server-derived");
assert.match(page, /approvalStatus,/);
assert.match(page, /currentSaveStatus === "SAVING"/, "approval must not race an in-flight autosave");
assert.ok(entry.indexOf('path === "/api/content-review"') < entry.indexOf("return worker.fetch(request, env)"), "canonical Worker must route review before asset fallback");
assert.match(server, /public\.review_content_variant/);

const method = await handleWorkerContentReview(new Request("https://example.test/api/content-review", { method: "GET" }), {});
assert.equal(method.status, 405);
const missingDatabase = await handleWorkerContentReview(new Request("https://example.test/api/content-review", { method: "POST" }), {});
assert.equal(missingDatabase.status, 503);
const unauthenticated = await handleWorkerContentReview(new Request("https://example.test/api/content-review", { method: "POST" }), { DATABASE_URL: "postgres://unused" });
assert.equal(unauthenticated.status, 401);

console.log("FASE 7D content review regression: PASS — server-owned atomic transition, stale-write denial and customer direct-approval guard.");
