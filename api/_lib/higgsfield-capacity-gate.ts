/** Read-only provider capacity gate. Never submit a paid generation when credit balance is insufficient. */
export function assessHiggsfieldCapacity(input:{
  availableCredits:number; quotedCredits:number; modelId:string;
  freeGenerationModelIds?:string[]; freeGenerationsRemaining?:number;
  allowFreeGeneration?:boolean;
}) {
  if (![input.availableCredits,input.quotedCredits].every(n=>Number.isFinite(n)&&n>=0) ||
      !input.modelId || !Number.isInteger(input.quotedCredits) || input.quotedCredits===0)
    return {canSubmit:false,mode:"BLOCKED" as const,reason:"INVALID_PROVIDER_QUOTE"};
  if (input.availableCredits>=input.quotedCredits)
    return {canSubmit:true,mode:"CREDITS" as const,reason:"SUFFICIENT_CREDITS"};
  if (input.allowFreeGeneration===true &&
      (input.freeGenerationsRemaining??0)>0 &&
      (input.freeGenerationModelIds??[]).includes(input.modelId))
    return {canSubmit:true,mode:"FREE" as const,reason:"ELIGIBLE_FREE_GENERATION"};
  return {canSubmit:false,mode:"BLOCKED" as const,reason:"INSUFFICIENT_CREDITS"};
}
