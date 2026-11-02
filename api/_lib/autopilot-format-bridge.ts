import { decideEditorialMix, type Performance } from "./adaptive-editorial-mix.js";

/** Pure planning bridge. Does not schedule, generate, spend, or publish. */
export function planAutopilotFormats(input: {
  monthlyBudgetEur: number;
  unitCostEur: { REEL: number; POST: number; CAROUSEL: number };
  maxPublications: number;
  history?: Performance[];
  autopublishAuthorized?: boolean;
}) {
  const decision = decideEditorialMix(input);
  const formats: Array<"REEL" | "POST" | "CAROUSEL"> = [];
  for (const format of ["REEL", "POST", "CAROUSEL"] as const) {
    for (let i = 0; i < decision.mix[format]; i++) formats.push(format);
  }
  return { decision, formats, readyToPublish: false as const };
}
