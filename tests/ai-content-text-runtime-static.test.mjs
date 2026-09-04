import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/ai-content-text-runtime.yml", "utf8");
const runtime = readFileSync("tests/ai-content-text-runtime.mjs", "utf8");

assert.match(workflow, /workflow_dispatch:/, "runtime verifier must be manual-dispatch only");
assert.match(workflow, /verify\/ai-content-text-gating-runtime/, "workflow must be scoped to verifier branch");
assert.match(workflow, /1377724860fb8cf210d5fb8c677d71fd3faa851b/, "verifier must pin the certified production base");
assert.match(workflow, /wrangler versions upload/, "verifier must use isolated Preview version upload");
const deployLines = workflow.split("\n").filter((line) => /npx wrangler deploy/.test(line));
assert.ok(deployLines.every((line) => /--dry-run/.test(line)), "verifier must never run a production wrangler deploy");
assert.match(workflow, /preview-alias/, "Preview alias isolation required");
assert.match(workflow, /workers\/scripts\/autoposter\/deployments/, "production deployment set must be read for isolation verification");
assert.match(workflow, /if: always\(\)/, "cleanup must run unconditionally");
assert.match(workflow, /provider invocation counter/i, "provider invocation instrumentation step required");
assert.match(workflow, /sensitive/i, "sensitive-data scan required");
assert.match(workflow, /RUNTIME_VERIFIER_NOT_CERTIFIED/, "manual execution must remain fail-closed until harness is complete");

for (const scenario of [
  "capability-disabled",
  "limit-zero",
  "legacy-budget-denial",
  "first-generation",
  "second-over-limit",
  "research-no-double-count",
  "factcheck-no-double-count",
  "editorial-qa-no-double-count",
  "profile-a-b-isolation",
  "manual-autopilot-shared-quota",
  "provider-failure-release",
  "metering-persistence-failure",
  "duplicate-committed",
  "duplicate-reserved",
  "concurrent-distinct",
  "concurrent-duplicate",
  "autopilot-retry",
  "cleanup",
]) assert.ok(runtime.includes(scenario), `runtime manifest missing ${scenario}`);

assert.doesNotMatch(workflow, /echo\s+.*OPENAI_API_KEY|echo\s+.*DATABASE_URL|echo\s+.*Authorization|echo\s+.*cookie/i, "workflow must not print sensitive credentials");
console.log("AI content text runtime verifier static safety: PASS");
