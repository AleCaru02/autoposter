/** Planning-only economics. Real API billing and FX must be reconciled before spending. */
export const IMAGE_25_STANDARD_USD_PER_MILLION = Object.freeze({
  imageInput: 8, imageOutput: 30, textInput: 5,
});
export type MonthlyContentPlan = {
  posts: number;
  carousels: number;
  slidesPerCarousel: number;
  reels: number;
  imageOutputTokensPerImage: number;
  imageInputTokensPerImage: number;
  textInputTokensPerImage: number;
  reelCostUsd: number;
  otherAiCostUsd: number;
  usdToEur: number;
  monthlyBudgetEur?: number;
  contingencyPercent?: number;
};
export function estimateMonthlyContentPlan(plan: MonthlyContentPlan) {
  const integers = [plan.posts,plan.carousels,plan.slidesPerCarousel,plan.reels,plan.imageOutputTokensPerImage,plan.imageInputTokensPerImage,plan.textInputTokensPerImage];
  if (integers.some(v=>!Number.isSafeInteger(v)||v<0) || plan.slidesPerCarousel<2 || plan.slidesPerCarousel>10 ||
      [plan.reelCostUsd,plan.otherAiCostUsd,plan.usdToEur].some(v=>!Number.isFinite(v)||v<0) || plan.usdToEur===0) throw new Error("INVALID_CONTENT_BUDGET_INPUT");
  const budget = plan.monthlyBudgetEur ?? 30;
  const contingency = plan.contingencyPercent ?? 20;
  if (!Number.isFinite(budget)||budget<=0||!Number.isFinite(contingency)||contingency<0||contingency>100) throw new Error("INVALID_CONTENT_BUDGET_INPUT");
  const imageCount=plan.posts+plan.carousels*plan.slidesPerCarousel;
  const imageCostUsd=imageCount*(plan.imageOutputTokensPerImage*30+plan.imageInputTokensPerImage*8+plan.textInputTokensPerImage*5)/1_000_000;
  const videoCostUsd=plan.reels*plan.reelCostUsd;
  const subtotalEur=(imageCostUsd+videoCostUsd+plan.otherAiCostUsd)*plan.usdToEur;
  const estimatedEur=subtotalEur*(1+contingency/100);
  return {
    publications:plan.posts+plan.carousels+plan.reels,
    imageCount,
    imageCostUsd,videoCostUsd,subtotalEur,estimatedEur,
    remainingEur:budget-estimatedEur,
    withinBudget:estimatedEur<=budget,
    note:"Forecast only. Image output token counts, video cost, actual usage and USD/EUR rate must be measured; not a provider spending limit.",
  };
}
