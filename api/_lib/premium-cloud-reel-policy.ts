/** Premium cloud Reel policy: reject slideshows and require licensed, reviewed motion clips. */
export type CloudScene = {
  id:string; durationSeconds:number; assetKind:"AI_VIDEO"|"LICENSED_VIDEO"|"STILL";
  assetReady:boolean; commercialRightsVerified:boolean; visualQaPassed:boolean;
};
export type CloudReel = {
  scenes:CloudScene[]; voiceReady:boolean; captionsReady:boolean; approved:boolean;
  actualCostEur:number; reservedCostEur:number; monthCommittedEur:number;
};
export function reviewPremiumCloudReel(reel:CloudReel) {
  const errors:string[]=[];
  if (!reel.scenes.length || reel.scenes.length>20) errors.push("INVALID_SCENE_COUNT");
  const duration=reel.scenes.reduce((sum,s)=>sum+s.durationSeconds,0);
  if (duration<15 || duration>60 || reel.scenes.some(s=>!Number.isFinite(s.durationSeconds)||s.durationSeconds<=0))
    errors.push("INVALID_REEL_DURATION");
  const motion=reel.scenes.filter(s=>s.assetKind!=="STILL").reduce((sum,s)=>sum+s.durationSeconds,0);
  if (motion<duration*.65) errors.push("NOT_PREMIUM_VIDEO_MOTION");
  for (const s of reel.scenes) {
    if (!s.assetReady) errors.push("ASSET_MISSING:"+s.id);
    if (!s.commercialRightsVerified) errors.push("RIGHTS_UNVERIFIED:"+s.id);
    if (!s.visualQaPassed) errors.push("VISUAL_QA_FAILED:"+s.id);
  }
  if (!reel.voiceReady) errors.push("VOICE_NOT_READY");
  if (!reel.captionsReady) errors.push("CAPTIONS_NOT_READY");
  if (![reel.actualCostEur,reel.reservedCostEur,reel.monthCommittedEur].every(n=>Number.isFinite(n)&&n>=0) ||
      reel.actualCostEur>reel.reservedCostEur || reel.monthCommittedEur>30)
    errors.push("COST_NOT_RECONCILED");
  if (!reel.approved) errors.push("HUMAN_APPROVAL_REQUIRED");
  return {ready:errors.length===0,errors,motionShare:duration?motion/duration:0};
}
