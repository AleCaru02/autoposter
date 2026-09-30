import { neon } from "@neondatabase/serverless";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";
import { runProfileSmmCertificationSimulation } from "../api/_lib/profile-smm-certification.js";

type Env={DATABASE_URL?:string};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function object(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function strings(value:unknown){return Array.isArray(value)?value.filter((v):v is string=>typeof v==="string"&&Boolean(v.trim())).map((v)=>v.trim()):[];}
function summary(value:unknown){const s=object(value).summary;return typeof s==="string"&&s.trim()?s.trim():null;}

export async function handleProfileSmmCertification(request:Request,env:Env){
  if(request.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
  if(!env.DATABASE_URL)return json({error:"DATABASE_NOT_CONFIGURED"},503);
  const token=bearerValue(request.headers.get("authorization"));
  if(!token)return json({error:"UNAUTHENTICATED"},401);
  const authUserId=await verifiedCustomerAuthUserId(token,env.DATABASE_URL);
  if(!authUserId)return json({error:"UNAUTHENTICATED"},401);
  let profileId="";
  try{const body=await request.json() as Record<string,unknown>;profileId=typeof body.profileId==="string"?body.profileId:"";}catch{}
  if(!/^[0-9a-f-]{36}$/i.test(profileId))return json({error:"PROFILE_REQUIRED"},400);

  const sql=neon(env.DATABASE_URL);
  const profiles=await sql`
    select p.id::text,p.name,p.industry,p.profile_type,b.description,b.business_model,b.target_audience,b.goals
    from public.profiles p
    left join public.brand_profiles b on b.profile_id=p.id
    where p.id=${profileId}::uuid and p.owner_auth_user_id=${authUserId} and p.archived_at is null
    limit 1
  ` as unknown as Array<{id:string;name:string;industry:string|null;profile_type:"BUSINESS"|"PERSONAL_BRAND";description:string|null;business_model:string|null;target_audience:unknown;goals:unknown}>;
  const profile=profiles[0];
  if(!profile)return json({error:"PROFILE_NOT_FOUND"},404);

  const strategies=await sql`
    select objectives,platform_strategy
    from public.content_strategies
    where profile_id=${profileId}::uuid
    limit 1
  ` as unknown as Array<{objectives:unknown;platform_strategy:unknown}>;
  const strategy=strategies[0];
  const aiStrategy=object(object(strategy?.platform_strategy).aiStrategy);
  const pillars=strings(aiStrategy.contentPillars);
  const effectivePillars=pillars.length?pillars:["Offerta","Processo","Esperienza","Domande frequenti"];
  const objectives=strings(strategy?.objectives);
  const goals=strings(profile.goals);
  const identities=profile.profile_type==="PERSONAL_BRAND"
    ? await sql`select status from public.personal_brand_visual_identities where profile_id=${profileId}::uuid limit 1` as unknown as Array<{status:string}>
    : [];

  const result=runProfileSmmCertificationSimulation({
    profileId,
    profileType:profile.profile_type,
    industry:profile.industry?.trim()||"Settore non specificato",
    businessModel:profile.business_model?.trim()||"Modello non specificato",
    offer:profile.description?.trim()||profile.name,
    audience:summary(profile.target_audience)||"Pubblico del profilo",
    objective:objectives[0]||goals[0]||"Costruire fiducia e generare azioni coerenti con il profilo",
    pillars:effectivePillars,
    canonicalIdentityReady:identities[0]?.status==="COMPLETED",
  },{count:20});

  await sql`
    insert into public.profile_smm_certification_runs(
      profile_id,profile_type,mode,status,simulated_content_count,critical_failure_count,gates,proof,completed_at
    ) values(
      ${profileId}::uuid,${profile.profile_type},'PROFILE_SMM_CERTIFICATION',${result.status},
      ${result.simulatedContentCount},${result.criticalFailureCount},
      ${JSON.stringify(result.gates)}::jsonb,${JSON.stringify({...result.proof,simulationOnly:true,publishingExecuted:false,providerCallsExecuted:false})}::jsonb,now()
    )
  `;

  return json(result,result.status==="PASS"?200:409);
}
