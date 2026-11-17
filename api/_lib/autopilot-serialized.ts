import { Client } from "@neondatabase/serverless";
import { runContentAutopilot, type AutopilotEnv } from "./autopilot.js";
import { profileAiEconomicsPolicy } from "./ai-economics.js";
import { ensureOpenAIStrategyPlannerFresh, strategyPlannerRefreshDecision } from "./openai-strategy-planner-refresh.js";
import { ActivityBudgetEngine } from "./activity-budget.js";
import { failureBreakerOpen, FAILURE_BREAKER_THRESHOLD, type AutopilotAttemptRecord } from "./autopilot-spend-guards.js";

type RunOptions = { profileId?: string; maxGenerations?: number };
type RunResult = { profilesChecked: number; generated: number; scheduled: number; blockedForReview: number; skipped: number; deferred?: number; errors: string[] };
type UsageSnapshot = { globalTextUsd: number; profileTotalUsd: number; globalImages: number; profileImages: number; generated24h: number; generated7d: number };

const LOCK_NAME = "post-automatici:content-autopilot:v1";
const DEFAULT_GENERATIONS_PER_RUN = 12;

function numberOr(value: unknown, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function emptyResult(): RunResult { return { profilesChecked: 0, generated: 0, scheduled: 0, blockedForReview: 0, skipped: 0, errors: [] }; }
function addResult(target: RunResult, source: RunResult) { target.profilesChecked += source.profilesChecked; target.generated += source.generated; target.scheduled += source.scheduled; target.blockedForReview += source.blockedForReview; target.skipped += source.skipped; if(source.deferred)target.deferred=(target.deferred??0)+source.deferred; target.errors.push(...source.errors); }

/** No paid autonomous AI is allowed for a profile without an active, recently
 * verified destination account. Manual text generation is a separate workflow. */
export const AUTO_ELIGIBLE_PROFILE_SQL = `
  select p.id::text as id from public.profiles p
  left join lateral (select max(ci.created_at) as last_generated from public.content_items ci where ci.profile_id=p.id) activity on true
  where p.archived_at is null and p.onboarding_completed=true
    and exists (
      select 1 from public.social_connections conn
      where conn.profile_id=p.id and conn.status='ACTIVE' and conn.token_reference is not null
        and conn.provider_account_id is not null and length(btrim(conn.provider_account_id))>0
        and conn.last_validated_at > now()-interval '48 hours'
        and (conn.provider='GBP' or conn.expires_at is null or conn.expires_at>now())
    )
    and ($1::uuid is null or p.id=$1::uuid)
  order by activity.last_generated asc nulls first, p.created_at asc limit 100
`;
async function profileIds(client: Client, requestedProfileId?: string) {
  const rows=await client.query<{id:string}>(AUTO_ELIGIBLE_PROFILE_SQL,[requestedProfileId??null]);
  return rows.rows.map(row=>row.id);
}

/** After a reviewed code fix, give exactly one canary retry to the specified
 * profile if every last rejection predates the release cutoff. A fresh event
 * (even if rejected again) immediately closes the exception.
 */
export function breakerOneRetestAllowed(input:{
  profileId:string; configuredProfileId?:string;
  cutoffUtc?:string; recent:AutopilotAttemptRecord[]; now?:Date;
}) {
  const now=input.now??new Date();
  const cutoff=Date.parse(input.cutoffUtc??"");
  if(!/^[0-9a-f-]{36}$/i.test(input.configuredProfileId??"")||input.profileId!==input.configuredProfileId) return false;
  if(!Number.isFinite(cutoff)||cutoff>now.getTime()||now.getTime()-cutoff>24*60*60*1000) return false;
  const latest=input.recent.slice(0,FAILURE_BREAKER_THRESHOLD);
  return latest.length===FAILURE_BREAKER_THRESHOLD
    && failureBreakerOpen(latest,now)
    && latest.every(record=>Number.isFinite(Date.parse(record.created_at))&&Date.parse(record.created_at)<cutoff);
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
      if(remainingRun<=0)break;let strategy=await platformStrategy(client,profileId);let strategyObject=strategy&&typeof strategy==="object"&&!Array.isArray(strategy)?strategy as Record<string,unknown>:{};if(strategyObject.autopilotEnabled===false){aggregate.profilesChecked+=1;aggregate.skipped+=1;continue;}const policy=profileAiEconomicsPolicy(strategy);let usage=await usageSnapshot(client,profileId);
      const recentAttempts=await client.query<AutopilotAttemptRecord>("select state, metadata->>'release_reason' as reason, created_at::text as created_at from public.capability_usage_events where profile_id=$1::uuid and capability_key='ai.content.generate_text' and source='AI_TEXT_AUTOPILOT' and state in ('RELEASED','COMMITTED') order by created_at desc limit $2",[profileId,FAILURE_BREAKER_THRESHOLD]);
      if(failureBreakerOpen(recentAttempts.rows)&&!breakerOneRetestAllowed({
        profileId,configuredProfileId:env.AUTOPILOT_RETEST_PROFILE_ID,
        cutoffUtc:env.AUTOPILOT_RETEST_CUTOFF_UTC,recent:recentAttempts.rows,
      })){aggregate.profilesChecked+=1;aggregate.skipped+=1;aggregate.errors.push(`${profileId}:AUTOPILOT_FAILURE_BREAKER_OPEN`);continue;}
      const budgetEngine=new ActivityBudgetEngine(env.DATABASE_URL);const currentBudget=await budgetEngine.snapshot(profileId);
      if(currentBudget.band==="HARD_STOP"){aggregate.profilesChecked+=1;aggregate.skipped+=1;aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:ACTIVITY_HARD_STOP`);continue;}
      const refresh=strategyPlannerRefreshDecision(strategy,{strategyRefreshDays:policy.strategyRefreshDays,planRefreshDays:policy.planRefreshDays});const reserve=refresh.refreshStrategy?0.20:refresh.refreshPlan?0.12:0;
      if(reserve>0){const planningBudget=await budgetEngine.preflight({profileId,task:"STRATEGY",importance:refresh.refreshStrategy?"IMPORTANT":"STANDARD",projectedOperationCostUsd:reserve});if(!planningBudget.allowed){aggregate.profilesChecked+=1;aggregate.skipped+=1;aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:PLANNER_REFRESH_RESERVE`);continue;}}
      if(refresh.refreshStrategy||refresh.refreshPlan){await ensureOpenAIStrategyPlannerFresh(env,profileId,{strategyRefreshDays:policy.strategyRefreshDays,planRefreshDays:policy.planRefreshDays});strategy=await platformStrategy(client,profileId);strategyObject=strategy&&typeof strategy==="object"&&!Array.isArray(strategy)?strategy as Record<string,unknown>:{};usage=await usageSnapshot(client,profileId);const afterPlanning=await budgetEngine.snapshot(profileId);if(afterPlanning.band==="HARD_STOP"){aggregate.profilesChecked+=1;aggregate.skipped+=1;aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:ACTIVITY_HARD_STOP_AFTER_PLANNING`);continue;}}
      const remainingDaily=Math.max(policy.maxGenerationsPerDay-usage.generated24h,0);const remainingWeekly=Math.max(policy.maxGenerationsPerWeek-usage.generated7d,0);const profileGenerationCap=Math.min(remainingRun,remainingDaily,remainingWeekly);
      if(profileGenerationCap<=0){aggregate.profilesChecked+=1;aggregate.skipped+=1;const reason=remainingDaily<=0?"DAILY_GENERATION_LIMIT":"WEEKLY_GENERATION_LIMIT";aggregate.errors.push(`${profileId}:AUTOPILOT_AI_LIMIT_REACHED:${reason}`);continue;}
      const approvalMode=typeof strategyObject.approvalMode==="string"?strategyObject.approvalMode:null;const allowImageGeneration=strategyObject.instagramWebsitePilot===true||approvalMode==="AUTOMATIC"||policy.generateImagesAfterApproval===false;const result=await runContentAutopilot(env,{profileId,maxGenerations:profileGenerationCap,allowImageGeneration});addResult(aggregate,result);remainingRun-=result.generated;
    }
    return aggregate;
  }finally{if(locked)await client.query("select pg_advisory_unlock(hashtextextended($1::text, 0))",[LOCK_NAME]).catch(()=>undefined);await client.end().catch(()=>undefined);}
}
