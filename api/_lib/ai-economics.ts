export type ProfileAiEconomicsPolicy = {
  monthlyRevenueEur: number | null;
  targetVariableCostPct: number;
  warningVariableCostPct: number;
  hardVariableCostPct: number;
  monthlyAiBudgetUsd: number;
  monthlyImageLimit: number;
  maxGenerationsPerDay: number;
  maxGenerationsPerWeek: number;
  maxVariantsPerContent: number;
  strategyRefreshDays: number;
  planRefreshDays: number;
  generateImagesAfterApproval: boolean;
  webResearchOnlyWhenNeeded: boolean;
};

export type AiSpendSnapshot = { textUsd: number; imageUsd: number; otherUsd: number; images: number; generationsToday: number; generationsThisWeek: number };

export type ObservedAiCostSummary = {
  status: "NO_DATA" | "INCOMPLETE" | "COMPLETE";
  logicalUnits: number;
  technicalEvents: number;
  knownCostUsd: number;
  nullCostEvents: number;
  averageCostPerLogicalUnitUsd: number | null;
};

export type MonthlyProviderExposure = {
  capabilityKey: string;
  enabled: boolean;
  /**
   * A real provider-cost ceiling, including billable failed/released attempts.
   * A committed logical-unit limit alone is not a provider-cost ceiling.
   */
  hardMonthlyProviderCostCapUsd: number | null;
};

const DEFAULT_POLICY: ProfileAiEconomicsPolicy = {
  monthlyRevenueEur: null,
  targetVariableCostPct: 10,
  warningVariableCostPct: 12.5,
  hardVariableCostPct: 15,
  monthlyAiBudgetUsd: 5,
  monthlyImageLimit: 20,
  maxGenerationsPerDay: 8,
  maxGenerationsPerWeek: 30,
  maxVariantsPerContent: 4,
  strategyRefreshDays: 30,
  planRefreshDays: 14,
  generateImagesAfterApproval: true,
  webResearchOnlyWhenNeeded: true,
};

function finite(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
}
function bool(value: unknown, fallback: boolean) { return typeof value === "boolean" ? value : fallback; }
function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function profileAiEconomicsPolicy(platformStrategy: unknown, fallback?: { monthlyAiBudgetUsd?: number; monthlyImageLimit?: number }): ProfileAiEconomicsPolicy {
  const raw = object(object(platformStrategy).aiEconomics);
  const monthlyRevenue = raw.monthlyRevenueEur == null ? null : finite(raw.monthlyRevenueEur, 0, 0, 1_000_000);
  const target = finite(raw.targetVariableCostPct, DEFAULT_POLICY.targetVariableCostPct, 1, 80);
  const warning = Math.max(target, finite(raw.warningVariableCostPct, DEFAULT_POLICY.warningVariableCostPct, 1, 90));
  const hard = Math.max(warning, finite(raw.hardVariableCostPct, DEFAULT_POLICY.hardVariableCostPct, 1, 95));
  return {
    monthlyRevenueEur: monthlyRevenue,
    targetVariableCostPct: target,
    warningVariableCostPct: warning,
    hardVariableCostPct: hard,
    monthlyAiBudgetUsd: finite(raw.monthlyAiBudgetUsd, fallback?.monthlyAiBudgetUsd ?? DEFAULT_POLICY.monthlyAiBudgetUsd, 0.1, 10_000),
    monthlyImageLimit: Math.floor(finite(raw.monthlyImageLimit, fallback?.monthlyImageLimit ?? DEFAULT_POLICY.monthlyImageLimit, 0, 10_000)),
    maxGenerationsPerDay: Math.floor(finite(raw.maxGenerationsPerDay, DEFAULT_POLICY.maxGenerationsPerDay, 1, 500)),
    maxGenerationsPerWeek: Math.floor(finite(raw.maxGenerationsPerWeek, DEFAULT_POLICY.maxGenerationsPerWeek, 1, 3000)),
    maxVariantsPerContent: Math.floor(finite(raw.maxVariantsPerContent, DEFAULT_POLICY.maxVariantsPerContent, 1, 4)),
    strategyRefreshDays: Math.floor(finite(raw.strategyRefreshDays, DEFAULT_POLICY.strategyRefreshDays, 1, 365)),
    planRefreshDays: Math.floor(finite(raw.planRefreshDays, DEFAULT_POLICY.planRefreshDays, 1, 90)),
    generateImagesAfterApproval: bool(raw.generateImagesAfterApproval, DEFAULT_POLICY.generateImagesAfterApproval),
    webResearchOnlyWhenNeeded: bool(raw.webResearchOnlyWhenNeeded, DEFAULT_POLICY.webResearchOnlyWhenNeeded),
  };
}

