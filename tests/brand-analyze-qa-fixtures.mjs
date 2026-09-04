import { QA_ACTION_PROVIDER, QA_ACTION_BARRIER, validScenario, validOperationId } from "./brand-analyze-qa-common.mjs";
import { assertQaProfile } from "./brand-analyze-qa-state.mjs";
export async function setupProfile(sql,marker,profileId){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  await sql`update public.profiles set onboarding_completed=false,website_url='https://qa.example.invalid',industry='QA',updated_at=now() where id=${profileId}::uuid`;
  await sql`delete from public.website_pages where profile_id=${profileId}::uuid`;await sql`delete from public.website_scans where profile_id=${profileId}::uuid`;
  const scanId=crypto.randomUUID();
  await sql`insert into public.website_scans(id,profile_id,root_url,state,page_limit,max_depth,discovered_pages,analyzed_pages,skipped_pages,failed_pages,started_at,finished_at,last_progress_at) values (${scanId}::uuid,${profileId}::uuid,'https://qa.example.invalid','COMPLETE',1,1,1,1,0,0,now(),now(),now())`;
  await sql`insert into public.website_pages(scan_id,profile_id,url,normalized_url,status,depth,title,meta_description,content_text,content_hash,discovered_from,skip_reason,error,scanned_at) values (${scanId}::uuid,${profileId}::uuid,'https://qa.example.invalid/','https://qa.example.invalid/','ANALYZED',0,'QA Runtime','Fixture verifier','Contesto sito QA confermato per il brand verifier.','qa-brand-runtime',null,null,null,now())`;
  await sql`delete from public.brand_profiles where profile_id=${profileId}::uuid`;return{configured:true,profileId,scanId};
}
export async function configureEntitlement(sql,marker,profileId,mode,limitValue){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");const enabled=mode!=="disabled";const limited=mode==="limited";const limitType=limited?"COUNT_PER_MONTH":"UNLIMITED";const periodType=limited?"MONTH":"NONE";const limit=limited?Math.max(0,Number(limitValue)||0):null;
  await sql`insert into public.profile_entitlements(profile_id,capability_key,enabled,limit_type,limit_value,period_type,source,metadata,updated_at) values (${profileId}::uuid,'brand.analyze',${enabled},${limitType},${limit},${periodType},'QA_RUNTIME',${JSON.stringify({marker})}::jsonb,now()) on conflict (profile_id,capability_key) do update set enabled=excluded.enabled,limit_type=excluded.limit_type,limit_value=excluded.limit_value,period_type=excluded.period_type,source='QA_RUNTIME',metadata=excluded.metadata,updated_at=now()`;return{profileId,enabled,limitType,limitValue:limit,periodType};
}
export async function resetProfile(sql,marker,profileId){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  await sql`delete from public.platform_admin_audit where action=${QA_ACTION_PROVIDER} and metadata->>'marker'=${marker} and metadata->>'profileId'=${profileId}`;
  await sql`delete from public.ai_usage_events where profile_id=${profileId}::uuid`;await sql`delete from public.capability_usage_events where profile_id=${profileId}::uuid`;await sql`delete from public.capability_usage_buckets where profile_id=${profileId}::uuid`;await sql`delete from public.brand_profiles where profile_id=${profileId}::uuid`;await sql`update public.profiles set onboarding_completed=false,updated_at=now() where id=${profileId}::uuid`;return{reset:true,profileId};
}
export async function usage(sql,marker,profileId){
  if(!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  const generic=await sql`select id::text as id,state,quantity::text as quantity,idempotency_key,metadata->>'execution_state' as execution_state,metadata->>'technical_usage_state' as technical_usage_state,jsonb_array_length(coalesce(metadata->'technical_usage_outbox','[]'::jsonb))::int as technical_outbox_items from public.capability_usage_events where profile_id=${profileId}::uuid and capability_key='brand.analyze' order by created_at,id`;
  const buckets=await sql`select reserved_quantity::text as reserved,committed_quantity::text as committed from public.capability_usage_buckets where profile_id=${profileId}::uuid and capability_key='brand.analyze' order by period_start`;
  const technical=await sql`select operation,cost_usd::text as cost_usd,metadata->>'logical_usage_event_id' as logical_usage_event_id from public.ai_usage_events where profile_id=${profileId}::uuid and operation='ANALYZE_BRAND_ONBOARDING' order by created_at,id`;
  const product=await sql`select (select count(*)::int from public.brand_profiles where profile_id=${profileId}::uuid) as brand_count,(select onboarding_completed from public.profiles where id=${profileId}::uuid) as onboarding_completed`;
  return{generic,buckets,technical,brandCount:Number(product[0]?.brand_count||0),onboardingCompleted:product[0]?.onboarding_completed===true};
}
export async function providerCalls(sql,marker,profileId,scenario=null){
  if(profileId&&!await assertQaProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  const rows=await sql`select metadata->>'profileId' as profile_id,metadata->>'scenario' as scenario,metadata->>'operationId' as operation_id,metadata->>'callType' as call_type from public.platform_admin_audit where action=${QA_ACTION_PROVIDER} and metadata->>'marker'=${marker} and (${profileId||null}::text is null or metadata->>'profileId'=${profileId||null}) and (${scenario||null}::text is null or metadata->>'scenario'=${scenario||null}) order by created_at,id`;return{count:rows.length,calls:rows};
}
export async function releaseBarrier(sql,marker,profileId,scenario,operationId){
  if(!await assertQaProfile(sql,marker,profileId)||!validScenario(scenario)||!validOperationId(operationId))throw new Error("QA_BARRIER_SCOPE_MISMATCH");
  await sql`insert into public.platform_admin_audit(actor_auth_user_id,action,target_type,target_id,metadata) values (${`BRAND_ANALYZE_QA_${marker}`},${QA_ACTION_BARRIER},'QA_BARRIER',${operationId},${JSON.stringify({marker,profileId,scenario,operationId})}::jsonb)`;return{released:true};
}
