import { neon } from "@neondatabase/serverless";
import { runContentQa } from "../api/_lib/content-qa.js";
import { socialSafeModeState, type SocialEnv } from "../api/_lib/social.js";

type Env = Pick<SocialEnv,"SAFE_MODE"> & {
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
  PREPUBLISH_QA_TOKEN?: string;
};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}

function authorized(request:Request,env:Env){
  const expected=env.PREPUBLISH_QA_TOKEN?.trim();
  if(!expected) return false;
  return request.headers.get("x-prepublish-qa-token")?.trim()===expected;
}

export async function handleControlledPrepublishQa(request:Request,env:Env){
  if(!env.PREPUBLISH_QA_TOKEN) return json({error:"API_NOT_FOUND"},404);
  if(request.method!=="POST") return json({error:"METHOD_NOT_ALLOWED"},405);
  if(!authorized(request,env)) return json({error:"API_NOT_FOUND"},404);
  if(socialSafeModeState(env)!=="ON") return json({error:"SAFE_MODE_REQUIRED"},409);
  if(!env.DATABASE_URL) return json({error:"DATABASE_NOT_CONFIGURED"},503);
  if(!env.OPENAI_API_KEY) return json({error:"OPENAI_NOT_CONFIGURED"},503);

  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const profileId=typeof body?.profileId==="string"?body.profileId:"";
  const contentId=typeof body?.contentId==="string"?body.contentId:"";
  const variantId=typeof body?.variantId==="string"?body.variantId:"";
  if(![profileId,contentId,variantId].every((value)=>UUID.test(value))) return json({error:"CONTENT_QA_INPUT_INVALID"},400);

  const sql=neon(env.DATABASE_URL);
  const rows=await sql`
    select j.id::text as job_id
    from public.publication_jobs j
    join public.content_variants v on v.id=j.variant_id and v.profile_id=j.profile_id
    where j.profile_id=${profileId}::uuid
      and j.variant_id=${variantId}::uuid
      and v.content_id=${contentId}::uuid
      and j.state='BLOCKED_APPROVAL'
      and j.execution_mode='REAL_EXTERNAL'
      and j.attempt_count=0
      and j.remote_post_id is null
      and j.published_at is null
      and v.approval_mode='MANUAL'
      and v.approval_status='PENDING'
      and v.workflow_status in ('REVIEW','REVIEW_REQUIRED')
      and v.approved_by is null
      and v.approved_at is null
      and v.external_post_id is null
      and v.published_at is null
    limit 1
  ` as unknown as Array<{job_id:string}>;
  if(!rows[0]) return json({error:"PREPUBLISH_CANDIDATE_NOT_SAFE"},409);

  try{
    const qa=await runContentQa({
      databaseUrl:env.DATABASE_URL,
      apiKey:env.OPENAI_API_KEY,
      profileId,
      contentId,
      variantId,
      actorType:"SYSTEM",
      authUserId:null,
      force:true,
    });
    return json({safeMode:true,publicationJobId:rows[0].job_id,qa});
  }catch(reason){
    const code=reason instanceof Error?reason.message.split(":")[0]:"CONTENT_QA_FAILED";
    console.error("controlled-prepublish-qa",{profileId,contentId,variantId,code});
    return json({error:code},500);
  }
}
