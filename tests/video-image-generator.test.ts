import assert from "node:assert/strict";
import { buildVideoPlan } from "../api/_lib/video-studio.js";
import { generateSceneImages } from "../api/_lib/video-image-generator.js";
const plan = buildVideoPlan({ profileId:"test", topic:"Siti web", problem:"Pochi clienti", solution:"Landing efficace", callToAction:"Bozza gratuita" });
let calls = 0;
const mockFetch = (async () => {
  calls++;
  return new Response(JSON.stringify({data:[{b64_json:"cG5n"}]}), {status:200});
}) as typeof fetch;
const config = {apiKey:"fake",enabled:true,monthlyLimitEur:30,spentEur:0,estimatedEurPerImage:0.2,fetcher:mockFetch};
const result = await generateSceneImages(plan,config);
assert.equal(result.length,2);
assert.equal(calls,2);
await assert.rejects(generateSceneImages(plan,{...config,enabled:false}), /DISABLED/);
await assert.rejects(generateSceneImages(plan,{...config,spentEur:29.9}), /BUDGET_EXCEEDED/);
assert.equal(calls,2);
console.log("Video image generator mock checks passed");
