/** Requested production target. Forecast only: no paid generation or publishing is enabled. */
export const REQUESTED_MONTHLY_CONTENT_PLAN = Object.freeze({
  posts: 12,
  carousels: 4,
  slidesPerCarousel: 5,
  reels: 15,
  totalPublications: 31,
  aiImages: 32,
  assumedImageEur: 0.25,
  assumedReelEur: 1,
  assumedOtherEur: 4,
  assumedTotalEur: 27,
  monthlyAiCapEur: 30,
  enabled: false,
  requiresVerifiedProviderPricing: true,
  requiresDurableSpendingReservation: true,
  requiresLiveGenerationQa: true,
  requiresPublicationApproval: true,
} as const);

export function requestedPlanForecast(input: {
  measuredImageEur: number;
  measuredReelEur: number;
  measuredOtherEur: number;
  extraRegenerationEur?: number;
}) {
  const values=[input.measuredImageEur,input.measuredReelEur,input.measuredOtherEur,input.extraRegenerationEur??0];
  if(values.some(v=>!Number.isFinite(v)||v<0)) throw new Error("INVALID_MEASURED_COST");
  const total=32*values[0]+15*values[1]+values[2]+values[3];
  return {
    totalEur:total,
    remainingEur:30-total,
    feasible:total<=30,
    activationAllowed:false,
    reason:"Provider pricing, durable metering, real QA and publication approval are not yet verified.",
  };
}
