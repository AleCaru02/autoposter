import { neon } from "@neondatabase/serverless";
import { processDueAnalytics } from "../api/_lib/analytics.js";
import { decryptTokenBundle, processDuePublications } from "../api/_lib/social.js";

const emailPattern = /^analytics7h-([a-z0-9]{10,32})-(owner|other)@example\.invalid$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWN_LINKEDIN_7F = "urn:li:share:7503297798210113536";
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function sameSecret(a, b) { if (!a || !b || a.length !== b.length) return false; let diff=0; for(let i=0;i<a.length;i+=1) diff|=a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function validMarker(value) { return typeof value === "string" && /^[a-z0-9]{10,32}$/.test(value); }

async function qaUsers(sql, marker = null) {
  const rows=await sql`select id::text id,lower(coalesce(to_jsonb(u)->>'email','')) email from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like 'analytics7h-%@example.invalid' order by email`;
  return rows.map((row)=>({...row,match:emailPattern.exec(row.email)})).filter((row)=>row.match&&(!marker||row.match[1]===marker));
}
async function state(sql, marker) {
  const users=await qaUsers(sql,marker); const all=await qaUsers(sql); const pattern=`analytics7h-${marker}-%@example.invalid`;
  const rows=await sql`select
    (select count(*)::int from public.profiles) profiles_total,
    (select count(*)::int from public.publication_jobs) jobs_total,
    (select count(*)::int from public.metric_snapshots) snapshots_total,
    (select count(*)::int from public.analytics_sync_targets) targets_total,
    (select count(*)::int from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_profiles,
    (select count(*)::int from public.content_items i join public.profiles p on p.id=i.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_content,
    (select count(*)::int from public.social_connections c join public.profiles p on p.id=c.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_connections,
    (select count(*)::int from public.publication_jobs j join public.profiles p on p.id=j.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_jobs,
    (select count(*)::int from public.metric_snapshots s join public.profiles p on p.id=s.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_snapshots,
    (select count(*)::int from public.analytics_sync_targets t join public.profiles p on p.id=t.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_targets`;
  const row=rows[0]||{}; return {qaUsers:users.length,recognizedQaUsers:all.length,profilesTotal:Number(row.profiles_total||0),jobsTotal:Number(row.jobs_total||0),snapshotsTotal:Number(row.snapshots_total||0),targetsTotal:Number(row.targets_total||0),qaProfiles:Number(row.qa_profiles||0),qaContent:Number(row.qa_content||0),qaConnections:Number(row.qa_connections||0),qaJobs:Number(row.qa_jobs||0),qaSnapshots:Number(row.qa_snapshots||0),qaTargets:Number(row.qa_targets||0)};
}
async function ownedProfile(sql, marker, profileId) {
  if(!UUID.test(profileId||"")) return false; const email=`analytics7h-${marker}-owner@example.invalid`;
  const rows=await sql`select p.id from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id where p.id=${profileId}::uuid and lower(coalesce(to_jsonb(u)->>'email',''))=${email}`; return Boolean(rows[0]);
}
async function fixture(sql, marker, profileId) {
  if(!await ownedProfile(sql,marker,profileId)) throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  for(const capability of ["schedule.job.create","social.publish.scheduled","social.facebook.publish","social.linkedin.publish","analytics.read"]){
    await sql`insert into public.profile_entitlements(profile_id,capability_key,enabled,limit_type,limit_value,period_type,source,metadata) values (${profileId}::uuid,${capability},true,'UNLIMITED',NULL,'NONE','FASE7H_QA','{"qa":true}'::jsonb) on conflict (profile_id,capability_key) do update set enabled=true,limit_type='UNLIMITED',limit_value=NULL,period_type='NONE',source='FASE7H_QA',updated_at=now()`;
  }
  const cloned=await sql`with source as (select distinct on (provider) provider,status,provider_account_id,account_name,token_reference,permissions,expires_at,metadata,last_validated_at from public.social_connections where provider in ('FACEBOOK','LINKEDIN') and status='ACTIVE' and token_reference is not null and profile_id<>${profileId}::uuid order by provider,last_validated_at desc nulls last) insert into public.social_connections(profile_id,provider,status,provider_account_id,account_name,token_reference,permissions,expires_at,metadata,last_validated_at,updated_at) select ${profileId}::uuid,provider,status,provider_account_id,account_name,token_reference,permissions,expires_at,metadata||'{"qaClone":true}'::jsonb,last_validated_at,now() from source on conflict (profile_id,provider) do update set status=excluded.status,provider_account_id=excluded.provider_account_id,account_name=excluded.account_name,token_reference=excluded.token_reference,permissions=excluded.permissions,expires_at=excluded.expires_at,metadata=excluded.metadata,last_validated_at=excluded.last_validated_at,updated_at=now() returning provider`;
  if(cloned.length!==2) throw new Error("READY_PROVIDER_CONNECTIONS_MISSING");
  const content=await sql`insert into public.content_items(profile_id,topic,title,status) values (${profileId}::uuid,'QA 7H analytics',${`QA 7H ${marker}`},'APPROVED') returning id::text`;
  const variants=await sql`insert into public.content_variants(content_id,profile_id,provider,format,eligible,hook,caption,approval_status) values (${content[0].id}::uuid,${profileId}::uuid,'FACEBOOK','POST',true,'QA 7H','QA 7H analytics fixture','APPROVED'),(${content[0].id}::uuid,${profileId}::uuid,'LINKEDIN','POST',true,'QA 7H','QA 7H — verifica tecnica temporanea, nessun contenuto commerciale.','APPROVED') returning id::text,provider`;
  return {variants};
}
async function connection(sql, profileId, provider, env) {
  const rows=await sql`select provider_account_id,token_reference,permissions,metadata from public.social_connections where profile_id=${profileId}::uuid and provider=${provider} and status='ACTIVE'`;
  if(!rows[0]?.token_reference||!env.SOCIAL_TOKEN_KEY) throw new Error(`${provider}_CONNECTION_MISSING`); const bundle=await decryptTokenBundle(rows[0].token_reference,env.SOCIAL_TOKEN_KEY); return {...rows[0],accessToken:bundle.accessToken};
}
async function facebookPreflight(sql, marker, profileId, env) {
  if(!await ownedProfile(sql,marker,profileId)) throw new Error("QA_PROFILE_SCOPE_MISMATCH"); const row=await connection(sql,profileId,"FACEBOOK",env); const version=/^v\d+\.\d+$/.test(env.META_GRAPH_VERSION||"")?env.META_GRAPH_VERSION:"v23.0";
  const url=new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(row.provider_account_id)}/published_posts`); url.searchParams.set("fields","id,created_time"); url.searchParams.set("limit","25");
  const response=await fetch(url,{headers:{authorization:`Bearer ${row.accessToken}`,accept:"application/json"}}); const body=await response.json().catch(()=>({}));
  if(!response.ok) return {ready:false,status:response.status,error:"FACEBOOK_PREFLIGHT_REJECTED"}; const post=(Array.isArray(body.data)?body.data:[]).find((item)=>typeof item?.id==="string");
  return post?{ready:true,remotePostId:post.id,source:"PAGE_PUBLISHED_POSTS",pagination:Boolean(body.paging?.next)}:{ready:false,status:404,error:"FACEBOOK_NO_EXISTING_POST"};
}
async function linkedInPreflight(sql, marker, profileId, env) {
  if(!await ownedProfile(sql,marker,profileId)) throw new Error("QA_PROFILE_SCOPE_MISMATCH"); const row=await connection(sql,profileId,"LINKEDIN",env); const headers={authorization:`Bearer ${row.accessToken}`,accept:"application/json","Linkedin-Version":env.LINKEDIN_API_VERSION||"202601","X-Restli-Protocol-Version":"2.0.0"};
  const response=await fetch(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(KNOWN_LINKEDIN_7F)}`,{headers}); return {ready:response.ok,status:response.status,remotePostId:response.ok?KNOWN_LINKEDIN_7F:null,source:"FASE7F_REMOTE_ID"};
}
async function attachPublished(sql, marker, profileId, provider, variantId, remotePostId) {
  if(!await ownedProfile(sql,marker,profileId)||!UUID.test(variantId||"")||typeof remotePostId!=="string"||!remotePostId) throw new Error("QA_ATTACH_SCOPE_MISMATCH");
  const rows=await sql`insert into public.publication_jobs(profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,remote_post_id,published_at) select ${profileId}::uuid,v.id,v.provider,'PUBLISHED',now(),${`analytics7h:${marker}:${provider}`},1,${remotePostId},now() from public.content_variants v where v.id=${variantId}::uuid and v.profile_id=${profileId}::uuid and v.provider=${provider} returning id::text`; if(!rows[0]) throw new Error("QA_VARIANT_SCOPE_MISMATCH"); return rows[0];
}
async function publishLinkedIn(sql, marker, profileId, variantId, env) {
  if(!await ownedProfile(sql,marker,profileId)||!UUID.test(variantId||"")) throw new Error("QA_PUBLISH_SCOPE_MISMATCH"); const foreign=await sql`select count(*)::int count from public.publication_jobs where profile_id<>${profileId}::uuid and state='SCHEDULED' and scheduled_at<=now() and coalesce(next_attempt_at,scheduled_at)<=now()`; if(Number(foreign[0]?.count||0)!==0) throw new Error("NON_QA_DUE_JOB_PRESENT");
  const rows=await sql`insert into public.publication_jobs(profile_id,variant_id,provider,state,scheduled_at,next_attempt_at,idempotency_key) select ${profileId}::uuid,v.id,'LINKEDIN','SCHEDULED',now()-interval '2 seconds',now()-interval '2 seconds',${`analytics7h:${marker}:linkedin-new`} from public.content_variants v where v.id=${variantId}::uuid and v.profile_id=${profileId}::uuid and v.provider='LINKEDIN' returning id::text`; if(!rows[0]) throw new Error("QA_VARIANT_SCOPE_MISMATCH"); const engine=await processDuePublications(env,1); const job=(await sql`select id::text,state,remote_post_id,published_at,failure_code,last_error from public.publication_jobs where id=${rows[0].id}::uuid`)[0]; return {engine,job};
}
async function runAnalytics(sql, marker, profileId, jobId, env, concurrent=false) {
  if(!await ownedProfile(sql,marker,profileId)||!UUID.test(jobId||"")) throw new Error("QA_ANALYTICS_SCOPE_MISMATCH"); await sql`select public.refresh_analytics_sync_targets()`; await sql`update public.analytics_sync_targets set state='SCHEDULED',next_attempt_at=now()-interval '1 second',claim_token=null,lease_expires_at=null where job_id=${jobId}::uuid and profile_id=${profileId}::uuid`;
  const engines=concurrent?await Promise.all([processDueAnalytics(env,1),processDueAnalytics(env,1)]):[await processDueAnalytics(env,1)]; const snapshots=await sql`select id::text,provider,external_post_id,metrics,source,captured_at from public.metric_snapshots where job_id=${jobId}::uuid order by captured_at desc`; const target=(await sql`select state,consecutive_failures,last_error_code,last_error,last_synced_at from public.analytics_sync_targets where job_id=${jobId}::uuid`)[0]; return {engines,snapshots,target};
}
async function staleWrite(sql, marker, profileId, jobId) {
  if(!await ownedProfile(sql,marker,profileId)||!UUID.test(jobId||"")) throw new Error("QA_STALE_SCOPE_MISMATCH"); await sql`update public.analytics_sync_targets set state='SCHEDULED',next_attempt_at=now()-interval '1 second',claim_token=null,lease_expires_at=null where job_id=${jobId}::uuid`; const first=(await sql`select * from public.claim_due_analytics_syncs(1,30) where job_id=${jobId}::uuid`)[0]; if(!first) throw new Error("FIRST_CLAIM_MISSING"); await sql`update public.analytics_sync_targets set lease_expires_at=now()-interval '1 second' where job_id=${jobId}::uuid`; const second=(await sql`select * from public.claim_due_analytics_syncs(1,30) where job_id=${jobId}::uuid`)[0]; if(!second) throw new Error("STALE_RECLAIM_MISSING"); const stale=(await sql`select public.complete_analytics_sync(${jobId}::uuid,${first.claim_token}::uuid,'{"stale":1}'::jsonb,now(),'PROVIDER_API')::text result`)[0]; const failed=(await sql`select public.fail_analytics_sync(${jobId}::uuid,${second.claim_token}::uuid,'FACEBOOK_ANALYTICS_RATE_LIMITED','Aggiornamento rimandato per limite del social.',true,null,60) result`)[0]; const target=(await sql`select state,consecutive_failures,last_error_code,last_error from public.analytics_sync_targets where job_id=${jobId}::uuid`)[0]; return {oldTokenRejected:stale?.result===null,retryResult:failed?.result,target};
}
async function removeLinkedIn(sql, marker, profileId, jobId, env) {
  if(!await ownedProfile(sql,marker,profileId)||!UUID.test(jobId||"")) throw new Error("QA_REMOVE_SCOPE_MISMATCH"); const rows=await sql`select j.remote_post_id,c.token_reference from public.publication_jobs j join public.social_connections c on c.profile_id=j.profile_id and c.provider='LINKEDIN' where j.id=${jobId}::uuid and j.profile_id=${profileId}::uuid`; if(!rows[0]?.remote_post_id) return {removed:false,status:null}; const bundle=await decryptTokenBundle(rows[0].token_reference,env.SOCIAL_TOKEN_KEY); const response=await fetch(`https://api.linkedin.com/rest/posts/${encodeURIComponent(rows[0].remote_post_id)}`,{method:"DELETE",headers:{authorization:`Bearer ${bundle.accessToken}`,"Linkedin-Version":env.LINKEDIN_API_VERSION||"202601","X-Restli-Protocol-Version":"2.0.0","X-RestLi-Method":"DELETE"}}); return {removed:response.ok,status:response.status};
}
async function cleanupUsers(sql, users){for(const user of users){await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=${user.id}`;await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id}`;await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;await sql`delete from public.app_users where auth_user_id=${user.id}`;await sql`delete from neon_auth.user where id::text=${user.id}`;}}

