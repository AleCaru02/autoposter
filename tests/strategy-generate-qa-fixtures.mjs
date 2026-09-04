import { QA_ACTION_PROVIDER, QA_ACTION_BARRIER, QA_ACTION_BACKGROUND, validScenario, validOperationId } from "./strategy-generate-qa-common.mjs";
import { assertQaProfile } from "./strategy-generate-qa-state.mjs";
export async function setupProfile(sql,marker,profileId){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  await sql`update public.profiles set onboarding_completed=true,website_url='https://qa.example.invalid',industry='QA',timezone='Europe/Rome',updated_at=now() where id=${profileId}::uuid`;
  await sql`delete from public.content_strategies where profile_id=${profileId}::uuid`;
  return{configured:true,profileId};
}
export async function configureEntitlement(sql,marker,profileId,mode,limitValue){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");const enabled=mode!=="disabled";const limited=mode==="limited";const limitType=limited?"COUNT_PER_MONTH":"UNLIMITED";const periodType=limited?"MONTH":"NONE";const limit=limited?Math.max(0,Number(limitValue)||0):null;
  await sql`insert into public.profile_entitlements(profile_id,capability_key,enabled,limit_type,limit_value,period_type,source,metadata,updated_at) values (${profileId}::uuid,'ai.strategy.generate',${enabled},${limitType},${limit},${periodType},'QA_RUNTIME',${JSON.stringify({marker})}::jsonb,now()) on conflict (profile_id,capability_key) do update set enabled=excluded.enabled,limit_type=excluded.limit_type,limit_value=excluded.limit_value,period_type=excluded.period_type,source='QA_RUNTIME',metadata=excluded.metadata,updated_at=now()`;return{profileId,enabled,limitType,limitValue:limit,periodType};
}
export async function resetProfile(sql,marker,profileId){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  await sql`delete from public.platform_admin_audit where action=${QA_ACTION_PROVIDER} and metadata->>'marker'=${marker} and metadata->>'profileId'=${profileId}`;
  await sql`delete from public.ai_usage_events where profile_id=${profileId}::uuid`;await sql`delete from public.capability_usage_events where profile_id=${profileId}::uuid`;await sql`delete from public.capability_usage_buckets where profile_id=${profileId}::uuid`;await sql`delete from public.content_strategies where profile_id=${profileId}::uuid`;return{reset:true,profileId};
}
export async function prepareAutopilot(sql,marker,profileId){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  await sql`insert into public.content_strategies(profile_id,objectives,platform_strategy,updated_at) values (${profileId}::uuid,'[]'::jsonb,${JSON.stringify({autopilotEnabled:false,approvalMode:"MANUAL_REVIEW",strategyRefreshDays:1,planRefreshDays:1})}::jsonb,now()) on conflict (profile_id) do update set objectives=excluded.objectives,platform_strategy=excluded.platform_strategy,updated_at=now()`;
  return{configured:true,profileId};
}
export async function usage(sql,marker,profileId){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  const generic=await sql`select id::text as id,state,quantity::text as quantity,idempotency_key,metadata->>'execution_state' as execution_state,metadata->>'technical_usage_state' as technical_usage_state,jsonb_array_length(coalesce(metadata->'technical_usage_outbox','[]'::jsonb))::int as technical_outbox_items from public.capability_usage_events where profile_id=${profileId}::uuid and capability_key='ai.strategy.generate' order by created_at,id`;
  const buckets=await sql`select reserved_quantity::text as reserved,committed_quantity::text as committed from public.capability_usage_buckets where profile_id=${profileId}::uuid and capability_key='ai.strategy.generate' order by period_start`;
  const technical=await sql`select operation,cost_usd::text as cost_usd,metadata->>'logical_usage_event_id' as logical_usage_event_id from public.ai_usage_events where profile_id=${profileId}::uuid and operation in ('AGENT_STRATEGIST','AGENT_PLANNER') order by created_at,id`;
  const product=await sql`select count(*)::int as strategy_count,count(*) filter (where platform_strategy ? 'aiStrategy' and platform_strategy ? 'aiEditorialPlan')::int as complete_count from public.content_strategies where profile_id=${profileId}::uuid`;
  return{generic,buckets,technical,strategyCount:Number(product[0]?.strategy_count||0),completeStrategyCount:Number(product[0]?.complete_count||0)};
}
export async function providerCalls(sql,marker,profileId,scenario=null){
  if(profileId&&!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  const rows=await sql`select metadata->>'profileId' as profile_id,metadata->>'scenario' as scenario,metadata->>'operationId' as operation_id,metadata->>'callType' as call_type from public.platform_admin_audit where action=${QA_ACTION_PROVIDER} and metadata->>'marker'=${marker} and (${profileId||null}::text is null or metadata->>'profileId'=${profileId||null}) and (${scenario||null}::text is null or metadata->>'scenario'=${scenario||null}) order by created_at,id`;return{count:rows.length,calls:rows};
}
export async function releaseBarrier(sql,marker,profileId,scenario,operationId){
  if(!await assertQaProfile(sql,marker,profileId)||!validScenario(scenario)||!validOperationId(operationId))throw new Error("QA_BARRIER_SCOPE_MISMATCH");
  await sql`insert into public.platform_admin_audit(actor_auth_user_id,action,target_type,target_id,metadata) values (${`STRATEGY_GENERATE_QA_${marker}`},${QA_ACTION_BARRIER},'QA_BARRIER',${operationId},${JSON.stringify({marker,profileId,scenario,operationId})}::jsonb)`;return{released:true};
}
export async function backgroundStatus(sql,marker,profileId,scenario){
  if(!await assertQaProfile(sql,marker,profileId)||!validScenario(scenario))throw new Error("QA_BACKGROUND_SCOPE_MISMATCH");
  const rows=await sql`select metadata->>'status' as status from public.platform_admin_audit where action=${QA_ACTION_BACKGROUND} and metadata->>'marker'=${marker} and metadata->>'profileId'=${profileId} and metadata->>'scenario'=${scenario} order by created_at desc limit 1`;
  return{done:rows.length===1,status:rows[0]?.status||null};
}
