import { neon } from "@neondatabase/serverless";
import { runContentQa } from "../api/_lib/content-qa.js";

function json(body,status=200,requestId=null){
  const headers={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
  if(requestId) headers["x-citylife-qa-request-id"]=requestId;
  return new Response(JSON.stringify(body),{status,headers});
}
function sameSecret(a,b){
  if(!a||!b||a.length!==b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function safeError(error){
  const raw=error instanceof Error?error.message:"CONTENT_QA_FAILED";
  const message=String(raw)
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi,"[REDACTED_DATABASE_URL]")
    .replace(/https?:\/\/[^\s"'<>]+/gi,"[REDACTED_URL]")
    .replace(/\b(?:sk|hf)_[A-Za-z0-9_-]{8,}\b/g,"[REDACTED_SECRET]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,"[REDACTED_SECRET]")
    .replace(/(password|token|secret|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi,"$1=[REDACTED]")
    .slice(0,500);
  const rawCode=error&&typeof error==="object"&&"code" in error?String(error.code??""):"";
  const code=rawCode.replace(/[^A-Za-z0-9_.-]/g,"").slice(0,64)||null;
  return {
    type:error instanceof Error?error.name:"Error",
    code,
    message:message||"CONTENT_QA_FAILED"
  };
}
export default {
  async fetch(request, env){
    const requestId=crypto.randomUUID();
    if(request.method!=="POST") return json({error:"METHOD_NOT_ALLOWED",requestId},405,requestId);
    if(!sameSecret(request.headers.get("x-citylife-qa-token")||"",env.CITYLIFE_QA_TOKEN||"")) return json({error:"FORBIDDEN",requestId},403,requestId);
    if(!env.DATABASE_URL||!env.OPENAI_API_KEY) return json({error:"NOT_CONFIGURED",requestId},503,requestId);
    const profileId="73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
    const contentId="cefc9287-723d-425f-a2bf-d6c987687b35";
    const variantId="10dc97cd-55a0-4aca-bc7a-6522d18e51fe";
    try{
      const sql=neon(env.DATABASE_URL);
      const owners=await sql`select owner_auth_user_id::text as owner_auth_user_id from public.profiles where id=${profileId}::uuid and archived_at is null limit 1`;
      const authUserId=owners[0]?.owner_auth_user_id;
      if(!authUserId) return json({error:"PROFILE_OWNER_NOT_FOUND",requestId},404,requestId);
      const result=await runContentQa({
        databaseUrl:env.DATABASE_URL,
        apiKey:env.OPENAI_API_KEY,
        profileId,contentId,variantId,
        actorType:"MANUAL",
        authUserId,
        force:true,
      });
      return json({
        profileId,
        contentId,
        variantId,
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
      },200,requestId);
    }catch(error){
      const detail=safeError(error);
      console.error("CITYLIFE_QA_FAIL",JSON.stringify({requestId,...detail}));
      return json({error:"CONTENT_QA_FAILED",...detail,requestId},500,requestId);
    }
  }
};
