/** Private R2 media API. Fail closed until VIDEO_MEDIA binding is provisioned. */
import { neon } from "@neondatabase/serverless";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type MediaBucket = {
  put(key:string, value:ReadableStream|ArrayBuffer|Uint8Array,options?:{httpMetadata?:{contentType?:string}}):Promise<unknown>;
  get(key:string):Promise<{body:ReadableStream;httpMetadata?:{contentType?:string}}|null>;
};
export type VideoMediaEnv = {DATABASE_URL?:string;VIDEO_MEDIA?:MediaBucket};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sceneId=/^scene-[1-9][0-9]{0,2}$/;
async function context(request:Request,env:VideoMediaEnv,profileId:string){
  if(!env.DATABASE_URL||!env.VIDEO_MEDIA)return null;
  const token=bearerValue(request.headers.get("authorization"));
  if(!token)return null;
  const user=await verifiedCustomerAuthUserId(token,env.DATABASE_URL);
  if(!user)return null;
  const sql=neon(env.DATABASE_URL);
  const rows=await sql`select id::text as id from public.profiles where id=${profileId}::uuid and owner_auth_user_id=${user} and archived_at is null limit 1`;
  return rows.length?true:null;
}
/** PUT scene PNG, GET scene PNG or finished MP4. Never exposes R2 credentials or public URLs. */
export async function handleVideoMedia(request:Request,env:VideoMediaEnv):Promise<Response>{
  if(!env.VIDEO_MEDIA||!env.DATABASE_URL)return respond({error:"VIDEO_MEDIA_NOT_CONFIGURED"},503);
  const url=new URL(request.url);
  const parts=url.pathname.split("/").filter(Boolean);
  // /api/video-studio/media/:profileId/:jobId/:sceneId.png
  // /api/video-studio/media/:profileId/:jobId/output.mp4
  if(parts.length!==6||parts[0]!=="api"||parts[1]!=="video-studio"||parts[2]!=="media")
    return respond({error:"INVALID_MEDIA_PATH"},404);
  const [, , ,profileId,jobId,file]=parts;
  if(!uuid.test(profileId)||!uuid.test(jobId)||!(file==="output.mp4"||(file.endsWith(".png")&&sceneId.test(file.slice(0,-4)))))
    return respond({error:"INVALID_MEDIA_PATH"},400);
  try{
    if(!await context(request,env,profileId))return respond({error:"NOT_FOUND"},404);
    const sql=neon(env.DATABASE_URL);
    const jobs=await sql`select state from public.video_studio_jobs where id=${jobId}::uuid and profile_id=${profileId}::uuid limit 1`;
    if(!jobs.length)return respond({error:"JOB_NOT_FOUND"},404);
    const key=`video-studio/${profileId}/${jobId}/${file}`;
    if(request.method==="PUT"){
      if(file==="output.mp4")return respond({error:"RENDER_WORKER_ONLY"},403);
      if(!["QUEUED","GENERATING"].includes(String(jobs[0].state)))return respond({error:"JOB_NOT_EDITABLE"},409);
      if(request.headers.get("content-type")?.split(";")[0]!=="image/png")return respond({error:"PNG_REQUIRED"},415);
      const bytes=await request.arrayBuffer();
      if(bytes.byteLength<8||bytes.byteLength>8*1024*1024)return respond({error:"IMAGE_SIZE_INVALID"},413);
      const magic=new Uint8Array(bytes.slice(0,8));
      if([137,80,78,71,13,10,26,10].some((v,i)=>magic[i]!==v))return respond({error:"INVALID_PNG"},415);
      await env.VIDEO_MEDIA.put(key,bytes,{httpMetadata:{contentType:"image/png"}});
      return respond({stored:true,file},201);
    }
    if(request.method==="GET"){
      if(file==="output.mp4"&&jobs[0].state!=="READY")return respond({error:"VIDEO_NOT_READY"},409);
      const object=await env.VIDEO_MEDIA.get(key);
      if(!object)return respond({error:"MEDIA_NOT_FOUND"},404);
      return new Response(object.body,{headers:{"content-type":file.endsWith(".mp4")?"video/mp4":"image/png","cache-control":"private, no-store","x-content-type-options":"nosniff"}});
    }
    return respond({error:"METHOD_NOT_ALLOWED"},405);
  }catch{return respond({error:"VIDEO_MEDIA_REQUEST_FAILED"},500);}
}
