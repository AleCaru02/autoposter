import assert from "node:assert/strict";
import fs from "node:fs";
import { AI_IMAGE_GENERATE_CAPABILITY, IMAGE_TECHNICAL_OPERATIONS, deriveImageGenerationOperationKey } from "../api/_lib/image-generation-metering.js";

const manual = fs.readFileSync("api/generate-image.ts", "utf8");
const worker = fs.readFileSync("cloudflare/worker.ts", "utf8");
const autopilot = fs.readFileSync("api/_lib/autopilot.ts", "utf8");
const meter = fs.readFileSync("api/_lib/image-generation-metering.ts", "utf8");
const image = fs.readFileSync("api/_lib/openai-image.ts", "utf8");
const ui = fs.readFileSync("src/pages/approvals-page.tsx", "utf8");

assert.equal(AI_IMAGE_GENERATE_CAPABILITY, "ai.image.generate");
assert.deepEqual(IMAGE_TECHNICAL_OPERATIONS, ["AGENT_MEDIA_MANAGER", "GENERATE_SOCIAL_IMAGE"]);
for (const source of [manual, worker, autopilot]) {
  assert.match(source, /ImageGenerationMetering/);
  const reserveAt = source.indexOf("imageMeter.reserve") >= 0 ? source.indexOf("imageMeter.reserve") : source.indexOf("meter.reserve");
  assert.ok(reserveAt >= 0 && reserveAt < source.indexOf("await generateOpenAIImage"), "image provider callable before entitlement reserve");
  assert.match(source, /persistTechnicalEvents/);
  assert.match(source, /meter\.release|imageMeter\.release/);
}
for (const source of [manual, worker]) {
  assert.match(source, /x-post-automatici-operation-id/i);
  assert.match(source, /reservation\.status === "DENIED"/);
  assert.match(source, /IMAGE_GENERATION_IN_PROGRESS/);
  assert.doesNotMatch(source, /body.*limitValue|body.*remaining/);
}
assert.match(autopilot, /source:"AUTOPILOT"/);
assert.match(autopilot, /autopilot:\$\{profile\.id\}:\$\{provider\}:\$\{scheduledAt\}:\$\{variantId\}/);
assert.match(autopilot, /currentImageCount\(sql,profile\.id\)/);
assert.match(autopilot, /where profile_id=\$\{profileId\}::uuid and created_at/);
assert.doesNotMatch(autopilot, /insert into public\.ai_usage_events/);
for (const source of [manual, worker]) assert.match(source, /ai_usage_events\?profile_id=eq\.\$\{encodeURIComponent\(profileId\)\}/);
assert.match(meter, /quantity:\s*1/);
assert.match(meter, /CAPABILITY_DISABLED/);
assert.match(meter, /CAPABILITY_LIMIT_REACHED/);
assert.match(meter, /technical_usage_outbox/);
assert.match(meter, /PENDING_RECONCILIATION/);
assert.match(meter, /logical_usage_event_id/);
assert.match(meter, /where not exists/);
assert.match(image, /OpenAIImagePipelineError/);
assert.match(image, /technicalEvents: \[mediaManagerEvent, imageEvent\]/);
assert.match(ui, /x-post-automatici-operation-id/);

const request = { source: "MANUAL" as const, operationIdentity: "request-000000000001", requestFingerprint: { provider: "INSTAGRAM", format: "POST", visualBrief: "A" } };
const keyA = await deriveImageGenerationOperationKey({ profileId: "11111111-1111-4111-8111-111111111111", ...request });
const keyARepeat = await deriveImageGenerationOperationKey({ profileId: "11111111-1111-4111-8111-111111111111", ...request, requestFingerprint: { visualBrief: "A", format: "POST", provider: "INSTAGRAM" } });
const keyB = await deriveImageGenerationOperationKey({ profileId: "22222222-2222-4222-8222-222222222222", ...request });
assert.equal(keyA, keyARepeat);
assert.notEqual(keyA, keyB, "image operation identity must remain tenant isolated");

console.log("AI image generation server-side gating regression: PASS");
