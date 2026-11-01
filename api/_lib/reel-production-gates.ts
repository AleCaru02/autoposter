import {buildVideoPlan, validateVideoForReview, type VideoPlan} from "./video-studio.js";

/** A reviewable Reel brief; this function does not pretend to have called an AI model. */
export type ReelStrategy = {
  profileId:string; audience:string; topic:string; problem:string; solution:string;
  callToAction:string; caption:string; narrationVoice:string;
};
export function prepareReelForReview(input:{
  strategy:ReelStrategy;
  assets:Record<string,{licensed:boolean;available:boolean}>;
  monthlySpentEur:number;
  estimatedAdditionalEur:number;
  narrationReady:boolean;
  subtitlesReady:boolean;
}):{plan:VideoPlan;status:"BLOCKED"|"AWAITING_APPROVAL";errors:string[];caption:string;audience:string}{
  const s=input.strategy;
  if (![s.profileId,s.audience,s.topic,s.problem,s.solution,s.callToAction,s.caption,s.narrationVoice]
    .every(v=>typeof v==="string"&&v.trim().length>0)) throw new Error("REEL_STRATEGY_INCOMPLETE");
  const plan=buildVideoPlan({profileId:s.profileId,topic:s.topic,problem:s.problem,solution:s.solution,
    callToAction:s.callToAction,cloudEstimateEur:input.estimatedAdditionalEur});
  const errors=validateVideoForReview(plan,input.assets,input.monthlySpentEur);
  if (!input.narrationReady) errors.push("NARRATION_NOT_READY");
  if (!input.subtitlesReady) errors.push("SUBTITLES_NOT_READY");
  for (const scene of plan.scenes) {
    if (!input.assets[scene.id]?.available || !input.assets[scene.id]?.licensed) errors.push("SCENE_ASSET_NOT_CLEARED:"+scene.id);
    if (scene.overlay.length>90) errors.push("OVERLAY_TOO_LONG:"+scene.id);
  }
  return {plan,status:errors.length?"BLOCKED":"AWAITING_APPROVAL",errors,
    caption:s.caption,audience:s.audience};
}
export function approveReelForPublishing(input:{
  status:"BLOCKED"|"AWAITING_APPROVAL";explicitHumanApproval:boolean;
  videoQaPassed:boolean;budgetReconciled:boolean;
}):boolean{
  return input.status==="AWAITING_APPROVAL" && input.explicitHumanApproval &&
    input.videoQaPassed && input.budgetReconciled;
}
