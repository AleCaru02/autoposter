import { Client } from "@neondatabase/serverless";
import { runContentAutopilot, type AutopilotEnv } from "./autopilot.js";
import { profileAiEconomicsPolicy } from "./ai-economics.js";
import { ensureOpenAIStrategyPlannerFresh, strategyPlannerRefreshDecision } from "./openai-strategy-planner-refresh.js";
import { ActivityBudgetEngine } from "./activity-budget.js";

type RunOptions = { profileId?: string; maxGenerations?: number };
type RunResult = { profilesChecked: number; generated: number; scheduled: number; blockedForReview: number; skipped: number; errors: string[] };
type UsageSnapshot = { globalTextUsd: number; profileTotalUsd: number; globalImages: number; profileImages: number; generated24h: number; generated7d: number };

const LOCK_NAME = "post-automatici:content-autopilot:v1";
const DEFAULT_GENERATIONS_PER_RUN = 12;

function numberOr(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function emptyResult(): RunResult { return { profilesChecked: 0, generated: 0, scheduled: 0, blockedForReview: 0, skipped: 0, errors: [] }; }
function addResult(target: RunResult, source: RunResult) { target.profilesChecked += source.profilesChecked; target.generated += source.generated; target.scheduled += source.scheduled; target.blockedForReview += source.blockedForReview; target.skipped += source.skipped; target.errors.push(...source.errors); }

async function profileIds(client: Client, requestedProfileId?: string) {
  if (requestedProfileId) { const rows = await client.query<{ id: string }>("select id::text as id from public.profiles where id=$1::uuid and archived_at is null and onboarding_completed=true limit 1", [requestedProfileId]); return rows.rows.map((row) => row.id); }
  const rows = await client.query<{ id: string }>("select id::text as id from public.profiles where archived_at is null and onboarding_completed=true order by created_at asc limit 100"); return rows.rows.map((row) => row.id);
}
async function platformStrategy(client: Client, profileId: string) { const rows = await client.query<{ platform_strategy: unknown }>("select platform_strategy from public.content_strategies where profile_id=$1::uuid limit 1", [profileId]); return rows.rows[0]?.platform_strategy ?? {}; }
async function usageSnapshot(client: Client, profileId: string): Promise<UsageSnapshot> {
  const rows = await client.query<{ global_text_usd:string|number|null;profile_total_usd:string|number|null;global_images:string|number|null;profile_images:string|number|null;generated_24h:string|number|null;generated_7d:string|number|null }>(`
    select
      coalesce(sum(cost_usd) filter (where created_at >= date_trunc('month', now()) and operation='GENERATE_SOCIAL_TEXT'),0)::float8 as global_text_usd,
      coalesce(sum(cost_usd) filter (where profile_id=$1::uuid and created_at >= date_trunc('month', now())),0)::float8 as profile_total_usd,
      count(*) filter (where created_at >= date_trunc('month', now()) and operation='GENERATE_SOCIAL_IMAGE')::int as global_images,
      count(*) filter (where profile_id=$1::uuid and created_at >= date_trunc('month', now()) and operation='GENERATE_SOCIAL_IMAGE')::int as profile_images,
      count(*) filter (where profile_id=$1::uuid and created_at >= now() - interval '24 hours' and operation='GENERATE_SOCIAL_TEXT')::int as generated_24h,
      count(*) filter (where profile_id=$1::uuid and created_at >= now() - interval '7 days' and operation='GENERATE_SOCIAL_TEXT')::int as generated_7d
    from public.ai_usage_events`, [profileId]);
  const row=rows.rows[0];return{globalTextUsd:numberOr(row?.global_text_usd),profileTotalUsd:numberOr(row?.profile_total_usd),globalImages:numberOr(row?.global_images),profileImages:numberOr(row?.profile_images),generated24h:numberOr(row?.generated_24h),generated7d:numberOr(row?.generated_7d)};
}
export async function runContentAutopilotSerialized(env: AutopilotEnv, options: RunOptions = {}) {
  if(!env.DATABASE_URL)throw new Error("DATABASE_NOT_CONFIGURED");const client=new Client(env.DATABASE_URL);await client.connect();let locked=false;
  try{
    await client.query("select pg_advisory_lock(hashtextextended($1::text, 0))",[LOCK_NAME]);locked=true;const ids=await profileIds(client,options.profileId);if(!ids.length)return emptyResult();const aggregate=emptyResult();let remainingRun=Math.min(Math.max(options.maxGenerations??DEFAULT_GENERATIONS_PER_RUN,1),50);
    for(const profileId of ids){
      if(remainingRun<=0)break;let strategy=await platformStrategy(client,profileId);const policy=profileAiEconomicsPolicy(strategy);let usage=await usageSnapshot(client,profileId);
      const budgetEngine=new ActivityBudgetEngine(env.DATABASE_URL);const currentBudget=await budgetEngine.snapshot(profileId);
      if(currentBudget.band==="HARD_STOP"){aggregate.profilesChecked+=1;aggregate.skipped+=1;aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:ACTIVITY_HARD_STOP`);continue;}
      const refresh=strategyPlannerRefreshDecision(strategy,{strategyRefreshDays:policy.strategyRefreshDays,planRefreshDays:policy.planRefreshDays});const reserve=refresh.refreshStrategy?0.20:refresh.refreshPlan?0.12:0;
      if(reserve>0){const planningBudget=await budgetEngine.preflight({profileId,task:"STRATEGY",importance:refresh.refreshStrategy?"IMPORTANT":"STANDARD",projectedOperationCostUsd:reserve});if(!planningBudget.allowed){aggregate.profilesChecked+=1;aggregate.skipped+=1;aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:PLANNER_REFRESH_RESERVE`);continue;}}
      if(refresh.refreshStrategy||refresh.refreshPlan){await ensureOpenAIStrategyPlannerFresh(env,profileId,{strategyRefreshDays:policy.strategyRefreshDays,planRefreshDays:policy.planRefreshDays});strategy=await platformStrategy(client,profileId);usage=await usageSnapshot(client,profileId);const afterPlanning=await budgetEngine.snapshot(profileId);if(afterPlanning.band==="HARD_STOP"){aggregate.profilesChecked+=1;aggregate.skipped+=1;aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:ACTIVITY_HARD_STOP_AFTER_PLANNING`);continue;}}
      const remainingDaily=Math.max(policy.maxGenerationsPerDay-usage.generated24h,0);const remainingWeekly=Math.max(policy.maxGenerationsPerWeek-usage.generated7d,0);const profileGenerationCap=Math.min(remainingRun,remainingDaily,remainingWeekly);
      if(profileGenerationCap<=0){aggregate.profilesChecked+=1;aggregate.skipped+=1;const reason=remainingDaily<=0?"DAILY_GENERATION_LIMIT":"WEEKLY_GENERATION_LIMIT";aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:${reason}`);continue;}
      const result=await runContentAutopilot(env,{profileId,maxGenerations:profileGenerationCap});addResult(aggregate,result);remainingRun-=result.generated;
    }
    return aggregate;
  }finally{if(locked)await client.query("select pg_advisory_unlock(hashtextextended($1::text, 0))",[LOCK_NAME]).catch(()=>undefined);await client.end().catch(()=>undefined);}
}
