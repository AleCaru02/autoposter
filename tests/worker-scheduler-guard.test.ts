import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const entry = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));

assert.equal(config.vars.WORKER_SCHEDULER_ENABLED, "false", "Vercel is the canonical scheduler: Worker cron work must be disabled by default");
const scheduled = entry.slice(entry.indexOf("async scheduled("));
const guard = scheduled.indexOf('WORKER_SCHEDULER_ENABLED?.trim().toLowerCase() !== "true"');
assert.ok(guard > 0, "scheduled() must check the explicit opt-in flag");
for (const work of ["processDuePublications(env)", "processDueAnalytics(env)", "runLearningRuntime(env)", "runContentAutopilotSerialized(env)"]) {
  const at = scheduled.indexOf(work);
  assert.ok(at > guard, `${work} must run only after the scheduler guard`);
}
assert.ok(scheduled.slice(guard, scheduled.indexOf("processDuePublications(env)")).includes("return;"), "disabled scheduler must return before any work");
console.log("PASS worker scheduler guard: Worker cron disattivato di default, Vercel unico scheduler.");
