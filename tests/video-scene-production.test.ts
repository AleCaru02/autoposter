import assert from "node:assert/strict";
import { buildVideoPlan } from "../api/_lib/video-studio.js";
import { produceVideoSceneAssets } from "../api/_lib/video-scene-production.js";
const plan=buildVideoPlan({profileId:"test",topic:"Siti web",problem:"Pochi contatti",solution:"Landing",callToAction:"Bozza gratuita"});
let calls=0;
const fetcher=(async()=>{calls++;return new Response(JSON.stringify({data:[{b64_json:"cG5n"}]}),{status:200})}) as typeof fetch;
const settings={apiKey:"test",enabled:true,monthlyLimitEur:30,spentEur:0,estimatedEurPerImage:0.1,fetcher};
const partial=await produceVideoSceneAssets(plan,settings);
assert.equal(partial.readyForLocalRender,true);
assert.deepEqual(partial.missingSceneIds,[]);
assert.equal(calls,4);
const complete=await produceVideoSceneAssets(plan,settings,[
  {sceneId:"scene-1",base64:"cG5n",mimeType:"image/png"},
  {sceneId:"scene-3",base64:"cG5n",mimeType:"image/png"}
]);
assert.equal(complete.readyForLocalRender,true);
await assert.rejects(produceVideoSceneAssets(plan,{...settings,enabled:false}),/DISABLED/);
assert.equal(calls,8);
console.log("Scene production completeness checks passed");
