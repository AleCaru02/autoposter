import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(".github/workflows/deploy-worker.yml", "utf8");

assert.doesNotMatch(workflow, /head_commit\.message[\s\S]*deploy-worker/, "Worker deployment must not depend on a commit-message marker");
for (const runtimePath of ["cloudflare/**", "api/**", "src/**", "package.json", "package-lock.json", "wrangler.jsonc"]) {
  assert.ok(workflow.includes(runtimePath), `Worker deploy trigger must cover ${runtimePath}`);
}
assert.match(workflow, /run:\s*npx wrangler deploy/, "Worker deployment command must remain present");
console.log("Worker deploy trigger regression: PASS");
