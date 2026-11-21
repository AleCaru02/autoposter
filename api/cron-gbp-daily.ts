import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { resolveGbpDailyDraftConfig } from "./_lib/gbp-daily-draft.js";
import { runContentAutopilotSerialized } from "./_lib/autopilot-serialized.js";

export const config = { maxDuration: 300 };

function cronAuthorized(header: string | string[] | undefined, secret: string | undefined) {
  if(!secret || typeof header!=="string" || !header.startsWith("Bearer ")) return false;
  const received=Buffer.from(header.slice(7).trim(),"utf8");
  const expected=Buffer.from(secret,"utf8");
  return received.length===expected.length && timingSafeEqual(received,expected);
}

export default async function handler(req:VercelRequest,res:VercelResponse) {
  res.setHeader("cache-control","no-store");
  if(req.method!=="GET") return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  if(!cronAuthorized(req.headers.authorization,process.env.CRON_SECRET))
    return res.status(401).json({error:"UNAUTHORIZED_CRON"});
  const scope=resolveGbpDailyDraftConfig(process.env);
  if("reason" in scope)
    return res.status(scope.reason==="DISABLED"?200:503).json({ready:false,reason:scope.reason});
  if(!process.env.DATABASE_URL || !process.env.OPENAI_API_KEY)
    return res.status(503).json({ready:false,reason:"AI_RUNTIME_NOT_CONFIGURED"});
  try {
    // Budget limits, failure breaker and connection verification still apply.
    // This is a draft-only path; only the account owner may approve a post.
    const result=await runContentAutopilotSerialized({
      DATABASE_URL:process.env.DATABASE_URL,
      OPENAI_API_KEY:process.env.OPENAI_API_KEY,
      AUTOPILOT_RETEST_PROFILE_ID:process.env.AUTOPILOT_RETEST_PROFILE_ID,
      AUTOPILOT_RETEST_CUTOFF_UTC:process.env.AUTOPILOT_RETEST_CUTOFF_UTC,
    },{
      profileId:scope.profileId,
      providerFilter:"GBP",
      maxGenerations:1,
      generateImagesBeforeApproval:true,
      dailyGbpSchedule:true,
    });
    const reasons=[...new Set(result.errors.map(value=>
      (/:(AUTOPILOT_[A-Z0-9_]+|OPENAI_[A-Z0-9_]+|AI_BUDGET_[A-Z0-9_]+)/.exec(value)?.[1]??"DRAFT_FAILED")
    ))].slice(0,3);
    return res.status(200).json({
      ok:result.errors.length===0 && result.profilesChecked===1,
      profilesChecked:result.profilesChecked,
      draftsGenerated:result.generated,
      pendingOwnerReview:result.blockedForReview,
      published:0,
      reasons:reasons.length?reasons:result.profilesChecked===0?["GBP_CONNECTION_NOT_READY"]:[],
    });
  } catch {
    console.error("gbp.daily_draft",{code:"DRAFT_PIPELINE_FAILED"});
    return res.status(500).json({error:"DRAFT_PIPELINE_FAILED"});
  }
}
