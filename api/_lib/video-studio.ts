/** Personal Video Studio: deterministic storyboard and safe render contract. No network or spending. */
export type VideoSource = { url: string; title: string; license: string; commercialUseVerified: boolean };
export type VideoScene = { id: string; startMs: number; endMs: number; kind: "AVATAR" | "BROLL" | "TITLE" | "CTA"; narration: string; overlay: string; assetId?: string };
export type VideoPlan = { version: 1; profileId: string; title: string; objective: string; format: "REEL_9_16"; width: 1080; height: 1920; fps: 30; scenes: VideoScene[]; sources: VideoSource[]; status: "DRAFT" | "REVIEW"; estimatedCloudCostEur: number };
export type VideoBrief = { profileId: string; topic: string; problem: string; solution: string; callToAction: string; sources?: VideoSource[]; cloudEstimateEur?: number };
const clean = (value: string, max = 160) => value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
export function buildVideoPlan(brief: VideoBrief): VideoPlan {
  if (!brief.profileId.trim() || !brief.topic.trim() || !brief.problem.trim() || !brief.solution.trim() || !brief.callToAction.trim()) throw new Error("VIDEO_BRIEF_INCOMPLETE");
  const cost = brief.cloudEstimateEur ?? 0;
  if (!Number.isFinite(cost) || cost < 0 || cost > 30) throw new Error("VIDEO_CLOUD_BUDGET_EXCEEDED");
  const segments: Array<[VideoScene["kind"],number,number,string,string]> = [
    ["AVATAR",0,3000,brief.topic,brief.topic],
    ["BROLL",3000,11000,brief.problem,brief.problem],
    ["AVATAR",11000,22000,brief.solution,brief.solution],
    ["CTA",22000,30000,brief.callToAction,brief.callToAction]
  ];
  return {version:1,profileId:clean(brief.profileId),title:clean(brief.topic),objective:"Generate qualified leads",format:"REEL_9_16",width:1080,height:1920,fps:30,
    scenes:segments.map(([kind,startMs,endMs,narration,overlay],i)=>({id:`scene-${i+1}`,kind,startMs,endMs,narration:clean(narration,600),overlay:clean(overlay,110)})),
    sources:brief.sources??[],status:"DRAFT",estimatedCloudCostEur:cost};
}
export function validateVideoForReview(plan: VideoPlan, assets: Record<string,{licensed:boolean;available:boolean}>, monthlyCloudSpentEur:number): string[] {
  const errors:string[]=[];
  if (plan.format!=="REEL_9_16" || plan.width!==1080 || plan.height!==1920 || plan.fps!==30) errors.push("INVALID_OUTPUT_FORMAT");
  if (!Number.isFinite(monthlyCloudSpentEur) || monthlyCloudSpentEur<0 || monthlyCloudSpentEur+plan.estimatedCloudCostEur>30) errors.push("MONTHLY_BUDGET_EXCEEDED");
  if (!plan.scenes.length || plan.scenes[0].startMs!==0) errors.push("INVALID_TIMELINE");
  for (let i=0;i<plan.scenes.length;i++){
    const scene=plan.scenes[i];
    if (scene.endMs<=scene.startMs || (i>0 && scene.startMs!==plan.scenes[i-1].endMs)) errors.push("INVALID_TIMELINE");
    if(scene.assetId && (!assets[scene.assetId]?.available || !assets[scene.assetId]?.licensed)) errors.push("ASSET_NOT_CLEARED:"+scene.assetId);
  }
  if(plan.sources.some(s=>!s.commercialUseVerified)) errors.push("SOURCE_LICENSE_UNVERIFIED");
  return [...new Set(errors)];
}
