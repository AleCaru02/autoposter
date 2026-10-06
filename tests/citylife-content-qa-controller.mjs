import { neon } from "@neondatabase/serverless";
import { runContentQa } from "../api/_lib/content-qa.js";

function json(body, status=200){
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function sameSecret(a,b){
  if(!a||!b||a.length!==b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
export default {
  async fetch(request, env){
    if(request.method!=="POST") return json({error:"METHOD_NOT_ALLOWED"},405);
    if(!sameSecret(request.headers.get("x-citylife-qa-token")||"",env.CITYLIFE_QA_TOKEN||"")) return json({error:"FORBIDDEN"},403);
    if(!env.DATABASE_URL||!env.OPENAI_API_KEY) return json({error:"NOT_CONFIGURED"},503);
    const profileId="73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
    const contentId="cefc9287-723d-425f-a2bf-d6c987687b35";
    const variantId="10dc97cd-55a0-4aca-bc7a-6522d18e51fe";
    try{
      const sql=neon(env.DATABASE_URL);
      const owners=await sql`select owner_auth_user_id::text as owner_auth_user_id from public.profiles where id=${profileId}::uuid and archived_at is null limit 1`;
      const authUserId=owners[0]?.owner_auth_user_id;
      if(!authUserId) return json({error:"PROFILE_OWNER_NOT_FOUND"},404);
      const result=await runContentQa({
        databaseUrl:env.DATABASE_URL,
        apiKey:env.OPENAI_API_KEY,
        profileId,contentId,variantId,
        actorType:"MANUAL",
        authUserId,
        force:true,
      });
      return json({
        runId:result.runId,
        overallStatus:result.overallStatus,
        visualStatus:result.visualStatus,
        brandStatus:result.brandStatus,
        copyStatus:result.copyStatus,
        factStatus:result.factStatus,
        platformStatus:result.platformStatus,
        duplicateStatus:result.duplicateStatus,
        budgetStatus:result.budgetStatus,
        feedCoherenceStatus:result.feedCoherenceStatus,
        profileTypeFitStatus:result.profileTypeFitStatus,
        subjectStrategyStatus:result.subjectStrategyStatus,
        reasons:result.reasons,
        visual:{
          assetId:result.visual?.assetId??null,
          identityStatus:result.visual?.identityStatus??null,
          verdict:result.visual?.result?.verdict??null,
          checks:result.visual?.result?.checks??null,
          scores:result.visual?.result?.scores??null,
          reason:result.visual?.result?.reason??null,
          model:result.visual?.result?.model??null
        }
      });
    }catch(error){
      const detail=error instanceof Error?error.message:"CONTENT_QA_FAILED";
      console.error("CITYLIFE_QA_FAIL",detail);
      return json({error:detail.split(":")[0]},500);
    }
  }
};