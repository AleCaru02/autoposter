import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-worker.yml", "utf8");

assert.match(workflow, /workflow_run:/, "Worker deployment must be triggered by the Gate workflow");
assert.match(workflow, /workflows:\s*\["Post Automatici Gate"\]/, "Worker deployment must depend on Post Automatici Gate");
assert.match(workflow, /types:\s*\[completed\]/, "Worker deployment must wait for a completed Gate run");
assert.match(workflow, /branches:\s*\[main\]/, "Worker deployment must only follow Gate runs on main");
assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/, "Worker deployment must require a successful Gate conclusion");
assert.match(workflow, /ref:\s*\$\{\{ github\.event\.workflow_run\.head_sha \}\}/, "Worker deployment must checkout the exact gated SHA");
assert.doesNotMatch(workflow, /\n\s*push:\s*\n/, "Worker deployment must not race directly from a push trigger");

assert.match(workflow, /npx wrangler deploy --secrets-file worker-secrets\.json/, "Worker deploy must upload code and required secrets atomically");
const prepareSecretStep = workflow.indexOf("name: Prepare Worker secrets");
const deployStep = workflow.indexOf("name: Deploy Cloudflare Worker");
const verifySecretStep = workflow.indexOf("name: Verify Worker secret bindings");
assert.ok(prepareSecretStep >= 0, "Worker deploy must prepare required secrets");
assert.ok(deployStep > prepareSecretStep, "Secrets file must be prepared before Worker deploy");
assert.ok(verifySecretStep > deployStep, "Secret bindings must be verified after Worker deploy");
assert.match(workflow, /OPENAI_API_KEY_SOURCE:\s*\$\{\{ secrets\.OPENAI_API_KEY \}\}/, "OpenAI secret must come from GitHub Actions secrets");
assert.match(workflow, /writeFileSync\('worker-secrets\.json', JSON\.stringify\(secrets\), \{ mode: 0o600 \}\)/, "Secrets file must be private on the runner");
assert.match(workflow, /trap 'rm -f worker-secrets\.json' EXIT/, "Secrets file must be removed after deploy");
assert.doesNotMatch(workflow, /wrangler secret put OPENAI_API_KEY/, "Deploy must not create a pre-deploy secret-only Worker version");
assert.doesNotMatch(workflow, /wrangler secret put ADMIN_BOOTSTRAP_TOKEN/, "Bootstrap must not create a pre-deploy secret-only Worker version");
assert.match(workflow, /names\.has\('OPENAI_API_KEY'\)/, "Deploy must verify the OpenAI Worker binding by name");
assert.doesNotMatch(workflow, /echo\s+"?\$OPENAI_API_KEY_SOURCE/, "Deploy must never echo the OpenAI secret value");

console.log("Worker deploy trigger regression: PASS");
