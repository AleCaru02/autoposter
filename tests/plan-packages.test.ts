import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPABILITY_REGISTRY, capabilityCanBeCommerciallyAssigned } from "../api/_lib/capabilities.js";
import { COMMERCIAL_GUARDED_V1, validateEntitlementPackage } from "../api/_lib/plan-packages.js";

const packageDefinition = validateEntitlementPackage(COMMERCIAL_GUARDED_V1);
const assignable = Object.keys(CAPABILITY_REGISTRY).filter((key) => capabilityCanBeCommerciallyAssigned(key as keyof typeof CAPABILITY_REGISTRY));
assert.deepEqual(packageDefinition.capabilities.map((entry) => entry.capabilityKey), assignable);
assert.equal(packageDefinition.capabilities.some((entry) => entry.enabled && entry.limitType === "UNLIMITED"), false);
assert.equal(packageDefinition.capabilities.some((entry) => entry.enabled && entry.limitValue === null), false);
assert.equal(packageDefinition.hardMonthlyProviderCostCapUsd, 5);
assert.equal(packageDefinition.lifecycle, "DRAFT", "package must not be assignable before FASE 4F provider-budget certification");

const enabled = Object.fromEntries(packageDefinition.capabilities.filter((entry) => entry.enabled).map((entry) => [entry.capabilityKey, entry]));
assert.deepEqual(Object.keys(enabled), ["brand.analyze", "ai.content.generate_text", "ai.strategy.generate", "ai.image.generate"]);
assert.equal(enabled["ai.image.generate"]?.limitValue, 20);
assert.equal(enabled["ai.content.generate_text"]?.limitValue, 30);

const migration = readFileSync(new URL("../db/migrations/20260905_fase4e_plan_packaging.sql", import.meta.url), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.entitlement_packages/i);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.entitlement_package_capabilities/i);
assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.profile_entitlement_package_assignments/i);
assert.match(migration, /apply_entitlement_package[\s\S]+SECURITY DEFINER/i);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.apply_entitlement_package[\s\S]+authenticated/i);
assert.match(migration, /DROP TRIGGER IF EXISTS profile_entitlements_bootstrap_trigger/i);
assert.match(migration, /WHERE package_key=p_package_key AND version=p_package_version AND lifecycle='ACTIVE'/i);
for (const entry of packageDefinition.capabilities) {
  assert.match(migration, new RegExp(`'${entry.capabilityKey.replaceAll(".", "\\.")}'`), `SQL package missing ${entry.capabilityKey}`);
}

console.log("FASE 4E plan packaging regression: PASS");
