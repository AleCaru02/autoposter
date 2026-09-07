import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-worker.yml", "utf8");

assert.doesNotMatch(workflow, /head_commit\.message[\s\S]*deploy-worker/, "Worker deployment must not depend on a commit-message marker");
for (const runtimePath of ["cloudflare/**", "api/**", "src/**", "package.json", "package-lock.json", "wrangler.jsonc"]) {
  assert.ok(workflow.includes(runtimePath), `Worker deploy trigger must cover ${runtimePath}`);
}
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
