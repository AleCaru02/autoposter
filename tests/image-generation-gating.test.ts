import assert from "node:assert/strict";
import fs from "node:fs";
import { AI_IMAGE_GENERATE_CAPABILITY, IMAGE_TECHNICAL_OPERATIONS, deriveImageGenerationOperationKey } from "../api/_lib/image-generation-metering.js";

const manual = fs.readFileSync("api/generate-image.ts", "utf8");
const worker = fs.readFileSync("cloudflare/generate-image.ts", "utf8");
const autopilot = fs.readFileSync("api/_lib/autopilot.ts", "utf8");
const meter = fs.readFileSync("api/_lib/image-generation-metering.ts", "utf8");
const gemini = fs.readFileSync("api/_lib/gemini-image.ts", "utf8");
const router = fs.readFileSync("api/_lib/model-router.ts", "utf8");
const assetIntelligence = fs.readFileSync("api/_lib/asset-intelligence.ts", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
const ui = fs.readFileSync("src/pages/approvals-page.tsx", "utf8");

assert.equal(AI_IMAGE_GENERATE_CAPABILITY, "ai.image.generate");
assert.ok(IMAGE_TECHNICAL_OPERATIONS.includes("GENERATE_SOCIAL_IMAGE"));

for (const source of [manual, worker, autopilot]) {
  assert.match(source, /ImageGenerationMetering/);
  const reserveAt = source.indexOf("imageMeter.reserve") >= 0 ? source.indexOf("imageMeter.reserve") : source.indexOf("meter.reserve");
  assert.ok(reserveAt >= 0 && reserveAt < source.indexOf("await generateGeminiImage"), "Gemini image provider callable before entitlement reserve");
  assert.match(source, /persistTechnicalEvents/);
  assert.match(source, /(?:activeMeter|meter|imageMeter)\.release/, "reserved image usage must be released on provider/persistence failure");
  assert.match(source, /routeAiTask/);
  assert.match(source, /visualFingerprint/);
  assert.match(source, /findReusableAsset/, "asset reuse must be checked before a new image call");
  assert.doesNotMatch(source, /generateOpenAIImage/, "daily/premium visual runtime must not silently fall back to OpenAI image generation");
}
for (const source of [manual, worker]) {
  assert.match(source, /x-post-automatici-operation-id/i);
  assert.match(source, /reservation\.status === "DENIED"/);
  assert.match(source, /IMAGE_GENERATION_IN_PROGRESS/);
  assert.match(source, /BLOCKED_PROVIDER/);
  assert.match(source, /AI_BUDGET_HARD_STOP/);
  assert.doesNotMatch(source, /OPENAI_IMAGE_MONTHLY_LIMIT_REACHED/, "legacy image-count quota must not override per-activity budget routing");
  assert.doesNotMatch(source, /body.*limitValue|body.*remaining/);
}
assert.ok(entry.indexOf('path === "/api/generate-image"') < entry.indexOf("return worker.fetch(request, env)"), "canonical Worker entry must route Gemini image generation before the legacy worker fallback");
assert.match(autopilot, /source:"AUTOPILOT"/);
assert.match(autopilot, /GEMINI_3_1_FLASH_IMAGE/);
assert.match(autopilot, /GEMINI_3_PRO_IMAGE/);
assert.match(autopilot, /ActivityBudgetEngine/);
assert.doesNotMatch(autopilot, /OPENAI_IMAGE_MONTHLY_LIMIT/);
assert.doesNotMatch(autopilot, /insert into public\.ai_usage_events/);
assert.match(meter, /quantity:\s*1/);
assert.match(meter, /CAPABILITY_DISABLED/);
assert.match(meter, /CAPABILITY_LIMIT_REACHED/);
assert.match(meter, /technical_usage_outbox/);
assert.match(meter, /PENDING_RECONCILIATION/);
assert.match(meter, /logical_usage_event_id/);
assert.match(meter, /where not exists/);
assert.match(gemini, /gemini-3\.1-flash-image/);
assert.match(gemini, /gemini-3-pro-image/);
assert.match(gemini, /x-goog-api-key/);
assert.match(router, /REUSE_ASSET/);
assert.match(assetIntelligence, /visual_fingerprint/);
assert.match(ui, /x-post-automatici-operation-id/);

const request = { source: "MANUAL" as const, operationIdentity: "request-000000000001", requestFingerprint: { provider: "INSTAGRAM", format: "POST", visualBrief: "A" } };
const keyA = await deriveImageGenerationOperationKey({ profileId: "11111111-1111-4111-8111-111111111111", ...request });
const keyARepeat = await deriveImageGenerationOperationKey({ profileId: "11111111-1111-4111-8111-111111111111", ...request, requestFingerprint: { visualBrief: "A", format: "POST", provider: "INSTAGRAM" } });
const keyB = await deriveImageGenerationOperationKey({ profileId: "22222222-2222-4222-8222-222222222222", ...request });
assert.equal(keyA, keyARepeat);
assert.notEqual(keyA, keyB, "image operation identity must remain tenant isolated");

console.log("AI image generation multi-provider gating regression: PASS");
