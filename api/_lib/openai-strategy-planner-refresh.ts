import { neon } from "@neondatabase/serverless";
import { estimateTerraCostUsd } from "./openai-text.js";
import { generateOpenAIPlan, generateOpenAIStrategy, type OpenAIEditorialPlan, type OpenAIStrategy } from "./openai-strategy-planner.js";

export type StrategyPlannerRefreshEnv = { DATABASE_URL?: string; OPENAI_API_KEY?: string };
export type RefreshPolicy = { strategyRefreshDays: number; planRefreshDays: number };

type ProfileRow = { id: string; name: string; industry: string | null; website_url: string | null; timezone: string };
type BrandRow = { description: string | null; business_model: string | null; location: string | null; service_area: string | null; target_audience: unknown; tone_of_voice: unknown; goals: unknown; visual_identity: unknown };
type StrategyRow = { objectives: unknown; platform_strategy: unknown };
type ScheduleRow = { provider: "INSTAGRAM"|"FACEBOOK"|"LINKEDIN"|"GBP"; posts_per_week: number; preferred_slots: unknown; timezone: string; enabled: boolean };
type TopicRow = { topic: string };

function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function ageDays(value: unknown, now: Date) { if (typeof value !== "string") return Infinity; const time = new Date(value).getTime(); return Number.isFinite(time) ? Math.max(0,(now.getTime()-time)/86_400_000) : Infinity; }
function validStrategy(value: unknown): value is OpenAIStrategy { const v=object(value); return typeof v.summary==="string" && typeof v.primaryObjective==="string" && Array.isArray(v.contentPillars); }
function validPlan(value: unknown): value is OpenAIEditorialPlan { const v=object(value); return Number.isInteger(v.horizonDays) && Array.isArray(v.items) && v.items.length>0; }

export function strategyPlannerRefreshDecision(platformStrategy: unknown, policy: RefreshPolicy, now = new Date()) {
  const state=object(platformStrategy);
  const strategyFresh=validStrategy(state.aiStrategy)&&ageDays(state.aiStrategyGeneratedAt,now)<policy.strategyRefreshDays;
  const planFresh=validPlan(state.aiEditorialPlan)&&ageDays(state.aiEditorialPlanGeneratedAt,now)<policy.planRefreshDays;
  return { refreshStrategy: !strategyFresh, refreshPlan: !planFresh || !strategyFresh };
}

export async function ensureOpenAIStrategyPlannerFresh(env: StrategyPlannerRefreshEnv, profileId: string, policy: RefreshPolicy) {
  if(!env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED"); if(!env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const sql=neon(env.DATABASE_URL); const profiles=await sql`select id,name,industry,website_url,timezone from public.profiles where id=${profileId}::uuid and archived_at is null limit 1` as unknown as ProfileRow[]; const profile=profiles[0]; if(!profile) throw new Error("PROFILE_NOT_FOUND");
  const brands=await sql`select description,business_model,location,service_area,target_audience,tone_of_voice,goals,visual_identity from public.brand_profiles where profile_id=${profileId}::uuid limit 1` as unknown as BrandRow[];
  const current=await sql`select objectives,platform_strategy from public.content_strategies where profile_id=${profileId}::uuid limit 1` as unknown as StrategyRow[]; const existing=object(current[0]?.platform_strategy); const decision=strategyPlannerRefreshDecision(existing,policy);
  if(!decision.refreshStrategy&&!decision.refreshPlan) return { strategyRefreshed:false, planRefreshed:false };
  const schedules=await sql`select provider,posts_per_week,preferred_slots,timezone,enabled from public.schedules where profile_id=${profileId}::uuid and enabled=true order by provider` as unknown as ScheduleRow[];
  const recent=await sql`select topic from public.content_items where profile_id=${profileId}::uuid order by created_at desc limit 40` as unknown as TopicRow[];
  let strategy=validStrategy(existing.aiStrategy)?existing.aiStrategy:null; let strategyResult:Awaited<ReturnType<typeof generateOpenAIStrategy>>|null=null;
  if(decision.refreshStrategy){strategyResult=await generateOpenAIStrategy({apiKey:env.OPENAI_API_KEY,profile,brand:brands[0],existingObjectives:current[0]?.objectives});strategy=strategyResult.output;const total=Object.values(strategy.contentMix).reduce((sum,value)=>sum+value,0);if(total!==100)throw new Error("OPENAI_STRATEGIST_INVALID_MIX");}
  if(!strategy) throw new Error("OPENAI_STRATEGY_MISSING");
  let planResult:Awaited<ReturnType<typeof generateOpenAIPlan>>|null=null; if(decision.refreshPlan) planResult=await generateOpenAIPlan({apiKey:env.OPENAI_API_KEY,profile,strategy,schedules,recentTopics:recent.map(r=>r.topic).filter(Boolean)});
  const now=new Date().toISOString(); const persisted={...existing,aiStrategy:strategy,aiStrategyGeneratedAt:strategyResult?now:existing.aiStrategyGeneratedAt,aiEditorialPlan:planResult?.output??existing.aiEditorialPlan,aiEditorialPlanGeneratedAt:planResult?now:existing.aiEditorialPlanGeneratedAt,aiAgentsVersion:2,aiAgentsModel:"gpt-5.6-terra"};
  await sql`insert into public.content_strategies (profile_id,objectives,platform_strategy,updated_at) values (${profileId}::uuid,${JSON.stringify([strategy.primaryObjective])}::jsonb,${JSON.stringify(persisted)}::jsonb,now()) on conflict (profile_id) do update set objectives=excluded.objectives,platform_strategy=excluded.platform_strategy,updated_at=now()`;
  if(strategyResult){const cost=strategyResult.usage.inputTokens!==null&&strategyResult.usage.outputTokens!==null?estimateTerraCostUsd(strategyResult.usage.inputTokens,strategyResult.usage.outputTokens):null;await sql`insert into public.ai_usage_events (profile_id,operation,model,input_tokens,output_tokens,cost_usd,metadata) values (${profileId}::uuid,'AGENT_STRATEGIST','gpt-5.6-terra',${strategyResult.usage.inputTokens},${strategyResult.usage.outputTokens},${cost},${JSON.stringify({openai_response_id:strategyResult.responseId,openai_request_id:strategyResult.requestId,agent:"STRATEGIST",refresh:true})}::jsonb)`;}
  if(planResult){const cost=planResult.usage.inputTokens!==null&&planResult.usage.outputTokens!==null?estimateTerraCostUsd(planResult.usage.inputTokens,planResult.usage.outputTokens):null;await sql`insert into public.ai_usage_events (profile_id,operation,model,input_tokens,output_tokens,cost_usd,metadata) values (${profileId}::uuid,'AGENT_PLANNER','gpt-5.6-terra',${planResult.usage.inputTokens},${planResult.usage.outputTokens},${cost},${JSON.stringify({openai_response_id:planResult.responseId,openai_request_id:planResult.requestId,agent:"PLANNER",refresh:true,horizon_days:planResult.output.horizonDays,items:planResult.output.items.length})}::jsonb)`;}
  return { strategyRefreshed:Boolean(strategyResult), planRefreshed:Boolean(planResult) };
}
