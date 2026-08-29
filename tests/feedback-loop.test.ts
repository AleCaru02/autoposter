import assert from "node:assert/strict";
import { buildFeedbackLoopRecords, snapshotsToPerformanceSamples, type MetricSnapshotRecord } from "../api/_lib/feedback-loop.js";

const profileId = "11111111-1111-1111-1111-111111111111";
const otherProfile = "22222222-2222-2222-2222-222222222222";

const rows: MetricSnapshotRecord[] = [];
for (let i = 0; i < 8; i += 1) {
  const strong = i < 4;
  rows.push({
    profile_id: profileId,
    provider: strong ? "INSTAGRAM" : "FACEBOOK",
    format: strong ? "CAROUSEL" : "POST",
    topic: strong ? "Case study" : "News",
    published_at: `2026-08-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`,
    captured_at: `2026-08-${String(11 + i).padStart(2, "0")}T10:00:00.000Z`,
    metrics: strong
      ? { reach: 1000, likes: 100, comments: 20, shares: 15, saves: 15 }
      : { reach: 1000, likes: 10, comments: 1, shares: 0, saves: 0 },
  });
}
rows.push({
  profile_id: otherProfile,
  provider: "INSTAGRAM",
  format: "CAROUSEL",
  topic: "Should never leak",
  published_at: "2026-08-20T10:00:00.000Z",
  captured_at: "2026-08-21T10:00:00.000Z",
  metrics: { reach: 10, likes: 10 },
});

const samples = snapshotsToPerformanceSamples(profileId, rows);
assert.equal(samples.length, 8);
assert.ok(samples.every((sample) => sample.profileId === profileId));

const output = buildFeedbackLoopRecords(profileId, rows, {
  timezone: "Europe/Rome",
  generatedAt: "2026-08-29T00:00:00.000Z",
});
assert.equal(output.result.profileId, profileId);
assert.equal(output.result.profileSamples, 8);
assert.equal(output.result.ignoredOtherProfiles, 0, "adapter must remove foreign-profile rows before the engine sees them");
assert.equal(output.result.status, "READY");
assert.ok(output.records.length > 0);
assert.ok(output.records.every((record) => record.profile_id === profileId));
assert.ok(output.records.every((record) => record.generated_at === "2026-08-29T00:00:00.000Z"));
assert.ok(output.records.some((record) => record.dimension === "PROVIDER" && record.dimension_value === "INSTAGRAM"));
assert.ok(output.records.some((record) => record.dimension === "FORMAT" && record.dimension_value === "CAROUSEL"));

assert.throws(() => buildFeedbackLoopRecords(profileId, rows, { generatedAt: "not-a-date" }), /INVALID_GENERATED_AT/);

console.log("PASS feedback loop: metric snapshots stay profile-scoped and generate persistence-ready evidence-based learning records.");
