import assert from "node:assert/strict";
import { MODEL_REGISTRY, providerReadiness, routeAiTask } from "../api/_lib/model-router.js";

const normalBudget = { band: "NORMAL" as const, forecastExceedsTarget: false, forecastRisksHardCap: false };
const reserveBudget = { band: "RESERVE" as const, forecastExceedsTarget: true, forecastRisksHardCap: false };

assert.equal(MODEL_REGISTRY.OPENAI_IMAGE_2.apiModelId, "gpt-image-2");
assert.equal(MODEL_REGISTRY.OPENAI_TEXT_TERRA.apiModelId, "gpt-5.6-terra");
assert.equal(MODEL_REGISTRY.GPT6_LUNA.status, "BLOCKED_PROVIDER");
assert.equal(MODEL_REGISTRY.GPT6_SOL.status, "BLOCKED_PROVIDER");
assert.equal(MODEL_REGISTRY.GPT6_ASTRA.status, "BLOCKED_PROVIDER");

assert.equal(routeAiTask({
  task: "IMAGE_STANDARD",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test" },
}).model?.apiModelId, "gpt-image-2");

assert.equal(routeAiTask({
  task: "IMAGE_PREMIUM",
  importance: "STANDARD",
  budget: reserveBudget,
  env: { OPENAI_API_KEY: "test" },
}).model?.apiModelId, "gpt-image-2", "reserve mode must preserve the only approved image provider");

assert.equal(routeAiTask({
  task: "IMAGE_PREMIUM",
  importance: "PREMIUM",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test" },
}).model?.apiModelId, "gpt-image-2");

assert.equal(routeAiTask({
  task: "IMAGE_STANDARD",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test" },
  reusableAssetAvailable: true,
}).status, "REUSE_ASSET");

assert.equal(routeAiTask({
  task: "COPY_DRAFT",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test" },
}).model?.apiModelId, "gpt-5.6-terra");

assert.equal(routeAiTask({
  task: "RESEARCH",
  budget: normalBudget,
  env: { OPENAI_API_KEY: "test" },
}).model?.apiModelId, "gpt-5.6-terra");

const readiness = providerReadiness({});
assert.ok(readiness.every((row) => row.provider === "OPENAI"));
assert.ok(readiness.some((row) => row.key === "OPENAI_IMAGE_2" && row.runtimeStatus === "BLOCKED_PROVIDER"));

console.log("OpenAI-only model router: PASS");
