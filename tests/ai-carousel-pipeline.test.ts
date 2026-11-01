import assert from "node:assert/strict";
import { generateAiCarousel } from "../api/_lib/ai-carousel-pipeline.js";
import type { OpenAIImageResult } from "../api/_lib/openai-image.js";

const scenes = [
  { headline: "Un problema concreto", visualBrief: "Una scena originale del problema" },
  { headline: "La soluzione", visualBrief: "Una scena originale della soluzione" },
];
const imageOptions = { apiKey: "unused-test-key", profileName: "Studio Demo", industry: "Web", tone: "Premium", provider: "INSTAGRAM" as const };
const calls: string[] = [];
const fakeImage = async (options: any) => {
  calls.push(options.visualBrief);
  assert.equal(options.format, "CAROUSEL");
  assert.equal(options.typography.brand, "Studio Demo");
  return { base64: "test", generationPrompt: options.visualBrief } as OpenAIImageResult;
};
const saved: number[] = [];
const result = await generateAiCarousel({
  scenes, imageOptions, budgetReservationId: "reserved",
  verifiedPricing: true,
  authorizeSlide: async (_id, index) => index < 2,
  saveSlide: async (index) => { saved.push(index); },
  settleSlideCost: async () => true,
  generateImage: fakeImage,
});
assert.equal(result.count, 2);
assert.deepEqual(saved, [0, 1]);
assert.match(calls[1], /2\/2/);

let blocked = false;
try {
  await generateAiCarousel({
    scenes, imageOptions, budgetReservationId: "reserved", verifiedPricing: false,
    authorizeSlide: async () => true, saveSlide: async () => {}, settleSlideCost: async () => true,
    generateImage: fakeImage,
  });
} catch (error) { blocked = String(error).includes("PRICING_UNVERIFIED"); }
assert.ok(blocked);
assert.equal(calls.length, 2, "No API request when pricing unverified");

const partial: number[] = [];
await assert.rejects(() => generateAiCarousel({
  scenes, imageOptions, budgetReservationId: "reserved", verifiedPricing: true,
  authorizeSlide: async (_id, index) => index === 0,
  saveSlide: async (index) => { partial.push(index); },
  settleSlideCost: async () => true,
  generateImage: fakeImage,
}), /BUDGET_DENIED/);
assert.deepEqual(partial, [0]);
assert.equal(calls.length, 3, "No second paid call when budget denied");
console.log("AI carousel pipeline tests passed");

const beforeSettlementFailure = calls.length;
await assert.rejects(() => generateAiCarousel({
  scenes, imageOptions, budgetReservationId: "reserved", verifiedPricing: true,
  authorizeSlide: async () => true,
  saveSlide: async () => {},
  settleSlideCost: async () => false,
  generateImage: fakeImage,
}), /COST_SETTLEMENT_FAILED/);
assert.equal(calls.length, beforeSettlementFailure + 1, "Stop after failed settlement; never bill second slide");
await assert.rejects(() => generateAiCarousel({
  scenes, imageOptions, budgetReservationId: "reserved", verifiedPricing: true,
  authorizeSlide: async () => true,
  saveSlide: async () => {},
  generateImage: fakeImage,
}), /COST_SETTLEMENT_REQUIRED/);
assert.equal(calls.length, beforeSettlementFailure + 1, "Missing settlement must not call provider");
