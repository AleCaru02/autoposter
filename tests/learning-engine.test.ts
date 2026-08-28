import assert from "node:assert/strict";
import { buildLearningInsights, scorePerformanceSample, type PerformanceSample } from "../api/_lib/learning-engine.js";

const profileA = "00000000-0000-4000-8000-000000000001";
const profileB = "00000000-0000-4000-8000-000000000002";

assert.deepEqual(scorePerformanceSample({ profileId: profileA, provider: "INSTAGRAM", format: "POST", topic: "Tema", publishedAt: "2026-08-01T10:00:00Z", metrics: { engagement_rate: 4.5 } }), { score: 0.045, basis: "ENGAGEMENT_RATE" });
assert.equal(scorePerformanceSample({ profileId: profileA, provider: "INSTAGRAM", format: "POST", topic: "Tema", publishedAt: "2026-08-01T10:00:00Z", metrics: { likes: 10 } }), null, "raw reactions without exposure must not become a comparable performance score");

const samples: PerformanceSample[] = [];
for (let index = 0; index < 12; index += 1) {
  const strong = index < 6;
  samples.push({
    profileId: profileA,
    provider: strong ? "INSTAGRAM" : "FACEBOOK",
    format: strong ? "CAROUSEL" : "POST",
    topic: strong ? "Gestione operativa" : "Normativa locale",
    publishedAt: new Date(Date.UTC(2026, 7, 3 + index, strong ? 16 : 9, 0, 0)).toISOString(),
    metrics: strong
      ? { reach: 1000, likes: 80, comments: 10, shares: 8, saves: 12, link_clicks: 20 }
      : { reach: 1000, likes: 12, comments: 2, shares: 1, saves: 1, link_clicks: 4 },
  });
}

samples.push({
  profileId: profileB,
  provider: "LINKEDIN",
  format: "POST",
  topic: "ALTRO PROFILO",
  publishedAt: "2026-08-10T08:00:00Z",
  metrics: { engagement_rate: 0.9 },
});

const result = buildLearningInsights(profileA, samples, { minTotalSamples: 6, minSegmentSamples: 3, minUplift: 0.15, timezone: "Europe/Rome" });
assert.equal(result.profileSamples, 12);
assert.equal(result.scorableSamples, 12);
assert.equal(result.ignoredOtherProfiles, 1, "samples from another activity must never influence this profile");
assert.equal(result.status, "READY");
assert.ok(result.insights.some((insight) => insight.dimension === "PROVIDER" && insight.value === "INSTAGRAM"));
assert.ok(result.insights.some((insight) => insight.dimension === "FORMAT" && insight.value === "CAROUSEL"));
assert.ok(result.insights.some((insight) => insight.dimension === "TOPIC" && insight.value === "Gestione operativa"));
assert.equal(result.insights.some((insight) => insight.value === "ALTRO PROFILO"), false);
assert.ok(result.insights.every((insight) => insight.sampleSize >= 3));
assert.ok(result.insights.every((insight) => insight.upliftPct >= 15));

const insufficient = buildLearningInsights(profileA, samples.slice(0, 4), { minTotalSamples: 6 });
assert.equal(insufficient.status, "INSUFFICIENT_DATA");
assert.deepEqual(insufficient.insights, [], "the engine must not invent recommendations from too little evidence");

const flat: PerformanceSample[] = Array.from({ length: 8 }, (_, index) => ({
  profileId: profileA,
  provider: index % 2 ? "INSTAGRAM" : "FACEBOOK",
  format: index % 2 ? "POST" : "CAROUSEL",
  topic: index % 2 ? "A" : "B",
  publishedAt: new Date(Date.UTC(2026, 7, 1 + index, 10, 0, 0)).toISOString(),
  metrics: { engagement_rate: 0.04 },
}));
const flatResult = buildLearningInsights(profileA, flat, { minTotalSamples: 6, minSegmentSamples: 3 });
assert.equal(flatResult.status, "INSUFFICIENT_DATA");
assert.equal(flatResult.insights.length, 0, "equal performance must not be turned into fake optimization advice");

console.log("PASS learning engine: profile isolation, comparable scoring, minimum evidence, uplift threshold and no-data fail-closed behavior verified.");