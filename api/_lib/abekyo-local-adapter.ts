/** Abekyo local-only rendering bridge. Server-side use only. */
import type { VideoPlan } from "./video-studio.js";
export type AbekyoConfig = { baseUrl: string; enabled: boolean; timeoutMs?: number };
export type AbekyoResult = { status: "VALIDATED" | "RENDERED"; response: unknown };
export function assertLocalAbekyoUrl(url: string): string {
  const u=new URL(url);
  if(u.protocol!=="http:" || !["127.0.0.1","localhost","[::1]"].includes(u.hostname) || u.username || u.password || u.search || u.hash || (u.pathname!=="/" && u.pathname!=="")) throw new Error("ABE KYO_LOCAL_ONLY".replace(" ",""));
  return u.origin;
}
export function toAbekyoDraft(plan: VideoPlan): { plan: VideoPlan; instructions: string[] } {
  if(plan.format!=="REEL_9_16") throw new Error("INVALID_VIDEO_FORMAT");
  // The upstream schema must be fetched and validated before translation.
  // Never claim this object is an Abekyo project or send it to /api/render.
  return {plan,instructions:["Upload licensed assets to the local editor","Read /schema/project.schema.json","Map scenes to schema-compliant clips","POST /api/project/validate before rendering"]};
}
export async function checkAbekyoLocal(config: AbekyoConfig, fetcher: typeof fetch = fetch): Promise<unknown> {
  if(!config.enabled) throw new Error("ABE KYO_DISABLED".replace(" ",""));
  const origin=assertLocalAbekyoUrl(config.baseUrl);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),Math.min(Math.max(config.timeoutMs??5000,100),15000));
  try{
    const response=await fetcher(origin+"/schema/project.schema.json",{signal:controller.signal,redirect:"error"});
    if(!response.ok) throw new Error("ABE KYO_SCHEMA_UNAVAILABLE".replace(" ",""));
    return response.json();
  } finally {clearTimeout(timeout);}
}
