import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { runContentAutopilotSerialized } from "./_lib/autopilot-serialized.js";
import { recoverWasmCanaryImage } from "./_lib/autopilot-image-recovery.js";

export const config = { maxDuration: 300 };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANARY_WINDOW_MS=24*60*60*1000;

/** Free, deterministic guard. The canary is permanently inert after 24 hours. */
export function canaryWindow(env: {
  AUTOPILOT_RETEST_PROFILE_ID?: string;
  AUTOPILOT_RETEST_CUTOFF_UTC?: string;
}, now=new Date()) {
  const profileId=env.AUTOPILOT_RETEST_PROFILE_ID||"";
  const cutoff=Date.parse(env.AUTOPILOT_RETEST_CUTOFF_UTC||"");
  if (!UUID.test(profileId)) return {ready:false as const,reason:"CANARY_PROFILE_MISSING"};
  if (!Number.isFinite(cutoff) || cutoff>now.getTime() || now.getTime()-cutoff>=CANARY_WINDOW_MS) {
    return {ready:false as const,reason:"CANARY_WINDOW_CLOSED"};
  }
  return {ready:true as const,profileId,cutoffUtc:new Date(cutoff).toISOString()};
}

function authorized(req:VercelRequest,secret:string|undefined) {
  const raw=req.headers.authorization;
  const token=raw?.startsWith("Bearer ")?raw.slice(7).trim():"";
  if (!secret||!token) return false;
  const expected=Buffer.from(secret,"utf8"),provided=Buffer.from(token,"utf8");
  return expected.length===provided.length&&timingSafeEqual(expected,provided);
}
export default async function handler(req:VercelRequest,res:VercelResponse) {
  res.setHeader("cache-control","no-store");
  if (req.method!=="GET") return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  if (!process.env.CRON_SECRET) return res.status(503).json({error:"CRON_NOT_CONFIGURED"});
  if (!authorized(req,process.env.CRON_SECRET)) return res.status(401).json({error:"UNAUTHORIZED_CRON"});
  const scope=canaryWindow(process.env);
  if (!scope.ready) return res.status(200).json({ok:true,canary:"INERT",reason:scope.reason});
  const databaseUrl=process.env.DATABASE_URL;
  const apiKey=process.env.OPENAI_API_KEY;
  if (!databaseUrl||!apiKey) return res.status(503).json({error:"CANARY_PROVIDER_NOT_CONFIGURED"});
  try {
    const sql=neon(databaseUrl);
    // Any provider attempt after the release cutoff consumes the only trial,
    // whether it succeeded, failed QA, or was rejected by a third party.
    const rows=await sql`
      select count(*)::int as n from public.capability_usage_events
      where profile_id=${scope.profileId}::uuid
        and source='AI_TEXT_AUTOPILOT' and capability_key='ai.content.generate_text'
        and created_at>=${scope.cutoffUtc}::timestamptz
    ` as unknown as Array<{n:number}>;
    if (Number(rows[0]?.n)>0) {
      // Do not generate new copy. Recover only the image blocked before any provider charge.
      // Same 24-hour canary, one idempotent image attempt, bounded spend and full QA.
      const imageRecovery = await recoverWasmCanaryImage({
        DATABASE_URL: databaseUrl, OPENAI_API_KEY: apiKey,
        BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
        AUTOPILOT_RETEST_PROFILE_ID: scope.profileId,
        AUTOPILOT_RETEST_CUTOFF_UTC: scope.cutoffUtc,
      }).catch(() => ({state:"RECOVERY_RUNTIME_FAILED"}));
      const code = "code" in imageRecovery && typeof imageRecovery.code === "string"
        ? /^(?:OPENAI_[A-Z0-9_]+|CONTENT_QA_[A-Z0-9_]+|AI_BUDGET_[A-Z0-9_]+|VISUAL_QA_[A-Z0-9_]+|POSTGRES_[A-Z0-9_]+|QA_[A-Z0-9_]+)$/.test(imageRecovery.code) ? imageRecovery.code : "QA_ERROR" : null;
      console.log("vercel.autopilot-image-recovery",{state:imageRecovery.state,code});
      return res.status(200).json({ok:true,canary:"CONSUMED",imageRecovery:{state:imageRecovery.state}});
    }
    const result=await runContentAutopilotSerialized({
      DATABASE_URL:databaseUrl,OPENAI_API_KEY:apiKey,
      OPENAI_TEXT_MONTHLY_BUDGET_USD:process.env.OPENAI_TEXT_MONTHLY_BUDGET_USD,
      OPENAI_IMAGE_MONTHLY_LIMIT:process.env.OPENAI_IMAGE_MONTHLY_LIMIT,
      HF_CREDENTIALS:process.env.HF_CREDENTIALS,
      AUTOPILOT_RETEST_PROFILE_ID:scope.profileId,
      AUTOPILOT_RETEST_CUTOFF_UTC:scope.cutoffUtc,
    },{profileId:scope.profileId,maxGenerations:1});
    const errorCodes=[...new Set(result.errors.map((message)=>{
      const code=/(AUTOPILOT_[A-Z0-9_]+|OPENAI_[A-Z0-9_]+|AI_BUDGET_[A-Z0-9_]+)/.exec(message);
      return code?.[1]||"AUTOPILOT_CANARY_OTHER_ERROR";
    }))].slice(0,4);
    console.log("vercel.autopilot-canary",{
      generated:result.generated,scheduled:result.scheduled,
      blockedForReview:result.blockedForReview,skipped:result.skipped,
      errorCodes,
    });
    return res.status(200).json({ok:true,canary:"ATTEMPTED",generated:result.generated,
      scheduled:result.scheduled,blockedForReview:result.blockedForReview,errorCodes});
  }catch(error){
    console.error("vercel.autopilot-canary",{code:"AUTOPILOT_CANARY_FAILED"});
    return res.status(500).json({error:"AUTOPILOT_CANARY_FAILED"});
  }
}
