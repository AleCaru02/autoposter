import { neonConfig } from "@neondatabase/serverless";
import productWorker from "../cloudflare/entry.ts";
import { makeQaProviderKey, parseQaProviderKey, openAiCallType, allowedProviderCallType, fakeOpenAiPlan, safeProviderRecord, technicalPersistenceFailureBody } from "./brand-analyze-provider-harness.mjs";
import { QA_ACTION_PROVIDER, QA_ACTION_BARRIER, json, sameSecret, validMarker, validScenario, previewRequest, sqlFor, currentSql, requestBodyText } from "./brand-analyze-qa-common.mjs";
import { assertQaProfile, state, cleanup } from "./brand-analyze-qa-state.mjs";
import { setupProfile, configureEntitlement, resetProfile, usage, providerCalls, releaseBarrier } from "./brand-analyze-qa-fixtures.mjs";
const nativeFetch=globalThis.fetch.bind(globalThis);
async function waitForBarrier(sql,c){const deadline=Date.now()+20_000;while(Date.now()<deadline){const rows=await sql`select 1 from public.platform_admin_audit where action=${QA_ACTION_BARRIER} and metadata->>'marker'=${c.marker} and metadata->>'profileId'=${c.profileId} and metadata->>'scenario'=${c.scenario} and metadata->>'operationId'=${c.operationId} limit 1`;if(rows.length)return;await new Promise(r=>setTimeout(r,100));}throw new Error("BARRIER_TIMEOUT");}
async function interceptedFetch(input,init={}){
  let url;try{url=new URL(typeof input==="string"?input:input.url);}catch{return nativeFetch(input,init);}
  if(url.hostname==="api.openai.com"){
    const headers=new Headers(init.headers||(input instanceof Request?input.headers:undefined));const auth=headers.get("authorization")||"";const c=parseQaProviderKey(auth.startsWith("Bearer ")?auth.slice(7).trim():"");const sql=currentSql();if(!c||!sql)return json({error:"RUNTIME_VERIFIER_NOT_CERTIFIED"},503);
    const callType=openAiCallType(url.toString(),init);await sql`insert into public.platform_admin_audit(actor_auth_user_id,action,target_type,target_id,metadata) values (${`BRAND_ANALYZE_QA_${c.marker}`},${QA_ACTION_PROVIDER},'QA_PROVIDER',${c.operationId},${JSON.stringify(safeProviderRecord(c,callType||"UNKNOWN"))}::jsonb)`;
    const plan=fakeOpenAiPlan({callType:callType||"UNKNOWN",correlation:c});if(!allowedProviderCallType(callType))return new Response(JSON.stringify(plan.body),{status:plan.status,headers:plan.headers});
    if(plan.barrier){try{await waitForBarrier(sql,c);}catch{return json({error:"RUNTIME_VERIFIER_NOT_CERTIFIED",detail:"BARRIER_TIMEOUT"},504);}}
    return new Response(JSON.stringify(plan.body),{status:plan.status,headers:plan.headers});
  }
  const raw=await requestBodyText(input,init);if(technicalPersistenceFailureBody(raw))return json({error:"BRAND_ANALYZE_QA_TECHNICAL_LEDGER_FAILURE"},503);return nativeFetch(input,init);
}
globalThis.fetch=interceptedFetch;neonConfig.fetchFunction=interceptedFetch;
async function control(request,env){
  if(request.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);if(!previewRequest(request))return json({error:"RUNTIME_VERIFIER_NOT_CERTIFIED"},403);
  if(!sameSecret(request.headers.get("x-brand-analyze-qa-token")||"",env.BRAND_ANALYZE_QA_TOKEN||""))return json({error:"FORBIDDEN"},403);
  let body;try{body=await request.json();}catch{return json({error:"INVALID_JSON"},400);}const marker=body?.marker;if(!validMarker(marker)||request.headers.get("x-brand-analyze-qa-marker")!==marker)return json({error:"INVALID_MARKER"},400);const sql=sqlFor(env.DATABASE_URL);
  try{switch(body.action){
    case"preflight":case"state":return json(await state(sql,marker));
    case"instrumentation-status":return json({armed:true,previewOnly:true,persistedCounter:"platform_admin_audit",promptLogging:false,supports:["BRAND","PROVIDER_FAILURE","LATENCY","BARRIER","TECHNICAL_LEDGER_FAILURE"]});
    case"setup-profile":return json(await setupProfile(sql,marker,body.profileId));case"configure-entitlement":return json(await configureEntitlement(sql,marker,body.profileId,body.mode,body.limitValue));case"reset-profile":return json(await resetProfile(sql,marker,body.profileId));case"usage":return json(await usage(sql,marker,body.profileId));case"provider-calls":return json(await providerCalls(sql,marker,body.profileId||null,body.scenario||null));case"release-barrier":return json(await releaseBarrier(sql,marker,body.profileId,body.scenario,body.operationId));case"cleanup":return json(await cleanup(sql,marker,false));case"cleanup-residue":return json(await cleanup(sql,marker,true));default:return json({error:"INVALID_ACTION"},400);
  }}catch(reason){console.error("brand-analyze-qa-controller",reason instanceof Error?reason.message:"unknown");return json({error:"CONTROLLER_FAILED",detail:reason instanceof Error?reason.message:"unknown"},500);}
}
async function productRoute(request,env,ctx){
  if(!previewRequest(request))return json({error:"RUNTIME_VERIFIER_NOT_CERTIFIED"},403);const marker=request.headers.get("x-brand-analyze-qa-marker")||"";const scenario=request.headers.get("x-brand-analyze-qa-scenario")||"";
  if(!sameSecret(request.headers.get("x-brand-analyze-qa-token")||"",env.BRAND_ANALYZE_QA_TOKEN||"")||!validMarker(marker)||!validScenario(scenario))return json({error:"RUNTIME_VERIFIER_NOT_CERTIFIED"},403);
  let body={};try{body=await request.clone().json();}catch{return json({error:"INVALID_JSON"},400);}const profileId=typeof body.profileId==="string"?body.profileId:"";const sql=sqlFor(env.DATABASE_URL);if(!await assertQaProfile(sql,marker,profileId))return json({error:"RUNTIME_VERIFIER_NOT_CERTIFIED"},403);
  const operationId=`brand-${scenario}`;const fakeKey=makeQaProviderKey({marker,profileId,scenario,operationId});return productWorker.fetch(request,{...env,OPENAI_API_KEY:fakeKey},ctx);
}
export default{async fetch(request,env,ctx){if(!env.DATABASE_URL||!env.BRAND_ANALYZE_QA_TOKEN)return json({error:"RUNTIME_VERIFIER_NOT_CERTIFIED"},503);sqlFor(env.DATABASE_URL);const path=new URL(request.url).pathname;if(path==="/__qa/control")return control(request,env);if(path==="/api/onboarding-analyze")return productRoute(request,env,ctx);return json({error:"RUNTIME_VERIFIER_NOT_CERTIFIED"},404);}};