export default { async fetch(request,env){if(request.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);if(!sameSecret(request.headers.get("x-analytics7h-token")||"",env.ANALYTICS7H_TOKEN||""))return json({error:"FORBIDDEN"},403);let body;try{body=await request.json();}catch{return json({error:"INVALID_JSON"},400);}if(!validMarker(body?.marker)||!env.DATABASE_URL)return json({error:"INVALID_REQUEST"},400);const sql=neon(env.DATABASE_URL);try{
  if(body.action==="preflight"||body.action==="state")return json(await state(sql,body.marker));
  if(body.action==="fixture")return json(await fixture(sql,body.marker,body.profileId));
  if(body.action==="facebook-preflight")return json(await facebookPreflight(sql,body.marker,body.profileId,env));
  if(body.action==="linkedin-preflight")return json(await linkedInPreflight(sql,body.marker,body.profileId,env));
  if(body.action==="attach-published")return json(await attachPublished(sql,body.marker,body.profileId,body.provider,body.variantId,body.remotePostId));
  if(body.action==="publish-linkedin")return json(await publishLinkedIn(sql,body.marker,body.profileId,body.variantId,env));
  if(body.action==="run-analytics")return json(await runAnalytics(sql,body.marker,body.profileId,body.jobId,env,Boolean(body.concurrent)));
  if(body.action==="stale-write")return json(await staleWrite(sql,body.marker,body.profileId,body.jobId));
  if(body.action==="remove-linkedin")return json(await removeLinkedIn(sql,body.marker,body.profileId,body.jobId,env));
  if(body.action==="cleanup"||body.action==="cleanup-residue"){const users=body.action==="cleanup"?await qaUsers(sql,body.marker):await qaUsers(sql);await cleanupUsers(sql,users);return json({cleaned:true,...await state(sql,body.marker)});} return json({error:"INVALID_ACTION"},400);
}catch(reason){console.error("fase7h-controller",reason instanceof Error?reason.message:"unknown");return json({error:"CONTROLLER_FAILED"},500);}}};
