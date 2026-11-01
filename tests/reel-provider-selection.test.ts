import assert from "node:assert/strict";
import {selectClipProvider} from "../api/_lib/reel-provider-selection.js";
const base={requireGenerativeVideo:true,maxClipEur:1,remainingBudgetEur:3,durableBudgetReservation:true,quotes:[
  {provider:"RUNWAY" as const,amountEur:.8,verified:true},
  {provider:"HIGGSFIELD" as const,amountEur:.4,verified:true},
]};
assert.equal(selectClipProvider(base).provider,"HIGGSFIELD");
assert.equal(selectClipProvider({...base,durableBudgetReservation:false}).canCallPaidApi,false);
assert.equal(selectClipProvider({...base,remainingBudgetEur:.1}).provider,"LOCAL_FFMPEG");
assert.equal(selectClipProvider({...base,quotes:[{provider:"HIGGSFIELD",amountEur:.1,verified:false}]}).provider,"LOCAL_FFMPEG");
assert.equal(selectClipProvider({...base,requireGenerativeVideo:false}).provider,"LOCAL_FFMPEG");
assert.throws(()=>selectClipProvider({...base,maxClipEur:-1}),/INVALID_CLIP_BUDGET/);
console.log("Reel provider selection tests passed");
