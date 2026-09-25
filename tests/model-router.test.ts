import assert from "node:assert/strict";
import { MODEL_REGISTRY, providerReadiness, routeAiTask } from "../api/_lib/model-router.js";

const normalBudget = { band: "NORMAL" as const, forecastExceedsTarget: false, forecastRisksHardCap: false };
const reserveBudget = { band: "RESERVE" as const, forecastExceedsTarget: true, forecastRisksHardCap: false };

assert.equal(MODEL_REGISTRY.GEMINI_FLASH_IMAGE.apiModelId, "gemini-3.1-flash-image");
assert.equal(MODEL_REGISTRY.GEMINI_PRO_IMAGE.apiModelId, "gemini-3-pro-image");
assert.equal(MODEL_REGISTRY.GEMINI_GROUNDING.apiModelId, "gemini-3.8-flash");
assert.equal(MODEL_REGISTRY.GPT6_LUNA.apiModelId, "gpt-6-luna");
assert.equal(MODEL_REGISTRY.GPT6_SOL.apiModelId, "gpt-6-sol");
assert.equal(MODEL_REGISTRY.GPT6_ASTRA.apiModelId, "gpt-6-astra");
assert.equal(MODEL_REGISTRY.GPT_IMAGE_SUNBURST.apiModelId, "gpt-image-2.5-sunburst");
assert.equal(MODEL_REGISTRY.GPT6_LUNA.status, "READY");
assert.equal(MODEL_REGISTRY.GPT6_SOL.status, "READY");
assert.equal(MODEL_REGISTRY.GPT6_ASTRA.status, "READY");
assert.equal(MODEL_REGISTRY.GPT_IMAGE_SUNBURST.status, "READY");

assert.equal(routeAiTask({
  task: "IMAGE_STANDARD",
  budget: normalBudget,
  env: { GEMINI_API_KEY: "test" },
}).model?.apiModelId, "gemini-3.1-flash-image");

assert.equal(routeAiTask({
  task: "IMAGE_PREMIUM",
  importance: "STANDARD",
  budget: reserveBudget,
  env: { GEMINI_API_KEY: "test" },
}).model?.apiModelId, "gemini-3.1-flash-image", "reserve mode must avoid unnecessary Pro");

assert.equal(routeAiTask({
  task: "IMAGE_PREMIUM",
  importance: "PREMIUM",
  budget: normalBudget,
  env: { GEMINI_API_KEY: "test" },
}).model?.apiModelId, "gemini-3-pro-image");

assert.equal(routeAiTask({
  task: "IMAGE_STANDARD",
  budget: normalBudget,
  env: { GEMINI_API_KEY: "test" },
  reusableAssetAvailable: true,
}).status, "REUSE_ASSET");

assert.equal(routeAiTask({
  task: "COPY_DRAFT",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test" },
}).model?.apiModelId, "gpt-6-luna", "standard volume copy must route to Luna");

assert.equal(routeAiTask({
  task: "RESEARCH",
  budget: normalBudget,
  env: { GEMINI_API_KEY: "test" },
}).model?.apiModelId, "gemini-3.8-flash");

assert.equal(routeAiTask({
  task: "COPY_FINAL",
  importance: "IMPORTANT",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test" },
}).model?.apiModelId, "gpt-6-sol");

assert.equal(routeAiTask({
  task: "STRATEGY_COMPLEX",
  importance: "CRITICAL",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test" },
}).model?.apiModelId, "gpt-6-astra");

assert.equal(routeAiTask({
  task: "IMAGE_PREMIUM",
  importance: "CRITICAL",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test", GEMINI_API_KEY: "test" },
  difficultPhotoEditing: true,
}).model?.apiModelId, "gpt-image-2.5-sunburst");

const readiness = providerReadiness({});
assert.ok(readiness.some((row) => row.key === "GEMINI_FLASH_IMAGE" && row.runtimeStatus === "BLOCKED_PROVIDER"));

console.log("Multi-provider model router: PASS");
