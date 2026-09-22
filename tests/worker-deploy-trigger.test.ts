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

assert.match(workflow, /run:\s*npx wrangler deploy/, "Worker deployment command must remain present");
const openAiSecretStep = workflow.indexOf("name: Synchronize OpenAI Worker secret");
const deployStep = workflow.indexOf("name: Deploy Cloudflare Worker");
assert.ok(openAiSecretStep >= 0, "Worker deploy must synchronize the OpenAI secret");
assert.ok(deployStep > openAiSecretStep, "OpenAI secret must be synchronized before Worker deploy");
assert.match(workflow, /OPENAI_API_KEY_SOURCE:\s*\$\{\{ secrets\.OPENAI_API_KEY \}\}/, "OpenAI secret must come from GitHub Actions secrets");
assert.match(workflow, /printf '%s' "\$OPENAI_API_KEY_SOURCE" \| npx wrangler secret put OPENAI_API_KEY/, "OpenAI secret must be provisioned without printing its value");
assert.match(workflow, /names\.has\('OPENAI_API_KEY'\)/, "Deploy must verify the OpenAI Worker binding by name");
assert.doesNotMatch(workflow, /echo\s+"?\$OPENAI_API_KEY_SOURCE/, "Deploy must never echo the OpenAI secret value");

console.log("Worker deploy trigger regression: PASS");
