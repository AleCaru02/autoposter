import { profileAiEconomicsPolicy } from "./ai-economics.js";

export type ManualAIUsageEvent = {
  operation: string | null;
  cost_usd: number | string | null;
  created_at: string;
};

export type ManualAIBudgetSnapshot = {
  monthlyBudgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  generations24h: number;
  generations7d: number;
  maxGenerationsPerDay: number;
  maxGenerationsPerWeek: number;
};

export function buildManualAIBudgetSnapshot(input: {
  platformStrategy: unknown;
  usageEvents: ManualAIUsageEvent[];
  defaultMonthlyAiBudgetUsd: number;
  defaultMonthlyImageLimit?: number;
  now?: Date;
}): ManualAIBudgetSnapshot {
  const now = input.now ?? new Date();
  const policy = profileAiEconomicsPolicy(input.platformStrategy, {
    monthlyAiBudgetUsd: input.defaultMonthlyAiBudgetUsd,
    monthlyImageLimit: input.defaultMonthlyImageLimit ?? 20,
  });
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  let spentUsd = 0;
  let generations24h = 0;
  let generations7d = 0;
  for (const event of input.usageEvents) {
    spentUsd += Number(event.cost_usd) || 0;
    if (event.operation !== "GENERATE_SOCIAL_TEXT") continue;
    const createdAt = new Date(event.created_at).getTime();
    if (!Number.isFinite(createdAt)) continue;
    if (createdAt >= weekAgo) generations7d += 1;
    if (createdAt >= dayAgo) generations24h += 1;
  }
  return {
    monthlyBudgetUsd: policy.monthlyAiBudgetUsd,
    spentUsd,
    remainingUsd: Math.max(policy.monthlyAiBudgetUsd - spentUsd, 0),
    generations24h,
    generations7d,
    maxGenerationsPerDay: policy.maxGenerationsPerDay,
    maxGenerationsPerWeek: policy.maxGenerationsPerWeek,
  };
}

export function authorizeManualTextGeneration(snapshot: ManualAIBudgetSnapshot, estimatedMaxUsd: number) {
  if (snapshot.spentUsd >= snapshot.monthlyBudgetUsd || snapshot.spentUsd + Math.max(estimatedMaxUsd, 0) > snapshot.monthlyBudgetUsd) {
    return { allowed: false as const, reason: "MONTHLY_AI_BUDGET" as const };
  }
  if (snapshot.generations24h >= snapshot.maxGenerationsPerDay) {
    return { allowed: false as const, reason: "DAILY_GENERATION_LIMIT" as const };
  }
  if (snapshot.generations7d >= snapshot.maxGenerationsPerWeek) {
    return { allowed: false as const, reason: "WEEKLY_GENERATION_LIMIT" as const };
  }
  return { allowed: true as const, reason: null };
}
