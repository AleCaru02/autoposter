/** Authenticated job status. Read-only; does not launch paid work. */
import { neon } from "@neondatabase/serverless";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";
export async function handleVideoJobStatus(request:Request,env:{DATABASE_URL?:string}):Promise<Response>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
  if(request.method!=="GET")return json({error:"METHOD_NOT_ALLOWED"},405);
  if(!env.DATABASE_URL)return json({error:"DATABASE_NOT_CONFIGURED"},503);
  const url=new URL(request.url),profileId=url.searchParams.get("profileId"),jobId=url.searchParams.get("jobId");
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!profileId||!jobId||!uuid.test(profileId)||!uuid.test(jobId))return json({error:"INVALID_JOB_QUERY"},400);
  const token=bearerValue(request.headers.get("authorization"));
  const user=token?await verifiedCustomerAuthUserId(token,env.DATABASE_URL):null;
  if(!user)return json({error:"UNAUTHORIZED"},401);
  try{
    const sql=neon(env.DATABASE_URL);
    const rows=await sql`select j.id::text as id,j.state,j.error_code,j.created_at,j.updated_at,
      j.actual_eur,j.reserved_eur,j.output_key
      from public.video_studio_jobs j join public.profiles p on p.id=j.profile_id
      where j.id=${jobId}::uuid and j.profile_id=${profileId}::uuid
      and p.owner_auth_user_id=${user} and p.archived_at is null limit 1`;
    if(!rows.length)return json({error:"JOB_NOT_FOUND"},404);
    const job=rows[0];
    return json({job:{id:job.id,state:job.state,errorCode:job.error_code,
      createdAt:job.created_at,updatedAt:job.updated_at,
      actualCostEur:job.actual_eur,reservedCostEur:job.reserved_eur,
      previewPath:job.state==="READY"&&job.output_key?
        `/api/video-studio/media/${profileId}/${jobId}/output.mp4`:null}});
  }catch{return json({error:"VIDEO_JOBS_NOT_AVAILABLE"},503);}
}
