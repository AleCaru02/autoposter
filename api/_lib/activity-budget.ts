import { neon } from "@neondatabase/serverless";
import { ACTIVITY_BUDGET_EUR, activityBudgetBand, brainDecision, type ActivityBudgetBand, type BrainTask, type ContentImportance } from "./ai-brain-policy.js";

type BudgetRow = {
  hard_cap_eur: number | string;
  ordinary_target_eur: number | string;
  reserve_start_eur: number | string;
  protected_reserve_start_eur: number | string;
  emergency_only_start_eur: number | string;
  usd_to_eur_rate: number | string;
  accounted_eur: number | string;
  remaining_eur: number | string;
  band: ActivityBudgetBand;
};

type SpendRow = { spend_eur: number | string };
type CountRow = { count: number | string };
type BudgetSplitRow = {
  higgsfield_cap_eur: number | string;
  other_ai_cap_eur: number | string;
  higgsfield_spend_eur: number | string;
  other_ai_spend_eur: number | string;
};

export type ActivityBudgetSnapshot = {
  profileId: string;
  hardCapEur: number;
  ordinaryTargetEur: number;
  reserveStartEur: number;
  protectedReserveStartEur: number;
  emergencyOnlyStartEur: number;
  usdToEurRate: number;
  spendEur: number;
  remainingEur: number;
  higgsfieldCapEur: number;
  higgsfieldSpendEur: number;
  higgsfieldRemainingEur: number;
  otherAiCapEur: number;
  otherAiSpendEur: number;
  otherAiRemainingEur: number;
  band: ActivityBudgetBand;
  dailyAverageEur: number;
  trailing7DailyAverageEur: number;
  daysRemaining: number;
  forecastEndOfMonthEur: number;
  futureScheduledJobs: number;
  forecastExceedsTarget: boolean;
  forecastRisksHardCap: boolean;
};

export type ActivityBudgetPreflight = ActivityBudgetSnapshot & {
  allowed: boolean;
  reason: "AI_BUDGET_HARD_STOP" | "AI_BUDGET_OPERATION_TOO_EXPENSIVE" | "AI_BUDGET_BUCKET_EXHAUSTED" | null;
  projectedOperationCostEur: number;
  projectedAfterEur: number;
  costBucket: "HIGGSFIELD" | "OTHER_AI" | null;
  preferReuse: boolean;
  allowPremium: boolean;
};

