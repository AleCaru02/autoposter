import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../api/cron.ts", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

assert.ok(config.crons.some((entry: { path?: string; schedule?: string }) => entry.path === "/api/cron" && entry.schedule === "0 * * * *"));
assert.match(source, /CRON_SECRET/);
assert.match(source, /UNAUTHORIZED_CRON/);
assert.match(source, /runLearningRuntime/);
assert.match(source, /runContentAutopilotSerialized\(env, \{ maxGenerations: 1 \}\)/);
assert.match(source, /Never publish here/);
assert.doesNotMatch(source, /processDuePublications/);
console.log("Vercel cron route: PASS (hourly, authenticated, budget-bounded, no social writes)");
