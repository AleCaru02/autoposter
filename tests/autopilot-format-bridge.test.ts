import assert from "node:assert/strict";
import { test } from "node:test";
import { planAutopilotFormats } from "../api/_lib/autopilot-format-bridge.js";

const costs = { REEL: 8, POST: 0.5, CAROUSEL: 1.5 };

test("planning never exceeds budget or publication limit", () => {
  for (const budget of [0, 1, 5, 30, 100]) {
    const result = planAutopilotFormats({ monthlyBudgetEur: budget, unitCostEur: costs, maxPublications: 30 });
    assert.ok(result.formats.length <= 30);
    assert.equal(result.formats.length, result.decision.total);
    const total = result.formats.reduce((sum, format) => sum + costs[format], 0);
    assert.ok(total <= budget + 0.000001);
    assert.equal(result.readyToPublish, false);
  }
});

test("autopublish authorization never bypasses publication checks", () => {
  const result = planAutopilotFormats({ monthlyBudgetEur: 30, unitCostEur: costs, maxPublications: 10, autopublishAuthorized: true });
  assert.equal(result.readyToPublish, false);
});

test("rejects invalid cost and budget input", () => {
  assert.throws(() => planAutopilotFormats({ monthlyBudgetEur: -1, unitCostEur: costs, maxPublications: 10 }));
});
