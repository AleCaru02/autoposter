import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, controller, runtime, config] = await Promise.all([
  readFile(".github/workflows/audit-viewer-runtime.yml", "utf8"),
  readFile("tests/fase7c-runtime-controller.mjs", "utf8"),
  readFile("tests/fase7c-runtime.mjs", "utf8"),
  readFile("tests/wrangler.fase7c-runtime.jsonc", "utf8"),
]);

assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /wrangler versions upload/);
assert.doesNotMatch(workflow, /wrangler\s+deploy(?!ments)/, "verifier must never deploy its controller to production");
assert.match(workflow, /Verify preview version is isolated from production deployments/);
assert.match(workflow, /CLOUDFLARE_REQUIRED_SECRET_MISSING/);
assert.match(workflow, /GITHUB_OPENAI_SECRET_AVAILABLE: PASS/);
assert.match(workflow, /GITHUB_RUN_ATTEMPT/, "reruns must use a fresh preview identity");
assert.match(workflow, /Cleanup ephemeral FASE 7C identities and data[\s\S]+if: always\(\)/);
assert.match(workflow, /set -euo pipefail/g);
assert.match(controller, /fase7c-\(\[a-z0-9\]/);
assert.match(controller, /delete from public\.profiles where owner_auth_user_id/);
assert.match(controller, /delete from neon_auth\.user/);
assert.match(controller, /qaReleaseReasons/);
assert.match(runtime, /\/api\/onboarding-provision/);
assert.match(runtime, /\/api\/onboarding-complete/);
assert.match(runtime, /\/api\/generate-text/);
assert.match(runtime, /\/api\/generate-image/);
assert.match(runtime, /cross-tenant content read leaked/);
assert.match(runtime, /qaTextCommitted, 1/);
assert.match(runtime, /qaImageCommitted, 1/);
assert.match(runtime, /qaPublicationJobs, 0/);
assert.doesNotMatch(runtime, /api\/social\/publish|publication_jobs.*POST/, "runtime must not publish or schedule content");
assert.match(config, /"preview_urls": true/);

console.log("FASE 7C runtime verifier static safety: PASS");