function n(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function monthBounds(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export function forecastActivityBudget(input: {
  spendEur: number;
  trailing7SpendEur: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const { start, end } = monthBounds(now);
  const dayMs = 86_400_000;
  const elapsedDays = Math.max(1, Math.ceil((now.getTime() - start.getTime()) / dayMs));
  const daysRemaining = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / dayMs));
  const dailyAverageEur = input.spendEur / elapsedDays;
  const trailingWindowDays = Math.min(7, elapsedDays);
  const trailing7DailyAverageEur = input.trailing7SpendEur / Math.max(trailingWindowDays, 1);
  const projectedDaily = Math.max(dailyAverageEur, trailing7DailyAverageEur);
  const forecastEndOfMonthEur = Math.max(input.spendEur, input.spendEur + projectedDaily * daysRemaining);
  return { dailyAverageEur, trailing7DailyAverageEur, daysRemaining, forecastEndOfMonthEur };
}

export class ActivityBudgetEngine {
  private readonly sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
    this.sql = neon(databaseUrl);
  }

  async snapshot(profileId: string, now = new Date()): Promise<ActivityBudgetSnapshot> {
    const rows = await this.sql`select * from public.activity_ai_budget_snapshot(${profileId}::uuid)` as unknown as BudgetRow[];
    const row = rows[0];
    if (!row) throw new Error("ACTIVITY_BUDGET_NOT_CONFIGURED");

    const { start, end } = monthBounds(now);
    const sevenDaysAgo = new Date(Math.max(start.getTime(), now.getTime() - 7 * 86_400_000));
    const trailingRows = await this.sql`
      select coalesce(sum(greatest(reserved_usd,coalesce(actual_usd,0))*fx_usd_to_eur_rate),0)::float8 as spend_eur
      from public.provider_cost_attempts
      where profile_id=${profileId}::uuid
        and provider_started_at>=${sevenDaysAgo.toISOString()}::timestamptz
        and provider_started_at<${end.toISOString()}::timestamptz
    ` as unknown as SpendRow[];
    const jobRows = await this.sql`
      select count(*)::int as count
      from public.publication_jobs
      where profile_id=${profileId}::uuid
        and scheduled_at>=${now.toISOString()}::timestamptz
        and scheduled_at<${end.toISOString()}::timestamptz
        and state in ('SCHEDULED','BLOCKED_APPROVAL','QUEUED')
    ` as unknown as CountRow[];
    const splitRows = await this.sql`
      select
        policy.higgsfield_cap_eur::float8 as higgsfield_cap_eur,
        policy.other_ai_cap_eur::float8 as other_ai_cap_eur,
        coalesce(sum(
          greatest(attempt.reserved_usd,coalesce(attempt.actual_usd,0))*attempt.fx_usd_to_eur_rate
        ) filter (where attempt.cost_bucket='HIGGSFIELD'),0)::float8 as higgsfield_spend_eur,
        coalesce(sum(
          greatest(attempt.reserved_usd,coalesce(attempt.actual_usd,0))*attempt.fx_usd_to_eur_rate
        ) filter (where attempt.cost_bucket='OTHER_AI'),0)::float8 as other_ai_spend_eur
      from public.activity_ai_budget_policies policy
      left join public.provider_cost_attempts attempt
        on attempt.profile_id=policy.profile_id
       and attempt.period_start=${start.toISOString()}::timestamptz
       and attempt.period_end=${end.toISOString()}::timestamptz
      where policy.profile_id=${profileId}::uuid
      group by policy.higgsfield_cap_eur,policy.other_ai_cap_eur
    ` as unknown as BudgetSplitRow[];

    const spendEur = n(row.accounted_eur);
    const split = splitRows[0];
    const higgsfieldCapEur = n(split?.higgsfield_cap_eur, 10);
    const higgsfieldSpendEur = n(split?.higgsfield_spend_eur);
    const otherAiCapEur = n(split?.other_ai_cap_eur, 20);
    const otherAiSpendEur = n(split?.other_ai_spend_eur);
    const forecast = forecastActivityBudget({
      spendEur,
      trailing7SpendEur: n(trailingRows[0]?.spend_eur),
      now,
    });
    const ordinaryTargetEur = n(row.ordinary_target_eur, ACTIVITY_BUDGET_EUR.ordinaryTargetStart);
    const hardCapEur = n(row.hard_cap_eur, ACTIVITY_BUDGET_EUR.hardCap);

    return {
      profileId,
      hardCapEur,
      ordinaryTargetEur,
      reserveStartEur: n(row.reserve_start_eur, ACTIVITY_BUDGET_EUR.reserveStart),
      protectedReserveStartEur: n(row.protected_reserve_start_eur, ACTIVITY_BUDGET_EUR.protectedReserveStart),
      emergencyOnlyStartEur: n(row.emergency_only_start_eur, ACTIVITY_BUDGET_EUR.emergencyOnlyStart),
      usdToEurRate: n(row.usd_to_eur_rate, 1),
      spendEur,
      remainingEur: n(row.remaining_eur, Math.max(hardCapEur - spendEur, 0)),
      higgsfieldCapEur,
      higgsfieldSpendEur,
      higgsfieldRemainingEur: Math.max(higgsfieldCapEur - higgsfieldSpendEur, 0),
      otherAiCapEur,
      otherAiSpendEur,
      otherAiRemainingEur: Math.max(otherAiCapEur - otherAiSpendEur, 0),
      band: row.band || activityBudgetBand(spendEur),
      ...forecast,
      futureScheduledJobs: Math.max(0, Math.floor(n(jobRows[0]?.count))),
      forecastExceedsTarget: forecast.forecastEndOfMonthEur > ordinaryTargetEur,
      forecastRisksHardCap: forecast.forecastEndOfMonthEur >= hardCapEur,
    };
  }

  async preflight(input: {
    profileId: string;
    task: BrainTask;
    importance?: ContentImportance;
    projectedOperationCostUsd?: number | null;
    costBucket?: "HIGGSFIELD" | "OTHER_AI" | null;
    now?: Date;
  }): Promise<ActivityBudgetPreflight> {
    const snapshot = await this.snapshot(input.profileId, input.now ?? new Date());
    const projectedOperationCostEur = Math.max(0, input.projectedOperationCostUsd ?? 0) * snapshot.usdToEurRate;
    const projectedAfterEur = snapshot.spendEur + projectedOperationCostEur;
    const brain = brainDecision({
      spendEur: snapshot.spendEur,
      task: input.task,
      importance: input.importance,
      forecastEndOfMonthEur: Math.max(snapshot.forecastEndOfMonthEur, projectedAfterEur),
      budgetBand: snapshot.band,
      ordinaryTargetEur: snapshot.ordinaryTargetEur,
    });
    const hardStopped = snapshot.band === "HARD_STOP";
    const tooExpensive = projectedAfterEur > snapshot.hardCapEur;
    const bucketRemaining = input.costBucket === "HIGGSFIELD"
      ? snapshot.higgsfieldRemainingEur
      : input.costBucket === "OTHER_AI"
        ? snapshot.otherAiRemainingEur
        : Number.POSITIVE_INFINITY;
    const bucketExhausted = projectedOperationCostEur > bucketRemaining;
    return {
      ...snapshot,
      allowed: !hardStopped && !tooExpensive && !bucketExhausted,
      reason: hardStopped
        ? "AI_BUDGET_HARD_STOP"
        : tooExpensive
          ? "AI_BUDGET_OPERATION_TOO_EXPENSIVE"
          : bucketExhausted
            ? "AI_BUDGET_BUCKET_EXHAUSTED"
            : null,
      projectedOperationCostEur,
      projectedAfterEur,
      costBucket: input.costBucket ?? null,
      preferReuse: brain.preferReuse,
      allowPremium: brain.allowPremium,
    };
  }
}
