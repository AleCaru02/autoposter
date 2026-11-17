import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { VercelRequest,VercelResponse } from "@vercel/node";
import handler,{canaryWindow} from "../api/cron-canary.js";

const id="73486d3c-dca0-4aaa-a69e-d4b08cc6430f";
const cutoff="2026-11-17T00:00:00.000Z";
const cfg={AUTOPILOT_RETEST_PROFILE_ID:id,AUTOPILOT_RETEST_CUTOFF_UTC:cutoff};
assert.deepEqual(canaryWindow(cfg,new Date("2026-11-17T01:00:00Z")),{ready:true,profileId:id,cutoffUtc:cutoff});
assert.equal(canaryWindow(cfg,new Date("2026-11-18T00:00:00Z")).ready,false);
assert.equal(canaryWindow(cfg,new Date("2026-11-16T23:59:59Z")).ready,false);
assert.equal(canaryWindow({...cfg,AUTOPILOT_RETEST_PROFILE_ID:"invalid"},new Date("2026-11-17T01:00:00Z")).ready,false);
assert.equal(canaryWindow({...cfg,AUTOPILOT_RETEST_CUTOFF_UTC:"garbage"},new Date("2026-11-17T01:00:00Z")).ready,false);

function mockRes(){
  let status=200;let payload:unknown;
  const res={setHeader(){return res;},status(code:number){status=code;return res;},
    json(body:unknown){payload=body;return res;}} as unknown as VercelResponse;
  return {res,result:()=>({status,payload})};
}
const oldSecret=process.env.CRON_SECRET;
try{
  process.env.CRON_SECRET="unit-test-secret";
  let response=mockRes();
  await handler({method:"POST",headers:{}} as VercelRequest,response.res);
  assert.equal(response.result().status,405);
  response=mockRes();
  await handler({method:"GET",headers:{}} as VercelRequest,response.res);
  assert.equal(response.result().status,401);
  response=mockRes();
  await handler({method:"GET",headers:{authorization:"Bearer wrong"}} as VercelRequest,response.res);
  assert.equal(response.result().status,401);
  response=mockRes();
  await handler({method:"GET",headers:{authorization:"Bearer unicode-☃☃☃☃"}} as VercelRequest,response.res);
  assert.equal(response.result().status,401);
}finally{
  if(oldSecret===undefined)delete process.env.CRON_SECRET; else process.env.CRON_SECRET=oldSecret;
}
const src=readFileSync(new URL("../api/cron-canary.ts",import.meta.url),"utf8");
assert.match(src,/created_at>=\$\{scope\.cutoffUtc\}::timestamptz/);
assert.match(src,/if \(Number\(rows\[0\]\?\.n\)>0\) \{/);
assert.match(src,/recoverWasmCanaryImage\(/);
assert.match(src,/canary:"CONSUMED"/);
const recoverySrc=readFileSync(new URL("../api/_lib/autopilot-image-recovery.ts",import.meta.url),"utf8");
assert.match(recoverySrc,/wasm-canary-image-repair-v1/);
assert.match(recoverySrc,/e\.metadata->>'release_reason' like 'Cannot find package/);
assert.match(recoverySrc,/cost\.provider_started_at is null/);
assert.match(recoverySrc,/await preflightDeterministicTypography\(/);
assert.match(recoverySrc,/await meter\.markProviderStarted\(/);
assert.match(recoverySrc,/await runContentQa\(/);
assert.match(recoverySrc,/qa\.overallStatus !== "PASS"/);
assert.match(recoverySrc,/auto_approve_content_variant/);
assert.match(src,/runContentAutopilotSerialized\(/);
assert.match(src,/profileId:scope\.profileId,maxGenerations:1/);
assert.match(src,/CANARY_WINDOW_MS=24\*60\*60\*1000/);
const config=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
assert.deepEqual(config.crons.filter((c:{path:string})=>c.path==="/api/cron-canary"),[{path:"/api/cron-canary",schedule:"*/10 * 17 11 *"}]);
console.log("One-shot authenticated AI canary, cost window and no repeat: PASS");
