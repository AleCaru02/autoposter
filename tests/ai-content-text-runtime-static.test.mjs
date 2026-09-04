import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/audit-viewer-runtime.yml", "utf8");
const gate = readFileSync(".github/workflows/gate.yml", "utf8");
const controller = readFileSync("tests/ai-content-text-qa-controller.mjs", "utf8");
const common = readFileSync("tests/ai-content-text-qa-common.mjs", "utf8");
const state = readFileSync("tests/ai-content-text-qa-state.mjs", "utf8");
const provider = readFileSync("tests/ai-content-text-provider-harness.mjs", "utf8");
const runtimeFiles = ["tests/ai-content-text-runtime.mjs","tests/ai-content-text-runtime-lib.mjs","tests/ai-content-text-runtime-core.mjs","tests/ai-content-text-runtime-concurrency.mjs"];
const runtime = runtimeFiles.map((path) => readFileSync(path,"utf8")).join("\n");
const wrangler = readFileSync("tests/wrangler.ai-content-text-runtime.jsonc", "utf8");

assert.equal(existsSync(".github/workflows/ai-content-text-runtime.yml"), false, "branch-only manual workflow must be absent");
assert.match(workflow, /^name: Audit Viewer Authenticated Runtime/m);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /verify\/ai-content-text-gating-runtime/);
assert.match(workflow, /1377724860fb8cf210d5fb8c677d71fd3faa851b/);
assert.match(workflow, /git diff --name-only/);
for (const allowed of [".github/workflows/audit-viewer-runtime.yml",".github/workflows/gate.yml","tests/ai-content-text-*","tests/wrangler.ai-content-text-runtime.jsonc"]) assert.ok(workflow.includes(allowed));
for (const forbidden of ["api/_lib/text-generation-metering.ts","cloudflare/generate-text.ts","api/_lib/autopilot.ts","db/migrations","stripe","pricing"]) assert.equal(workflow.includes(forbidden), false, `workflow verifier scope must not allow ${forbidden}`);
assert.match(workflow, /wrangler versions upload/);
assert.match(workflow, /--preview-alias/);
assert.match(workflow, /workers\/scripts\/autoposter\/deployments/);
const deployLines = workflow.split("\n").filter((line) => /npx wrangler deploy/.test(line));
assert.ok(deployLines.every((line) => /--dry-run/.test(line)), "verifier must never execute a production wrangler deploy");
assert.match(workflow, /if: always\(\)/);
assert.match(workflow, /sensitiveFindings=0/);
assert.match(workflow, /RUNTIME_VERIFIER_NOT_CERTIFIED/);

assert.match(gate, /AI content text provider instrumentation contract/);
assert.match(gate, /AI content text runtime verifier static safety/);
assert.match(gate, /verify\/ai-content-text-gating-runtime/);
assert.match(gate, /1377724860fb8cf210d5fb8c677d71fd3faa851b/);
assert.match(gate, /wrangler\.ai-content-text-runtime\.jsonc/);

assert.match(controller, /import productWorker from "\.\.\/cloudflare\/entry\.ts"/);
assert.match(controller, /import \{ currentSpend \} from "\.\.\/api\/_lib\/autopilot\.ts"/);
assert.match(common, /AI_TEXT_QA_PROVIDER_CALL/);
assert.match(controller, /AI_TEXT_QA_BARRIER_RELEASE/);
assert.match(controller, /AI_TEXT_QA_BACKGROUND_DONE/);
assert.match(controller, /x-ai-text-qa-token/);
assert.match(controller, /x-ai-text-qa-marker/);
assert.match(common, /PREVIEW_HOST/);
assert.match(common, /aitextqa-/);
assert.match(controller, /OPENAI_API_KEY:fakeKey/);
assert.doesNotMatch(controller, /OPENAI_API_KEY:\s*env\.OPENAI_API_KEY/);
assert.match(controller, /technicalPersistenceFailureBody/);
assert.match(runtime, /PENDING_RECONCILIATION/);
assert.match(controller, /cleanup-residue/);
assert.match(state, /realProviderAvailable:\s*false/);

for (const type of ["MAIN","RESEARCH","FACTCHECK","EDITORIAL_QA"]) {
  assert.ok(provider.includes(`"${type}"`));
  assert.ok(controller.includes(`"${type}"`));
}
for (const unsupported of ["STRATEGIST","PLANNER","IMAGE"]) assert.ok(provider.includes(`"${unsupported}"`));
assert.match(provider, /RUNTIME_VERIFIER_NOT_CERTIFIED/);
assert.match(provider, /barrier/);
assert.match(provider, /provider-failure-release/);
assert.match(provider, /metering-persistence-failure/);
const safeRecord = provider.slice(provider.indexOf("export function safeProviderRecord"), provider.indexOf("export function technicalPersistenceFailureBody"));
for (const secret of ["prompt","authorization","cookie","password","databaseUrl","apiKey","jwt"]) assert.equal(safeRecord.toLowerCase().includes(secret.toLowerCase()), false, `provider counter stores ${secret}`);

for (const scenario of [
  "capability-disabled","limit-zero","first-generation","second-over-limit","research-no-double-count",
  "factcheck-no-double-count","editorial-qa-no-double-count","current-spend-a-b","profile-a-b-isolation",
  "manual-autopilot-shared-quota","provider-failure-release","legacy-budget-denial","metering-persistence-failure",
  "duplicate-committed","duplicate-reserved","concurrent-distinct","concurrent-duplicate","autopilot-retry","cleanup",
]) assert.ok(runtime.includes(scenario), `runtime scenario missing ${scenario}`);
assert.match(runtime, /\/api\/generate-text/);
assert.match(runtime, /\/api\/autopilot\/run/);
assert.match(runtime, /GENERATION_IN_PROGRESS/);
assert.match(runtime, /PENDING_RECONCILIATION/);
assert.match(runtime, /current-spend/);
assert.match(runtime, /release-barrier/);
assert.match(runtime, /background-status/);
assert.match(runtime, /genericCommitted|generic/);
assert.match(runtime, /AGENT_RESEARCH/);
assert.match(runtime, /AGENT_FACTCHECK/);
assert.match(runtime, /AGENT_EDITORIAL_QA/);
assert.match(runtime, /idempotency_key/);
assert.match(runtime, /assertNoSensitive/);

assert.match(wrangler, /ai-content-text-qa-controller\.mjs/);
assert.match(wrangler, /preview_urls/);
assert.match(wrangler, /nodejs_compat/);
assert.doesNotMatch(workflow, /echo\s+.*OPENAI_API_KEY|echo\s+.*DATABASE_URL|echo\s+.*Authorization|echo\s+.*Cookie/i);
console.log("AI content text runtime verifier static safety: PASS");
