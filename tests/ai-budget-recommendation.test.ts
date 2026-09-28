import assert from "node:assert/strict";
import { calculateAiBudgetRecommendation } from "../api/_lib/ai-budget-recommendation.js";

const estimated = calculateAiBudgetRecommendation({
  profileId: "00000000-0000-0000-0000-000000000001",
  schedules: [
    { provider: "INSTAGRAM", posts_per_week: 3, enabled: true },
    { provider: "FACEBOOK", posts_per_week: 2, enabled: true },
    { provider: "LINKEDIN", posts_per_week: 1, enabled: true },
  ],
  platformStrategy: {
    aiEconomics: { strategyRefreshDays: 30 },
    aiEditorialPlan: {
      items: [
        { dayOffset: 0, provider: "INSTAGRAM", contentType: "CAROUSEL" },
        { dayOffset: 2, provider: "FACEBOOK", contentType: "SINGLE_POST" },
        { dayOffset: 4, provider: "LINKEDIN", contentType: "SINGLE_POST" },
        { dayOffset: 6, provider: "INSTAGRAM", contentType: "SINGLE_STORY" },
      ],
    },
  },
  history: [],
  reserves: [
    { capability_key: "ai.content.generate_text", reserve_usd: 1, fx_rate: 0.9 },
    { capability_key: "ai.image.generate", reserve_usd: 0.5, fx_rate: 0.9 },
    { capability_key: "ai.strategy.generate", reserve_usd: 0.75, fx_rate: 0.9 },
  ],
  usageMix: null,
  assetMix: null,
});
assert.equal(estimated.mode, "ESTIMATED");
assert.equal(estimated.activeSocials, 3);
assert.ok(estimated.monthlyChannelSlots > 20);
assert.ok(estimated.plannedImageOperations > 0);
assert.ok(estimated.minimumOperationalEur < estimated.recommendedEur);
assert.ok(estimated.intensiveEur > estimated.recommendedEur);
assert.ok(estimated.breakdown.copyAdaptationsEur > 0);
assert.ok(estimated.explanation.includes("3 social"));

const driven = calculateAiBudgetRecommendation({
  profileId: "00000000-0000-0000-0000-000000000001",
  schedules: [{ provider: "INSTAGRAM", posts_per_week: 2, enabled: true }],
  platformStrategy: { aiEconomics: { strategyRefreshDays: 15 }, aiEditorialPlan: { items: [] } },
  history: [
    { capability_key: "ai.content.generate_text", samples: 12, avg_eur: 0.22 },
    { capability_key: "ai.image.generate", samples: 8, avg_eur: 0.18 },
    { capability_key: "ai.strategy.generate", samples: 6, avg_eur: 0.31 },
  ],
  reserves: [
    { capability_key: "ai.content.generate_text", reserve_usd: 1, fx_rate: 1 },
    { capability_key: "ai.image.generate", reserve_usd: 0.5, fx_rate: 1 },
    { capability_key: "ai.strategy.generate", reserve_usd: 0.75, fx_rate: 1 },
  ],
  usageMix: { text_attempts: 12, image_attempts: 6 },
  assetMix: { total_images: 10, ai_images: 4 },
});
assert.equal(driven.mode, "DATA_DRIVEN");
assert.equal(driven.costBasis.find((row) => row.capability === "ai.content.generate_text")?.source, "HISTORICAL");
assert.ok(driven.plannedImageOperations > 0);
assert.ok(driven.recommendedEur > 0);
assert.ok(driven.assumptions.some((item) => item.includes("Research/fact-check")));

console.log("AI budget recommendation: PASS");
