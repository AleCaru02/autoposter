/** Planning-only quote comparison. Paid generation remains disabled until budget settlement is wired. */
export const REEL_CLOUD_OPTIONS = [
  {provider:"RUNWAY",model:"gen4_turbo",usdPerSecond:0.05},
  {provider:"HIGGSFIELD",model:"wan_3_prime_promo",usdPerSecond:0.041},
  {provider:"HIGGSFIELD",model:"minimax_h3_promo",usdPerSecond:0.065},
  {provider:"RUNWAY",model:"kling3_standard_no_audio",usdPerSecond:0.09},
] as const;
export function estimateCloudReelBatch(input:{
  reelCount:number; secondsPerReel:number; clipsPerReel:number;
  usdPerSecond:number; voiceUsd:number; imagesUsd:number;
  editingUsd:number; retryAllowanceUsd:number; usdToEur:number;
}) {
  const v=Object.values(input);
  if (v.some(n=>!Number.isFinite(n)||n<0)||input.usdToEur<=0||
      !Number.isInteger(input.reelCount)||!Number.isInteger(input.clipsPerReel))
    throw new Error("INVALID_VIDEO_FORECAST");
  const videoUsd=input.reelCount*input.secondsPerReel*input.clipsPerReel*input.usdPerSecond;
  const totalUsd=videoUsd+input.voiceUsd+input.imagesUsd+input.editingUsd+input.retryAllowanceUsd;
  const totalEur=totalUsd*input.usdToEur;
  return {videoUsd,totalUsd,totalEur,withinThirtyEur:totalEur<=30,
    productionAuthorized:false,reason:"Forecast only; runtime quote, durable reservation and approval required"};
}
