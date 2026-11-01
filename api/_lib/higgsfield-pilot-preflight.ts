/** Higgsfield Wan 3.0 Prime pilot preflight. Quote observed: 15 credits for 5s, 720p, 9:16, no audio.
 * This is NOT a monetary price. No credit-to-EUR conversion is assumed.
 * A quote alone does not authorize spending or prove that a video was generated.
 */
export const PILOT_VIDEO_REQUEST = Object.freeze({
  provider:"HIGGSFIELD", model:"wan3_0_prime",durationSeconds:5,
  aspectRatio:"9:16",resolution:"720p",generateAudio:false,
  prompt:"Premium cinematic vertical video showing an Italian small business owner reviewing a modern website on a laptop, smooth dolly camera movement, natural lighting, no text, no logos.",
  observedCredits:15,
  paidGenerationEnabled:false,
});
export function authorizePilotVideo(input:{
  creditToEur:number; quotedCredits:number; monthCommittedEur:number;
  otherReservedEur:number; durableReservationConfirmed:boolean;
  quoteFresh:boolean; explicitSpendApproval:boolean;
}):{authorized:boolean; estimatedEur:number|null; reason:string}{
  const values=[input.creditToEur,input.quotedCredits,input.monthCommittedEur,input.otherReservedEur];
  if(values.some(v=>!Number.isFinite(v)||v<0)||input.creditToEur===0)
    return {authorized:false,estimatedEur:null,reason:"UNVERIFIED_CREDIT_VALUE"};
  const estimatedEur=input.creditToEur*input.quotedCredits;
  if(!input.quoteFresh) return {authorized:false,estimatedEur,reason:"STALE_QUOTE"};
  if(!input.durableReservationConfirmed) return {authorized:false,estimatedEur,reason:"NO_DURABLE_RESERVATION"};
  if(!input.explicitSpendApproval) return {authorized:false,estimatedEur,reason:"SPEND_NOT_APPROVED"};
  if(estimatedEur+input.monthCommittedEur+input.otherReservedEur>30)
    return {authorized:false,estimatedEur,reason:"MONTHLY_CAP_EXCEEDED"};
  return {authorized:true,estimatedEur,reason:"PREFLIGHT_OK"};
}
