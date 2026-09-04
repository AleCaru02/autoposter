import assert from "node:assert/strict";

export const scenarios = [
  "capability-disabled",
  "limit-zero",
  "legacy-budget-denial",
  "first-generation",
  "second-over-limit",
  "research-no-double-count",
  "factcheck-no-double-count",
  "editorial-qa-no-double-count",
  "profile-a-b-isolation",
  "manual-autopilot-shared-quota",
  "provider-failure-release",
  "metering-persistence-failure",
  "duplicate-committed",
  "duplicate-reserved",
  "concurrent-distinct",
  "concurrent-duplicate",
  "autopilot-retry",
  "cleanup",
];

assert.equal(process.env.AI_TEXT_RUNTIME_VERIFIER_READY, "true", "RUNTIME_VERIFIER_NOT_CERTIFIED");
throw new Error("RUNTIME_VERIFIER_NOT_CERTIFIED");
