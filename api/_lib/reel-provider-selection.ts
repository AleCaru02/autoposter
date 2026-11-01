/** Selects a Reel clip provider using a verified per-request quote. No network calls. */
export type ClipProvider = "LOCAL_FFMPEG" | "HIGGSFIELD" | "RUNWAY";
export type ClipQuote = { provider: Exclude<ClipProvider,"LOCAL_FFMPEG">; amountEur: number; verified: boolean };
export function selectClipProvider(input: {
  requireGenerativeVideo: boolean;
  quotes: ClipQuote[];
  maxClipEur: number;
  remainingBudgetEur: number;
  durableBudgetReservation: boolean;
}): { provider: ClipProvider; estimatedEur: number; canCallPaidApi: boolean } {
  const {maxClipEur,remainingBudgetEur}=input;
  if (![maxClipEur,remainingBudgetEur].every(x=>Number.isFinite(x)&&x>=0)) throw new Error("INVALID_CLIP_BUDGET");
  const fallback={provider:"LOCAL_FFMPEG" as const,estimatedEur:0,canCallPaidApi:false};
  if (!input.requireGenerativeVideo || !input.durableBudgetReservation) return fallback;
  const candidates=input.quotes.filter(q=>q.verified && Number.isFinite(q.amountEur) && q.amountEur>=0 &&
    (q.provider==="HIGGSFIELD"||q.provider==="RUNWAY") && q.amountEur<=maxClipEur && q.amountEur<=remainingBudgetEur);
  candidates.sort((a,b)=>a.amountEur-b.amountEur);
  if (!candidates.length) return fallback;
  return {provider:candidates[0].provider,estimatedEur:candidates[0].amountEur,canCallPaidApi:true};
}
