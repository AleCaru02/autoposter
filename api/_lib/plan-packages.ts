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


const enabledPersonalOperatorCapabilities: Record<CapabilityKey, Omit<PackageCapability, "capabilityKey" | "enabled">> = {
  "workspace.profile.manage": { limitType: "CONCURRENT", limitValue: 100, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "website.scan": { limitType: "COUNT_PER_MONTH", limitValue: 50, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "website.pages.persist": { limitType: "STORAGE", limitValue: 5000, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "brand.analyze": { limitType: "COUNT_PER_MONTH", limitValue: 20, periodType: "MONTH", providerAttemptReserveUsd: 0.25 },
  "ai.content.generate_text": { limitType: "COUNT_PER_MONTH", limitValue: 200, periodType: "MONTH", providerAttemptReserveUsd: 0.10 },
  "ai.research.web": { limitType: "COUNT_PER_MONTH", limitValue: 100, periodType: "MONTH", providerAttemptReserveUsd: 0.05 },
  "ai.research.factcheck": { limitType: "COUNT_PER_MONTH", limitValue: 100, periodType: "MONTH", providerAttemptReserveUsd: 0.05 },
  "ai.strategy.generate": { limitType: "COUNT_PER_MONTH", limitValue: 50, periodType: "MONTH", providerAttemptReserveUsd: 0.10 },
  "ai.image.generate": { limitType: "COUNT_PER_MONTH", limitValue: 100, periodType: "MONTH", providerAttemptReserveUsd: 0.25 },
  "media.image.persist": { limitType: "STORAGE", limitValue: 2000, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "content.approval.auto": { limitType: "BOOLEAN", limitValue: 1, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "autopilot.manage": { limitType: "BOOLEAN", limitValue: 1, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "autopilot.hourly": { limitType: "COUNT_PER_DAY", limitValue: 24, periodType: "DAY", providerAttemptReserveUsd: 0.01 },
  "schedule.job.create": { limitType: "COUNT_PER_MONTH", limitValue: 1000, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.facebook.connect": { limitType: "MAX_CONNECTED_ACCOUNTS", limitValue: 5, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.instagram.connect": { limitType: "MAX_CONNECTED_ACCOUNTS", limitValue: 5, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.linkedin.connect": { limitType: "MAX_CONNECTED_ACCOUNTS", limitValue: 5, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.gbp.connect": { limitType: "MAX_CONNECTED_ACCOUNTS", limitValue: 5, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.facebook.publish": { limitType: "COUNT_PER_MONTH", limitValue: 1000, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.instagram.publish": { limitType: "COUNT_PER_MONTH", limitValue: 1000, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.linkedin.publish": { limitType: "COUNT_PER_MONTH", limitValue: 1000, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.gbp.publish": { limitType: "COUNT_PER_MONTH", limitValue: 1000, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
  "social.publish.scheduled": { limitType: "BOOLEAN", limitValue: 1, periodType: "MONTH", providerAttemptReserveUsd: 0.01 },
};

export const PERSONAL_OPERATOR_V1: EntitlementPackage = {
  key: "personal_operator",
  version: 1,
  lifecycle: "ACTIVE",
  hardMonthlyProviderCostCapUsd: 5,
  capabilities: commerciallyAssignableKeys.map((capabilityKey) => ({
    capabilityKey,
    enabled: true,
    ...enabledPersonalOperatorCapabilities[capabilityKey],
  })),
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
validateEntitlementPackage(PERSONAL_OPERATOR_V1);
