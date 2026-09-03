import assert from "node:assert/strict";
import {
  CAPABILITY_REGISTRY,
  capabilityCanBeCommerciallyAssigned,
  capabilityOrNull,
  isCapabilityKey,
} from "../api/_lib/capabilities.js";
import {
  defaultEntitlementFor,
  periodBounds,
  requireCommercialAssignableCapability,
  resolveEntitlement,
  usageAllowed,
  type EntitlementRow,
} from "../api/_lib/entitlement-usage.js";

function test(name: string, run: () => void) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

test("registry keys are unique and machine-readable", () => {
  const keys = Object.keys(CAPABILITY_REGISTRY);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((key) => /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(key)));
  assert.ok(isCapabilityKey("ai.content.generate_text"));
  assert.equal(isCapabilityKey("ai.fake.unknown"), false);
});

test("unknown capability fails closed", () => {
  assert.equal(capabilityOrNull("unknown.capability"), null);
  assert.equal(resolveEntitlement("unknown.capability", null), null);
});

test("CORE_ALL_PLANS resolves enabled without a stored row", () => {
  const entitlement = defaultEntitlementFor("auth.session.manage");
  assert.equal(entitlement?.enabled, true);
  assert.equal(entitlement?.source, "CORE_DEFAULT");
});

test("PLAN_GATED and USAGE_LIMITED fail closed when missing", () => {
  assert.equal(defaultEntitlementFor("autopilot.manage")?.enabled, false);
  assert.equal(defaultEntitlementFor("ai.image.generate")?.enabled, false);
});

test("NOT_READY cannot be commercially assigned", () => {
  assert.equal(capabilityCanBeCommerciallyAssigned("analytics.sync"), false);
  assert.throws(() => requireCommercialAssignableCapability("analytics.sync"), /CAPABILITY_NOT_READY/);
});

test("ADMIN_ONLY and INTERNAL do not become customer entitlements", () => {
  assert.equal(defaultEntitlementFor("admin.audit.read")?.enabled, false);
  assert.equal(defaultEntitlementFor("usage.ai.ledger")?.enabled, false);
  assert.throws(() => requireCommercialAssignableCapability("admin.audit.read"), /CAPABILITY_ADMIN_ONLY/);
  assert.throws(() => requireCommercialAssignableCapability("usage.ai.ledger"), /CAPABILITY_INTERNAL/);
});

test("explicit gated entitlement resolves independently of plan names", () => {
  const row: EntitlementRow = {
    profile_id: "00000000-0000-0000-0000-000000000001",
    capability_key: "autopilot.manage",
    enabled: true,
    limit_type: "BOOLEAN",
    limit_value: null,
    period_type: "NONE",
    source: "INTERNAL_BASELINE",
    starts_at: null,
    ends_at: null,
  };
  const entitlement = resolveEntitlement("autopilot.manage", row);
  assert.equal(entitlement?.enabled, true);
  assert.equal(entitlement?.source, "INTERNAL_BASELINE");
});

test("limited and unlimited usage are evaluated correctly", () => {
  const limitedRow: EntitlementRow = {
    profile_id: "00000000-0000-0000-0000-000000000001",
    capability_key: "ai.image.generate",
    enabled: true,
    limit_type: "COUNT_PER_MONTH",
    limit_value: 20,
    period_type: "MONTH",
    source: "TEST",
    starts_at: null,
    ends_at: null,
  };
  const limited = resolveEntitlement("ai.image.generate", limitedRow)!;
  assert.equal(usageAllowed(limited, 19, 1), true);
  assert.equal(usageAllowed(limited, 20, 1), false);

  const unlimited = resolveEntitlement("ai.image.generate", { ...limitedRow, limit_type: "UNLIMITED", limit_value: null, period_type: "NONE" })!;
  assert.equal(usageAllowed(unlimited, 1_000_000, 500), true);
});

test("periods use deterministic UTC boundaries", () => {
  const now = new Date("2026-09-03T23:45:12+02:00");
  assert.deepEqual(periodBounds("DAY", now), {
    start: "2026-09-03T00:00:00.000Z",
    end: "2026-09-04T00:00:00.000Z",
  });
  assert.deepEqual(periodBounds("MONTH", now), {
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-10-01T00:00:00.000Z",
  });
});

test("expired overrides fail closed", () => {
  const row: EntitlementRow = {
    profile_id: "00000000-0000-0000-0000-000000000001",
    capability_key: "autopilot.manage",
    enabled: true,
    limit_type: "BOOLEAN",
    limit_value: null,
    period_type: "NONE",
    source: "TEST",
    starts_at: "2026-01-01T00:00:00.000Z",
    ends_at: "2026-02-01T00:00:00.000Z",
  };
  assert.equal(resolveEntitlement("autopilot.manage", row, new Date("2026-09-03T00:00:00.000Z"))?.enabled, false);
});
