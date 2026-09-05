import {
  CAPABILITY_REGISTRY,
  capabilityCanBeCommerciallyAssigned,
  type CapabilityKey,
  type CapabilityLimitType,
} from "./capabilities.js";

export type PackageCapability = {
  capabilityKey: CapabilityKey;
  enabled: boolean;
  limitType: CapabilityLimitType;
  limitValue: number | null;
  periodType: "NONE" | "DAY" | "MONTH";
  providerAttemptReserveUsd: number | null;
};

export type EntitlementPackage = {
  key: string;
  version: number;
  lifecycle: "DRAFT" | "ACTIVE" | "RETIRED";
  hardMonthlyProviderCostCapUsd: number;
  capabilities: readonly PackageCapability[];
};

const commerciallyAssignableKeys = Object.keys(CAPABILITY_REGISTRY)
  .filter((key): key is CapabilityKey => capabilityCanBeCommerciallyAssigned(key as CapabilityKey));

const enabledCommercialCapabilities: Partial<Record<CapabilityKey, Omit<PackageCapability, "capabilityKey" | "enabled">>> = {
  "brand.analyze": { limitType: "COUNT_PER_MONTH", limitValue: 2, periodType: "MONTH", providerAttemptReserveUsd: 0.5 },
  "ai.content.generate_text": { limitType: "COUNT_PER_MONTH", limitValue: 30, periodType: "MONTH", providerAttemptReserveUsd: 1 },
  "ai.strategy.generate": { limitType: "COUNT_PER_MONTH", limitValue: 3, periodType: "MONTH", providerAttemptReserveUsd: 0.75 },
  "ai.image.generate": { limitType: "COUNT_PER_MONTH", limitValue: 20, periodType: "MONTH", providerAttemptReserveUsd: 0.5 },
};

export const COMMERCIAL_GUARDED_V1: EntitlementPackage = {
  key: "commercial_guarded",
  version: 1,
  lifecycle: "DRAFT",
  hardMonthlyProviderCostCapUsd: 5,
  capabilities: commerciallyAssignableKeys.map((capabilityKey) => {
    const enabled = enabledCommercialCapabilities[capabilityKey];
    return enabled
      ? { capabilityKey, enabled: true, ...enabled }
      : {
          capabilityKey,
          enabled: false,
          limitType: CAPABILITY_REGISTRY[capabilityKey].limitType,
          limitValue: null,
          periodType: "NONE" as const,
          providerAttemptReserveUsd: null,
        };
  }),
};

export function validateEntitlementPackage(candidate: EntitlementPackage) {
  if (!candidate.key || !Number.isInteger(candidate.version) || candidate.version < 1) throw new Error("PACKAGE_ID_INVALID");
  if (!Number.isFinite(candidate.hardMonthlyProviderCostCapUsd) || candidate.hardMonthlyProviderCostCapUsd <= 0) {
    throw new Error("PACKAGE_PROVIDER_CAP_INVALID");
  }
  const keys = candidate.capabilities.map((entry) => entry.capabilityKey);
  if (new Set(keys).size !== keys.length) throw new Error("PACKAGE_CAPABILITY_DUPLICATE");
  if (keys.length !== commerciallyAssignableKeys.length || commerciallyAssignableKeys.some((key) => !keys.includes(key))) {
    throw new Error("PACKAGE_CAPABILITY_COVERAGE_INCOMPLETE");
  }
  for (const entry of candidate.capabilities) {
    if (!capabilityCanBeCommerciallyAssigned(entry.capabilityKey)) throw new Error("PACKAGE_CAPABILITY_NOT_ASSIGNABLE");
    if (!entry.enabled) {
      if (entry.limitValue !== null || entry.providerAttemptReserveUsd !== null) throw new Error("DISABLED_CAPABILITY_HAS_ALLOWANCE");
      continue;
    }
    if (!Number.isFinite(entry.limitValue) || (entry.limitValue ?? 0) <= 0) throw new Error("PACKAGE_LIMIT_INVALID");
    if (entry.limitType === "UNLIMITED" || entry.periodType === "NONE") throw new Error("PACKAGE_LIMIT_NOT_FINITE");
    if (!Number.isFinite(entry.providerAttemptReserveUsd) || (entry.providerAttemptReserveUsd ?? 0) <= 0) {
      throw new Error("PACKAGE_PROVIDER_RESERVE_INVALID");
    }
    if ((entry.providerAttemptReserveUsd ?? 0) > candidate.hardMonthlyProviderCostCapUsd) {
      throw new Error("PACKAGE_PROVIDER_RESERVE_EXCEEDS_CAP");
    }
  }
  return candidate;
}

validateEntitlementPackage(COMMERCIAL_GUARDED_V1);
