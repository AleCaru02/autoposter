import { neon } from "@neondatabase/serverless";

const emailPattern = /^autopilot7g-([a-z0-9]{10,32})-(owner|other)@example\.invalid$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } }); }
function sameSecret(left, right) { if (!left || !right || left.length !== right.length) return false; let diff=0; for(let i=0;i<left.length;i+=1)diff|=left.charCodeAt(i)^right.charCodeAt(i); return diff===0; }
function validMarker(value) { return typeof value === "string" && /^[a-z0-9]{10,32}$/.test(value); }

async function qaUsers(sql, marker = null) {
  const rows=await sql`select id::text id,lower(coalesce(to_jsonb(u)->>'email','')) email from neon_auth.user u where lower(coalesce(to_jsonb(u)->>'email','')) like 'autopilot7g-%@example.invalid' order by email`;
  return rows.map((row)=>({...row,match:emailPattern.exec(row.email)})).filter((row)=>row.match&&(!marker||row.match[1]===marker));
}
async function state(sql, marker) {
  const users=await qaUsers(sql,marker);const all=await qaUsers(sql);const pattern=`autopilot7g-${marker}-%@example.invalid`;
  const counts=(await sql`select
    (select count(*)::int from public.profiles) profiles_total,
    (select count(*)::int from public.publication_jobs) jobs_total,
    (select count(*)::int from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_profiles,
    (select count(*)::int from public.content_items i join public.profiles p on p.id=i.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_content,
    (select count(*)::int from public.assets a join public.profiles p on p.id=a.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_assets,
    (select count(*)::int from public.publication_jobs j join public.profiles p on p.id=j.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_jobs,
    (select count(*)::int from public.capability_usage_events e join public.profiles p on p.id=e.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern}) qa_usage`)[0]||{};
  const detail=await sql`select i.id::text content_id,i.status content_status,v.id::text variant_id,v.provider,v.format,v.approval_status,v.eligible,v.hook,v.caption,v.cta,v.hashtags,v.visual_brief,v.alt_text,v.updated_at::text,j.id::text job_id,j.state job_state,j.scheduled_at::text
    from public.content_items i join public.profiles p on p.id=i.profile_id join neon_auth.user u on u.id::text=p.owner_auth_user_id
    join public.content_variants v on v.content_id=i.id and v.profile_id=i.profile_id left join public.publication_jobs j on j.variant_id=v.id and j.profile_id=v.profile_id
    where lower(coalesce(to_jsonb(u)->>'email','')) like ${pattern} order by i.created_at`;
  return {qaUsers:users.length,recognizedQaUsers:all.length,profilesTotal:Number(counts.profiles_total||0),jobsTotal:Number(counts.jobs_total||0),qaProfiles:Number(counts.qa_profiles||0),qaContent:Number(counts.qa_content||0),qaAssets:Number(counts.qa_assets||0),qaJobs:Number(counts.qa_jobs||0),qaUsage:Number(counts.qa_usage||0),detail};
}
async function ownedProfile(sql,marker,profileId){if(!UUID.test(profileId||""))return false;const email=`autopilot7g-${marker}-owner@example.invalid`;const rows=await sql`select p.id from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id where p.id=${profileId}::uuid and lower(coalesce(to_jsonb(u)->>'email',''))=${email}`;return Boolean(rows[0]);}
async function fixture(sql,marker,profileId){
  if(!await ownedProfile(sql,marker,profileId))throw new Error("QA_PROFILE_SCOPE_MISMATCH");
  for(const capability of ["ai.content.generate_text","ai.strategy.generate"]){await sql`insert into public.profile_entitlements(profile_id,capability_key,enabled,limit_type,limit_value,period_type,source,metadata) values (${profileId}::uuid,${capability},true,'UNLIMITED',NULL,'NONE','FASE7G_QA','{"qa":true}'::jsonb) on conflict (profile_id,capability_key) do update set enabled=true,limit_type='UNLIMITED',limit_value=NULL,period_type='NONE',source='FASE7G_QA',updated_at=now()`;}
  await sql`insert into public.brand_profiles(profile_id,description,business_model,target_audience,tone_of_voice,goals) values (${profileId}::uuid,'Attività QA tecnica per verificare il motore Autopilot.','Servizi professionali','{"summary":"PMI italiane"}'::jsonb,'{"summary":"chiaro e sobrio"}'::jsonb,'["informare"]'::jsonb) on conflict (profile_id) do update set description=excluded.description,business_model=excluded.business_model,target_audience=excluded.target_audience,tone_of_voice=excluded.tone_of_voice,goals=excluded.goals,updated_at=now()`;
  const scan=(await sql`insert into public.website_scans(profile_id,root_url,state,page_limit,max_depth,started_at,finished_at,last_progress_at,discovered_pages,analyzed_pages,skipped_pages,failed_pages) values (${profileId}::uuid,'https://example.invalid/','COMPLETE',1,1,now(),now(),now(),1,1,0,0) returning id::text`)[0];
  await sql`insert into public.website_pages(scan_id,profile_id,url,normalized_url,status,depth,title,content_text,content_hash,scanned_at) values (${scan.id}::uuid,${profileId}::uuid,'https://example.invalid/','https://example.invalid/','ANALYZED',0,'Autopilot QA','Questa attività offre consulenza editoriale responsabile alle piccole imprese italiane. Comunica con tono chiaro, evita promesse e pubblica consigli verificabili.','fase7g-qa',now())`;
  const generatedAt=new Date().toISOString();const plan={horizonDays:14,planningSummary:"QA unsupported-plan normalization",items:[{dayOffset:2,provider:"FACEBOOK",contentType:"CAROUSEL",intent:"TIP",topicDirection:"Spiega un consiglio pratico e verificabile per organizzare il calendario editoriale",objective:"Informare",funnelStage:"AWARENESS"}]};
  const aiStrategy={summary:"Strategia QA stabile",primaryObjective:"Informare",audience:"PMI italiane",positioning:"Consulenza editoriale responsabile",contentPillars:["Organizzazione","Qualità","Metodo"],contentMix:{educational:40,promotional:10,news:10,tips:30,storytelling:10},platformPriorities:["FACEBOOK"],ctaPolicy:"Invito sobrio",localityPolicy:"Italia",seasonalityPolicy:"Solo se verificata",doNotClaim:["Risultati garantiti"]};
  const strategy={autopilotEnabled:true,approvalMode:"MANUAL_REVIEW",researchMode:"BRAND_ONLY",aiEconomics:{monthlyAiBudgetUsd:5,monthlyImageLimit:0,maxGenerationsPerDay:1,maxGenerationsPerWeek:1,generateImagesAfterApproval:true},aiStrategy,aiStrategyGeneratedAt:generatedAt,aiEditorialPlanGeneratedAt:generatedAt,aiEditorialPlan:plan};
  await sql`insert into public.content_strategies(profile_id,objectives,platform_strategy,updated_at) values (${profileId}::uuid,'["Informare"]'::jsonb,${JSON.stringify(strategy)}::jsonb,now()) on conflict (profile_id) do update set objectives=excluded.objectives,platform_strategy=excluded.platform_strategy,updated_at=now()`;
  for(const provider of ["INSTAGRAM","FACEBOOK","LINKEDIN","GBP"]){await sql`insert into public.schedules(profile_id,provider,timezone,posts_per_week,preferred_slots,auto_choose,enabled,updated_at) values (${profileId}::uuid,${provider},'Europe/Rome',${provider==="FACEBOOK"?1:0},'[]'::jsonb,true,${provider==="FACEBOOK"},now()) on conflict (profile_id,provider) where provider is not null do update set posts_per_week=excluded.posts_per_week,enabled=excluded.enabled,updated_at=now()`;}
  return {ready:true};
}
async function cleanupUsers(sql,users){for(const user of users){await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=${user.id}`;await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id}`;await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;await sql`delete from public.app_users where auth_user_id=${user.id}`;await sql`delete from neon_auth.user where id::text=${user.id}`;}}

export default {async fetch(request,env){
  if(request.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);if(!sameSecret(request.headers.get("x-autopilot7g-token")||"",env.AUTOPILOT7G_TOKEN||""))return json({error:"FORBIDDEN"},403);
  let body;try{body=await request.json();}catch{return json({error:"INVALID_JSON"},400);}if(!validMarker(body?.marker)||!env.DATABASE_URL)return json({error:"INVALID_REQUEST"},400);const sql=neon(env.DATABASE_URL);
  try{if(body.action==="preflight"||body.action==="state")return json(await state(sql,body.marker));if(body.action==="fixture")return json(await fixture(sql,body.marker,body.profileId));if(body.action==="cleanup"||body.action==="cleanup-residue"){const users=body.action==="cleanup"?await qaUsers(sql,body.marker):await qaUsers(sql);await cleanupUsers(sql,users);return json({cleaned:true,...await state(sql,body.marker)});}return json({error:"INVALID_ACTION"},400);}catch(reason){console.error("fase7g-controller",reason instanceof Error?reason.message:"unknown");return json({error:"CONTROLLER_FAILED"},500);}
}};
