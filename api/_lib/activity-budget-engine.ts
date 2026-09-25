import { neon } from "@neondatabase/serverless";
import { brainDecision, type ActivityBudgetBand, type BrainTask, type ContentImportance } from "./ai-brain-policy.js";

type Sql = ReturnType<typeof neon>;

type SnapshotRow = {
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

type MoneyRow = { amount: number | string | null };
type CountRow = { count: number | string | null };

export type ActivityBudgetSnapshot = {
  profileId: string;
  currency: "EUR";
  hardCapEur: number;
  ordinaryTargetEur: number;
  reserveStartEur: number;
  protectedReserveStartEur: number;
  emergencyOnlyStartEur: number;
  usdToEurRate: number;
  spendEur: number;
  accountedEur: number;
  remainingEur: number;
  monthDailyAverageEur: number;
  last7DailyAverageEur: number;
  averageContentCostEur: number;
  upcomingScheduledCount: number;
  forecastEndOfMonthEur: number;
  band: ActivityBudgetBand;
};

export type ActivityBudgetPreflight = ActivityBudgetSnapshot & {
  allowed: boolean;
  reason: "AI_BUDGET_HARD_STOP" | "AI_BUDGET_OPERATION_TOO_EXPENSIVE" | null;
  preferReuse: boolean;
  allowPremium: boolean;
  projectedOperationCostEur: number;
  projectedAfterEur: number;
};

function value(input: unknown) {
  const parsed = typeof input === "number" ? input : typeof input === "string" ? Number(input) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthBounds(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

function daysInMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

async function policySnapshot(sql: Sql, profileId: string) {
  const rows = await sql`select * from public.activity_ai_budget_snapshot(${profileId}::uuid)` as unknown as SnapshotRow[];
  if (!rows[0]) throw new Error("ACTIVITY_BUDGET_POLICY_MISSING");
  return rows[0];
}

export async function activityBudgetSnapshot(input: {
  databaseUrl: string;
  profileId: string;
  now?: Date;
}): Promise<ActivityBudgetSnapshot> {
  if (!input.databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  if (!input.profileId) throw new Error("PROFILE_ID_REQUIRED");

  const now = input.now ?? new Date();
  const sql = neon(input.databaseUrl);
  const policy = await policySnapshot(sql, input.profileId);
  const usdToEurRate = Math.max(value(policy.usd_to_eur_rate), 0.000001);
  const { start, end } = monthBounds(now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [actualRows, recentRows, contentRows, upcomingRows] = await Promise.all([
    sql`select coalesce(sum(cost_usd),0)::float8 amount from public.ai_usage_events where profile_id=${input.profileId}::uuid and created_at>=${start.toISOString()}::timestamptz and created_at<${end.toISOString()}::timestamptz` as unknown as MoneyRow[],
    sql`select coalesce(sum(cost_usd),0)::float8 amount from public.ai_usage_events where profile_id=${input.profileId}::uuid and created_at>=${sevenDaysAgo.toISOString()}::timestamptz and created_at<=${now.toISOString()}::timestamptz` as unknown as MoneyRow[],
    sql`select count(distinct nullif(metadata->>'logical_usage_event_id',''))::int count from public.ai_usage_events where profile_id=${input.profileId}::uuid and created_at>=${start.toISOString()}::timestamptz and created_at<${end.toISOString()}::timestamptz` as unknown as CountRow[],
    sql`select count(*)::int count from public.publication_jobs where profile_id=${input.profileId}::uuid and scheduled_at>${now.toISOString()}::timestamptz and scheduled_at<${end.toISOString()}::timestamptz and state in ('SCHEDULED','BLOCKED_APPROVAL','QUEUED')` as unknown as CountRow[],
  ]);

  const spendEur = value(actualRows[0]?.amount) * usdToEurRate;
  const accountedEur = value(policy.accounted_eur);
  const day = Math.max(1, now.getUTCDate());
  const remainingDays = Math.max(0, daysInMonth(now) - day);
  const monthDailyAverageEur = spendEur / day;
  const last7DailyAverageEur = value(recentRows[0]?.amount) * usdToEurRate / Math.min(7, day);
  const contentUnits = Math.max(0, Math.floor(value(contentRows[0]?.count)));
  const averageContentCostEur = contentUnits > 0 ? spendEur / contentUnits : 0;
  const upcomingScheduledCount = Math.max(0, Math.floor(value(upcomingRows[0]?.count)));
  const velocityForecast = accountedEur + Math.max(monthDailyAverageEur, last7DailyAverageEur) * remainingDays;
  const calendarForecast = accountedEur + averageContentCostEur * upcomingScheduledCount;

  return {
    profileId: input.profileId,
    currency: "EUR",
    hardCapEur: value(policy.hard_cap_eur),
    ordinaryTargetEur: value(policy.ordinary_target_eur),
    reserveStartEur: value(policy.reserve_start_eur),
    protectedReserveStartEur: value(policy.protected_reserve_start_eur),
    emergencyOnlyStartEur: value(policy.emergency_only_start_eur),
    usdToEurRate,
    spendEur,
    accountedEur,
    remainingEur: Math.max(value(policy.remaining_eur), 0),
    monthDailyAverageEur,
    last7DailyAverageEur,
    averageContentCostEur,
    upcomingScheduledCount,
    forecastEndOfMonthEur: Math.max(accountedEur, velocityForecast, calendarForecast),
    band: policy.band,
  };
}

export async function preflightActivityBudget(input: {
  databaseUrl: string;
  profileId: string;
  task: BrainTask;
  importance?: ContentImportance;
  projectedOperationCostUsd?: number | null;
  now?: Date;
}): Promise<ActivityBudgetPreflight> {
  const snapshot = await activityBudgetSnapshot(input);
  const projectedOperationCostEur = Math.max(0, input.projectedOperationCostUsd ?? 0) * snapshot.usdToEurRate;
  const projectedAfterEur = snapshot.accountedEur + projectedOperationCostEur;
  const brain = brainDecision({
    spendEur: snapshot.accountedEur,
    task: input.task,
    importance: input.importance,
    forecastEndOfMonthEur: Math.max(snapshot.forecastEndOfMonthEur, projectedAfterEur),
  });

  const hardStopped = snapshot.band === "HARD_STOP";
  const tooExpensive = projectedAfterEur > snapshot.hardCapEur;
  const allowed = !hardStopped && !tooExpensive;

  return {
    ...snapshot,
    allowed,
    reason: hardStopped ? "AI_BUDGET_HARD_STOP" : tooExpensive ? "AI_BUDGET_OPERATION_TOO_EXPENSIVE" : null,
    preferReuse: brain.preferReuse,
    allowPremium: brain.allowPremium,
    projectedOperationCostEur,
    projectedAfterEur,
  };
}