export function evaluateAiSpend(policy: ProfileAiEconomicsPolicy, spend: AiSpendSnapshot, nextEstimatedUsd = 0) {
  const spentUsd = spend.textUsd + spend.imageUsd + spend.otherUsd;
  const projectedUsd = spentUsd + Math.max(nextEstimatedUsd, 0);
  const budgetPct = policy.monthlyAiBudgetUsd > 0 ? projectedUsd / policy.monthlyAiBudgetUsd * 100 : 100;
  const dailyBlocked = spend.generationsToday >= policy.maxGenerationsPerDay;
  const weeklyBlocked = spend.generationsThisWeek >= policy.maxGenerationsPerWeek;
  const hardBlocked = projectedUsd > policy.monthlyAiBudgetUsd || dailyBlocked || weeklyBlocked;
  return { spentUsd, projectedUsd, budgetPct, warning: budgetPct >= 80, blocked: hardBlocked, reason: dailyBlocked ? "DAILY_GENERATION_LIMIT" : weeklyBlocked ? "WEEKLY_GENERATION_LIMIT" : projectedUsd > policy.monthlyAiBudgetUsd ? "MONTHLY_AI_BUDGET" : null };
}

export function commercialMargin(input: { monthlyRevenueEur: number | null; attributedVariableCostsEur: number }) {
  if (!input.monthlyRevenueEur || input.monthlyRevenueEur <= 0) return { grossMarginEur: null, grossMarginPct: null };
  const grossMarginEur = input.monthlyRevenueEur - Math.max(input.attributedVariableCostsEur, 0);
  return { grossMarginEur, grossMarginPct: grossMarginEur / input.monthlyRevenueEur * 100 };
}

export function summarizeObservedAiCost(input: { logicalUnits: number; technicalEventCostsUsd: Array<number | null> }): ObservedAiCostSummary {
  if (!Number.isInteger(input.logicalUnits) || input.logicalUnits < 0) throw new Error("LOGICAL_UNITS_INVALID");
  const invalid = input.technicalEventCostsUsd.find((cost) => cost !== null && (!Number.isFinite(cost) || cost < 0));
  if (invalid !== undefined) throw new Error("TECHNICAL_COST_INVALID");
  const known = input.technicalEventCostsUsd.filter((cost): cost is number => cost !== null);
  const knownCostUsd = known.reduce((sum, cost) => sum + cost, 0);
  const nullCostEvents = input.technicalEventCostsUsd.length - known.length;
  if (input.logicalUnits === 0 && input.technicalEventCostsUsd.length === 0) {
    return { status: "NO_DATA", logicalUnits: 0, technicalEvents: 0, knownCostUsd: 0, nullCostEvents: 0, averageCostPerLogicalUnitUsd: null };
  }
  const complete = input.logicalUnits > 0 && nullCostEvents === 0;
  return {
    status: complete ? "COMPLETE" : "INCOMPLETE",
    logicalUnits: input.logicalUnits,
    technicalEvents: input.technicalEventCostsUsd.length,
    knownCostUsd,
    nullCostEvents,
    averageCostPerLogicalUnitUsd: complete ? knownCostUsd / input.logicalUnits : null,
  };
}

export function assessMonthlyProviderExposure(exposures: MonthlyProviderExposure[]) {
  const active = exposures.filter((exposure) => exposure.enabled);
  const unboundedCapabilities = active
    .filter((exposure) => exposure.hardMonthlyProviderCostCapUsd === null)
    .map((exposure) => exposure.capabilityKey);
  for (const exposure of active) {
    const cap = exposure.hardMonthlyProviderCostCapUsd;
    if (cap !== null && (!Number.isFinite(cap) || cap < 0)) throw new Error("PROVIDER_COST_CAP_INVALID");
  }
  return {
    status: unboundedCapabilities.length ? "UNBOUNDED" as const : "BOUNDED" as const,
    hardMonthlyProviderCostCapUsd: unboundedCapabilities.length
      ? null
      : active.reduce((sum, exposure) => sum + (exposure.hardMonthlyProviderCostCapUsd ?? 0), 0),
    unboundedCapabilities,
  };
}

export function technicalContribution(input: {
  monthlyRevenueEur: number | null;
  providerCostUsd: number;
  usdPerEur: number;
  otherTechnicalCostsEur: number;
  targetContributionEur?: number;
}) {
  if (!Number.isFinite(input.providerCostUsd) || input.providerCostUsd < 0) throw new Error("PROVIDER_COST_INVALID");
  if (!Number.isFinite(input.usdPerEur) || input.usdPerEur <= 0) throw new Error("FX_RATE_INVALID");
  if (!Number.isFinite(input.otherTechnicalCostsEur) || input.otherTechnicalCostsEur < 0) throw new Error("TECHNICAL_COST_INVALID");
  const targetContributionEur = input.targetContributionEur ?? 50;
  if (!Number.isFinite(targetContributionEur) || targetContributionEur < 0) throw new Error("CONTRIBUTION_TARGET_INVALID");
  const providerCostEur = input.providerCostUsd / input.usdPerEur;
  const technicalCogsEur = providerCostEur + input.otherTechnicalCostsEur;
  const margin = commercialMargin({ monthlyRevenueEur: input.monthlyRevenueEur, attributedVariableCostsEur: technicalCogsEur });
  return {
    providerCostEur,
    technicalCogsEur,
    contributionEur: margin.grossMarginEur,
    contributionPct: margin.grossMarginPct,
    targetContributionEur,
    minimumRevenueForTargetEur: technicalCogsEur + targetContributionEur,
    meetsTarget: margin.grossMarginEur === null ? null : margin.grossMarginEur >= targetContributionEur,
  };
}
