import { parseHiggsfieldCredentials } from "./higgsfield.js";

/**
 * Opt-in paid video generation adapter for a future Reel pipeline.
 * NOT a Reel publisher and never called by the existing Autopilot schedule.
 * Live requests require a provider-side quote and an explicit budget authorization.
 *
 * Provider contract:
 * https://open.higgsfield.ai/models/kling-video/v4.0/text-to-video/api-reference
 */
export type ReelProviderEnv = { HF_CREDENTIALS?:string; HF_VIDEO_ENABLED?:string };
export type ReelClipRequest = {
  prompt:string;
  durationSeconds:number;
  resolution:"720p"|"1080p";
  quotedCostUsd:number;
  authorizedMaxCostUsd:number;
};
export type ReelVideoJob = {requestId:string;statusUrl:string;status:"queued"|"in_progress"|"completed"};
export type ReelVideoPoll = {requestId:string;status:string;videoUrl:string|null;errorCode:string|null};

const HOST="https://api.higgsfield.ai";
const MODEL="kling-video/v4.0/text-to-video";
const VALID_ID=/^[a-zA-Z0-9_-]{1,128}$/;

function assertCredentials(env:ReelProviderEnv) {
  if(env.HF_VIDEO_ENABLED!=="true")throw new Error("REEL_PROVIDER_DISABLED");
  const credentials=parseHiggsfieldCredentials(env.HF_CREDENTIALS);
  if(!credentials)throw new Error("REEL_PROVIDER_NOT_CONFIGURED");
  return `Key ${credentials.keyId}:${credentials.keySecret}`;
}
function validJobId(input:unknown) {
  if(typeof input!=="string"||!VALID_ID.test(input))throw new Error("REEL_PROVIDER_JOB_ID_INVALID");
  return input;
}
export function validateReelProviderQuote(input:ReelClipRequest) {
  if(!input.prompt?.trim()||input.prompt.trim().length<20||input.prompt.length>2000)throw new Error("REEL_PROMPT_INVALID");
  if(!Number.isInteger(input.durationSeconds)||input.durationSeconds<3||input.durationSeconds>30)throw new Error("REEL_DURATION_INVALID");
  if(!["720p","1080p"].includes(input.resolution))throw new Error("REEL_RESOLUTION_INVALID");
  if(!Number.isFinite(input.quotedCostUsd)||input.quotedCostUsd<=0)throw new Error("REEL_PROVIDER_QUOTE_REQUIRED");
  if(!Number.isFinite(input.authorizedMaxCostUsd)||input.authorizedMaxCostUsd<=0||input.quotedCostUsd>input.authorizedMaxCostUsd)throw new Error("REEL_BUDGET_NOT_APPROVED");
}
export async function submitHiggsfieldReel(input:{
  env:ReelProviderEnv;clip:ReelClipRequest;fetcher?:typeof fetch;
}):Promise<ReelVideoJob> {
  const auth=assertCredentials(input.env);
  validateReelProviderQuote(input.clip);
  const fetcher=input.fetcher??fetch;
  const response=await fetcher(`${HOST}/${MODEL}`,{
    method:"POST",headers:{"Authorization":auth,"Content-Type":"application/json"},
    body:JSON.stringify({
      prompt:input.clip.prompt.trim(),
      duration:input.clip.durationSeconds,
      resolution:input.clip.resolution,
      aspect_ratio:"9:16",
    }),
  });
  if(!response.ok)throw new Error(`REEL_PROVIDER_SUBMIT_HTTP_${response.status}`);
  const body=await response.json() as Record<string,unknown>;
  const requestId=validJobId(body.request_id);
  const status=typeof body.status==="string"?body.status.toLowerCase():"queued";
  if(!["queued","in_progress","completed"].includes(status))throw new Error("REEL_PROVIDER_SUBMIT_STATE_INVALID");
  // Construct the request endpoint locally instead of trusting an unverified external status_url.
  const statusUrl=`${HOST}/requests/${encodeURIComponent(requestId)}/status`;
  return {requestId,statusUrl,status:status as ReelVideoJob["status"]};
}
export async function pollHiggsfieldReel(input:{env:ReelProviderEnv;requestId:string;fetcher?:typeof fetch}):Promise<ReelVideoPoll> {
  const auth=assertCredentials(input.env);
  const id=validJobId(input.requestId);
  const response=await (input.fetcher??fetch)(`${HOST}/requests/${encodeURIComponent(id)}/status`,{headers:{"Authorization":auth}});
  if(!response.ok)throw new Error(`REEL_PROVIDER_STATUS_HTTP_${response.status}`);
  const body=await response.json() as Record<string,unknown>;
  const status=typeof body.status==="string"?body.status.toLowerCase():"unknown";
  if(!["queued","in_progress","completed","failed","nsfw","canceled"].includes(status))throw new Error("REEL_PROVIDER_STATUS_UNKNOWN");
  const video=body.video&&typeof body.video==="object"?body.video as Record<string,unknown>:{};
  const remote=typeof video.url==="string"?video.url:"";
  let videoUrl:string|null=null;
  if(status==="completed"){
    try {const url=new URL(remote);if(url.protocol!=="https:")throw Error("not https");videoUrl=url.toString();}
    catch {throw new Error("REEL_PROVIDER_VIDEO_URL_INVALID");}
  }
  const error=body.error;
  return {requestId:id,status,videoUrl,errorCode:error&&typeof error==="object"&&typeof (error as Record<string,unknown>).code==="string"?(error as Record<string,string>).code:null};
}

/** Provider video bytes MUST be transcoded/validated, durably stored and approved
 * before calling Meta. URL-only provider responses never count as published Reel. */
export function reelMediaPreflight(input:{mimeType:string;durationSeconds:number;width:number;height:number;videoCodec:string;audioCodec:string;sizeBytes:number}) {
  const errors:string[]=[];
  if(!["video/mp4","video/quicktime"].includes(input.mimeType.split(";")[0].toLowerCase().trim()))errors.push("REEL_CONTAINER_INVALID");
  if(!["h264","hevc"].includes(input.videoCodec.toLowerCase()))errors.push("REEL_VIDEO_CODEC_INVALID");
  if(input.audioCodec.toLowerCase()!=="aac")errors.push("REEL_AUDIO_CODEC_INVALID");
  if(!Number.isFinite(input.durationSeconds)||input.durationSeconds<3||input.durationSeconds>900)errors.push("REEL_DURATION_UNSUPPORTED");
  if(!Number.isInteger(input.width)||input.width<1||input.width>1920||!Number.isInteger(input.height)||input.height<1)errors.push("REEL_DIMENSIONS_INVALID");
  if(!Number.isFinite(input.sizeBytes)||input.sizeBytes<=0||input.sizeBytes>1_000_000_000)errors.push("REEL_FILE_SIZE_INVALID");
  return {ready:errors.length===0,errors};
}
