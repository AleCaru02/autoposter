import assert from "node:assert/strict";
import fs from "node:fs";
import { currentSpend } from "../api/_lib/autopilot.js";
import { AI_CONTENT_TEXT_CAPABILITY, deriveTextGenerationOperationKey } from "../api/_lib/text-generation-metering.js";

const manual = fs.readFileSync("api/generate-text.ts", "utf8");
const worker = fs.readFileSync("cloudflare/generate-text.ts", "utf8");
const autopilot = fs.readFileSync("api/_lib/autopilot.ts", "utf8");
const meter = fs.readFileSync("api/_lib/text-generation-metering.ts", "utf8");
const research = fs.readFileSync("api/_lib/openai-research-factcheck.ts", "utf8");
const qa = fs.readFileSync("api/_lib/openai-editorial-qa.ts", "utf8");

assert.equal(AI_CONTENT_TEXT_CAPABILITY, "ai.content.generate_text");
assert.match(meter, /quantity:\s*1/);
assert.match(meter, /reserveUsage/);
assert.match(meter, /commitUsage/);
assert.match(meter, /releaseUsage/);
assert.match(meter, /technical_usage_outbox/);
assert.match(meter, /PENDING_RECONCILIATION/);

for (const source of [manual, worker, autopilot]) {
  assert.match(source, /TextGenerationMetering/);
  assert.match(source, /AI_BUDGET_EXCEEDED|AUTOPILOT_TEXT_BUDGET_REACHED/);
}
assert.ok(manual.indexOf("meter.reserve") < manual.indexOf("generateSocialText"), "manual provider callable before entitlement reserve");
assert.ok(worker.indexOf("meter.reserve") < worker.indexOf("generateSocialText"), "worker provider callable before entitlement reserve");
assert.ok(autopilot.indexOf("meter.reserve") < autopilot.indexOf("generateSocialText"), "autopilot provider callable before entitlement reserve");
assert.match(manual, /OPENAI_TEXT_MONTHLY_BUDGET_USD/);
assert.match(worker, /OPENAI_TEXT_MONTHLY_BUDGET_USD/);
assert.match(autopilot, /OPENAI_TEXT_MONTHLY_BUDGET_USD/);
assert.match(manual, /x-post-automatici-operation-id/);
assert.match(worker, /x-post-automatici-operation-id/);
assert.match(autopilot, /autopilot:\$\{profile\.id\}:\$\{provider\}:\$\{scheduledAt\}/);
assert.doesNotMatch(research, /TextGenerationMetering|reserveUsage\(/);
assert.doesNotMatch(qa, /TextGenerationMetering|reserveUsage\(/);
assert.doesNotMatch(manual, /limitValue\s*:\s*req\.body|remaining\s*:\s*req\.body/);
assert.doesNotMatch(worker, /limitValue\s*:\s*body|remaining\s*:\s*body/);

const keyA = await deriveTextGenerationOperationKey({
  profileId: "11111111-1111-1111-1111-111111111111",
  source: "MANUAL",
  operationIdentity: "request-000000000001",
  requestFingerprint: { topic: "A", providers: ["INSTAGRAM"] },
});
const keyARepeat = await deriveTextGenerationOperationKey({
  profileId: "11111111-1111-1111-1111-111111111111",
  source: "MANUAL",
  operationIdentity: "request-000000000001",
  requestFingerprint: { providers: ["INSTAGRAM"], topic: "A" },
});
const keyB = await deriveTextGenerationOperationKey({
  profileId: "22222222-2222-2222-2222-222222222222",
  source: "MANUAL",
  operationIdentity: "request-000000000001",
  requestFingerprint: { topic: "A", providers: ["INSTAGRAM"] },
});
assert.equal(keyA, keyARepeat, "same logical request must be stable");
assert.notEqual(keyA, keyB, "operation identity must remain profile isolated");

const seen: Array<{ text: string; values: unknown[] }> = [];
const fakeSql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  seen.push({ text: strings.join("?"), values });
  const profileId = String(values[0] ?? "");
  return [{ spend: profileId.startsWith("1111") ? 1.25 : 2.5 }];
}) as any;
const spendA = await currentSpend(fakeSql, "11111111-1111-1111-1111-111111111111");
const spendB = await currentSpend(fakeSql, "22222222-2222-2222-2222-222222222222");
assert.equal(spendA, 1.25);
assert.equal(spendB, 2.5);
assert.equal(seen.length, 2);
for (const call of seen) {
  assert.match(call.text, /where profile_id=\?::uuid/);
  assert.match(call.text, /AGENT_RESEARCH/);
  assert.match(call.text, /AGENT_FACTCHECK/);
  assert.match(call.text, /AGENT_EDITORIAL_QA/);
}
assert.equal(seen[0].values[0], "11111111-1111-1111-1111-111111111111");
assert.equal(seen[1].values[0], "22222222-2222-2222-2222-222222222222");

console.log("AI content text gating regression: PASS");
