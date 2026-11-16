import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUTOPILOT_AI_PAUSED, cronAutopilotAiEnabled, pausedAutopilotResult } from "../api/_lib/autopilot-guard.js";

// Fail-closed: only the exact string "true" enables paid cron generation.
assert.equal(cronAutopilotAiEnabled("true"), true);
for (const value of [undefined, "", "false", "TRUE", " true", "1", "yes", "enabled"]) {
  assert.equal(cronAutopilotAiEnabled(value), false, `value ${JSON.stringify(value)} must keep the autopilot paused`);
}

const paused = pausedAutopilotResult();
assert.equal(paused.paused, AUTOPILOT_AI_PAUSED);
assert.equal(paused.generated, 0);
assert.deepEqual(paused.errors, []);

// The cron keeps its free work and gates only the paid autopilot call.
const cron = readFileSync(new URL("../api/cron.ts", import.meta.url), "utf8");
const gate = cron.indexOf("cronAutopilotAiEnabled(process.env.AUTOPILOT_AI_ENABLED)");
const run = cron.indexOf("runContentAutopilotSerialized(env");
assert.ok(gate > 0 && run > gate, "autopilot run must sit behind the AUTOPILOT_AI_ENABLED gate");
assert.ok(cron.indexOf("revalidateSocialConnections(") < gate, "social re-verification must run before and regardless of the gate");
assert.ok(cron.indexOf("runLearningRuntime(env)") < gate, "learning must run regardless of the gate");
assert.equal((cron.match(/runContentAutopilotSerialized\(/g) ?? []).length, 1, "no other ungated autopilot call in the cron");

console.log("autopilot-guard: PASS");
