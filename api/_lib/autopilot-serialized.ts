import { Client } from "@neondatabase/serverless";
import { runContentAutopilot, type AutopilotEnv } from "./autopilot.js";
import { profileAiEconomicsPolicy } from "./ai-economics.js";

type RunOptions = { profileId?: string; maxGenerations?: number };
type RunResult = { profilesChecked: number; generated: number; scheduled: number; blockedForReview: number; skipped: number; errors: string[] };
type UsageSnapshot = { globalTextUsd: number; profileTotalUsd: number; globalImages: number; profileImages: number; generated24h: number; generated7d: number };

const LOCK_NAME = "post-automatici:content-autopilot:v1";
const DEFAULT_TEXT_BUDGET_USD = 5;
const DEFAULT_IMAGE_LIMIT = 20;
const DEFAULT_GENERATIONS_PER_RUN = 12;

function numberOr(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultTextBudget(env: AutopilotEnv) {
  return Math.min(Math.max(numberOr(env.OPENAI_TEXT_MONTHLY_BUDGET_USD, DEFAULT_TEXT_BUDGET_USD), 0.1), 100);
}

function defaultImageLimit(env: AutopilotEnv) {
  return Math.min(Math.max(Math.floor(numberOr(env.OPENAI_IMAGE_MONTHLY_LIMIT, DEFAULT_IMAGE_LIMIT)), 1), 500);
}

function emptyResult(): RunResult {
  return { profilesChecked: 0, generated: 0, scheduled: 0, blockedForReview: 0, skipped: 0, errors: [] };
}

function addResult(target: RunResult, source: RunResult) {
  target.profilesChecked += source.profilesChecked;
  target.generated += source.generated;
  target.scheduled += source.scheduled;
  target.blockedForReview += source.blockedForReview;
  target.skipped += source.skipped;
  target.errors.push(...source.errors);
}

async function profileIds(client: Client, requestedProfileId?: string) {
  if (requestedProfileId) {
    const rows = await client.query<{ id: string }>(
      "select id::text as id from public.profiles where id=$1::uuid and archived_at is null and onboarding_completed=true limit 1",
      [requestedProfileId],
    );
    return rows.rows.map((row) => row.id);
  }
  const rows = await client.query<{ id: string }>(
    "select id::text as id from public.profiles where archived_at is null and onboarding_completed=true order by created_at asc limit 100",
  );
  return rows.rows.map((row) => row.id);
}

async function platformStrategy(client: Client, profileId: string) {
  const rows = await client.query<{ platform_strategy: unknown }>(
    "select platform_strategy from public.content_strategies where profile_id=$1::uuid limit 1",
    [profileId],
  );
  return rows.rows[0]?.platform_strategy ?? {};
}

async function usageSnapshot(client: Client, profileId: string): Promise<UsageSnapshot> {
  const rows = await client.query<{
    global_text_usd: string | number | null;
    profile_total_usd: string | number | null;
    global_images: string | number | null;
    profile_images: string | number | null;
    generated_24h: string | number | null;
    generated_7d: string | number | null;
  }>(`
    select
      coalesce(sum(cost_usd) filter (where created_at >= date_trunc('month', now()) and operation='GENERATE_SOCIAL_TEXT'),0)::float8 as global_text_usd,
      coalesce(sum(cost_usd) filter (where profile_id=$1::uuid and created_at >= date_trunc('month', now())),0)::float8 as profile_total_usd,
      count(*) filter (where created_at >= date_trunc('month', now()) and operation='GENERATE_SOCIAL_IMAGE')::int as global_images,
      count(*) filter (where profile_id=$1::uuid and created_at >= date_trunc('month', now()) and operation='GENERATE_SOCIAL_IMAGE')::int as profile_images,
      count(*) filter (where profile_id=$1::uuid and created_at >= now() - interval '24 hours' and operation='GENERATE_SOCIAL_TEXT')::int as generated_24h,
      count(*) filter (where profile_id=$1::uuid and created_at >= now() - interval '7 days' and operation='GENERATE_SOCIAL_TEXT')::int as generated_7d
    from public.ai_usage_events
  `, [profileId]);
  const row = rows.rows[0];
  return {
    globalTextUsd: numberOr(row?.global_text_usd),
    profileTotalUsd: numberOr(row?.profile_total_usd),
    globalImages: numberOr(row?.global_images),
    profileImages: numberOr(row?.profile_images),
    generated24h: numberOr(row?.generated_24h),
    generated7d: numberOr(row?.generated_7d),
  };
}

function guardedEnv(env: AutopilotEnv, policy: ReturnType<typeof profileAiEconomicsPolicy>, usage: UsageSnapshot, approvalMode: string | null) {
  const remainingUsd = Math.max(policy.monthlyAiBudgetUsd - usage.profileTotalUsd, 0);
  const remainingImages = Math.max(policy.monthlyImageLimit - usage.profileImages, 0);
  const allowAutopilotImage = approvalMode === "AUTOMATIC" || policy.generateImagesAfterApproval === false;
  return {
    ...env,
    // The canonical autopilot currently compares global spend/counts. By adding only this profile's
    // remaining allowance to the current global totals, that comparison becomes profile-isolated.
    OPENAI_TEXT_MONTHLY_BUDGET_USD: String(usage.globalTextUsd + remainingUsd),
    OPENAI_IMAGE_MONTHLY_LIMIT: String(usage.globalImages + (allowAutopilotImage ? remainingImages : 0)),
  };
}

export async function runContentAutopilotSerialized(env: AutopilotEnv, options: RunOptions = {}) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  const client = new Client(env.DATABASE_URL);
  await client.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1::text, 0))", [LOCK_NAME]);
    locked = true;

    const ids = await profileIds(client, options.profileId);
    if (!ids.length) return emptyResult();
    const aggregate = emptyResult();
    let remainingRun = Math.min(Math.max(options.maxGenerations ?? DEFAULT_GENERATIONS_PER_RUN, 1), 50);

    for (const profileId of ids) {
      if (remainingRun <= 0) break;
      const strategy = await platformStrategy(client, profileId);
      const strategyObject = strategy && typeof strategy === "object" && !Array.isArray(strategy) ? strategy as Record<string, unknown> : {};
      const policy = profileAiEconomicsPolicy(strategy, {
        monthlyAiBudgetUsd: defaultTextBudget(env),
        monthlyImageLimit: defaultImageLimit(env),
      });
      const usage = await usageSnapshot(client, profileId);
      const remainingDaily = Math.max(policy.maxGenerationsPerDay - usage.generated24h, 0);
      const remainingWeekly = Math.max(policy.maxGenerationsPerWeek - usage.generated7d, 0);
      const profileGenerationCap = Math.min(remainingRun, remainingDaily, remainingWeekly);

      if (usage.profileTotalUsd >= policy.monthlyAiBudgetUsd) {
        aggregate.profilesChecked += 1;
        aggregate.skipped += 1;
        aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:MONTHLY_AI_BUDGET`);
        continue;
      }
      if (profileGenerationCap <= 0) {
        aggregate.profilesChecked += 1;
        aggregate.skipped += 1;
        const reason = remainingDaily <= 0 ? "DAILY_GENERATION_LIMIT" : "WEEKLY_GENERATION_LIMIT";
        aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:${reason}`);
        continue;
      }

      const scopedEnv = guardedEnv(env, policy, usage, typeof strategyObject.approvalMode === "string" ? strategyObject.approvalMode : null);
      const result = await runContentAutopilot(scopedEnv, { profileId, maxGenerations: profileGenerationCap });
      addResult(aggregate, result);
      remainingRun -= result.generated;
    }
    return aggregate;
  } finally {
    if (locked) {
      await client.query("select pg_advisory_unlock(hashtextextended($1::text, 0))", [LOCK_NAME]).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}
