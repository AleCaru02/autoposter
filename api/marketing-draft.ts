import type { VercelRequest,VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { ActivityBudgetEngine } from "./_lib/activity-budget.js";
import { TextGenerationMetering } from "./_lib/text-generation-metering.js";
import { verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";
import { loadEditorialProfile,loadProfileBrandContext } from "./_lib/personal-brand-sources.js";
import { estimateTerraCostUsd } from "./_lib/openai-text.js";
import { marketingRequest,marketingPrompt,marketingOutput,MARKETING_INSTRUCTIONS,MARKETING_MODEL,MARKETING_MAX_OUTPUT } from "./_lib/marketing-draft.js";
export const config={maxDuration:60};
export default async function handler(req:VercelRequest,res:VercelResponse){
  res.setHeader("cache-control","no-store");
  if(req.method!=="POST")return res.status(405).json({error:"METHOD_NOT_ALLOWED"});
  const token=req.headers.authorization?.startsWith("Bearer ")?req.headers.authorization.slice(7).trim():"";
  if(!token)return res.status(401).json({error:"AUTH_REQUIRED"});
  const operation=req.headers["x-post-automatici-operation-id"];
  if(typeof operation!=="string"||!/^marketing:[a-f0-9-]{36}$/i.test(operation))return res.status(400).json({error:"OPERATION_ID_REQUIRED"});
  const databaseUrl=process.env.DATABASE_URL,apiKey=process.env.OPENAI_API_KEY;
  if(!databaseUrl||!apiKey)return res.status(503).json({error:"MARKETING_AI_NOT_CONFIGURED"});
  let input:ReturnType<typeof marketingRequest>;
  try{input=marketingRequest(req.body);}catch{return res.status(400).json({error:"MARKETING_INPUT_INVALID"});}
  let meter:TextGenerationMetering|null=null,eventId:string|null=null,committed=false;
  try{
    const owner=await verifiedCustomerAuthUserId(token,databaseUrl);
    if(!owner)return res.status(401).json({error:"AUTH_REQUIRED"});
    const sql=neon(databaseUrl);
    const profile=await loadEditorialProfile(sql,input.profileId,owner);
    const {brand}=await loadProfileBrandContext(sql,profile);
    const {profileId,...brief}=input;
    const prompt=marketingPrompt(brief,brand);
    // Conservative byte-based input token upper bound; no external tools or retries.
    const reserveUsd=estimateTerraCostUsd(new TextEncoder().encode(prompt+MARKETING_INSTRUCTIONS).length+1500,MARKETING_MAX_OUTPUT);
    meter=new TextGenerationMetering(databaseUrl);
    const reserved=await meter.reserve({profileId,source:"MANUAL",operationIdentity:operation,requestFingerprint:{kind:"MARKETING_DRAFT_V1",...brief}});
    if(reserved.status==="DENIED")return res.status(429).json({error:reserved.code});
    if(reserved.status==="COMPLETED")return res.status(200).json(reserved.cached.response);
    if(reserved.status!=="RESERVED")return res.status(409).json({error:reserved.status==="IN_PROGRESS"?"GENERATION_IN_PROGRESS":"MARKETING_OPERATION_RELEASED"});
    eventId=reserved.eventId;
    const budget=await new ActivityBudgetEngine(databaseUrl).preflight({profileId,task:"COPY_FINAL",importance:"STANDARD",projectedOperationCostUsd:reserveUsd});
    if(!budget.allowed){await meter.release(eventId,budget.reason??"AI_BUDGET_HARD_STOP");return res.status(429).json({error:budget.reason??"AI_BUDGET_HARD_STOP"});}
    await meter.markProviderStarted(eventId,reserveUsd);
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{authorization:"Bearer "+apiKey,"content-type":"application/json"},signal:AbortSignal.timeout(45000),body:JSON.stringify({model:MARKETING_MODEL,store:false,reasoning:{effort:"low"},max_output_tokens:MARKETING_MAX_OUTPUT,instructions:MARKETING_INSTRUCTIONS,input:prompt})});
    if(!response.ok)throw new Error("MARKETING_PROVIDER_"+response.status);
    const body=await response.json() as {usage?:{input_tokens?:number;output_tokens?:number}};
    const inputTokens=body.usage?.input_tokens,outputTokens=body.usage?.output_tokens;
    const actual=typeof inputTokens==="number"&&typeof outputTokens==="number"?estimateTerraCostUsd(inputTokens,outputTokens):null;
    await meter.persistTechnicalEvents(profileId,eventId,[{operation:"GENERATE_SOCIAL_TEXT",model:MARKETING_MODEL,inputTokens:inputTokens??null,outputTokens:outputTokens??null,costUsd:actual,metadata:{source:"MANUAL",purpose:"MARKETING_DRAFT",channel:input.channel}}]);
    const result={draft:marketingOutput(body),channel:input.channel,model:MARKETING_MODEL,estimatedCostUsd:actual,reviewRequired:true,externalActionsExecuted:false};
    await meter.storeResult(eventId,{response:result});
    await meter.commit(eventId);committed=true;
    return res.status(200).json(result);
  }catch(reason){
    if(meter&&eventId&&!committed)await meter.release(eventId,"MARKETING_GENERATION_FAILED").catch(()=>undefined);
    const code=reason instanceof Error?reason.message:"";
    if(code==="PROFILE_NOT_FOUND")return res.status(404).json({error:code});
    if(code==="PROVIDER_COST_BUDGET_REACHED")return res.status(429).json({error:code});
    return res.status(502).json({error:"MARKETING_GENERATION_FAILED"});
  }
}
