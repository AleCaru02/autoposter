import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.PUBLICATION7F_MARKER || "";
const password = process.env.PUBLICATION7F_PASSWORD || "";
const controllerUrl = process.env.PUBLICATION7F_CONTROLLER_URL || "";
const controllerToken = process.env.PUBLICATION7F_TOKEN_VALUE || "";
assert.match(marker, /^[a-z0-9]{10,32}$/); assert.ok(password.length >= 24 && controllerToken.length >= 32);
const emails = { owner: `publication7f-${marker}-owner@example.invalid`, other: `publication7f-${marker}-other@example.invalid` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) { for (const raw of headers.getSetCookie?.() || []) { const pair=raw.split(";",1)[0]; const i=pair.indexOf("="); if(i>0)this.values.set(pair.slice(0,i).trim(),pair.slice(i+1).trim()); } }
  header() { return [...this.values].map(([key,value]) => `${key}=${value}`).join("; "); }
}
async function readJson(response) { const text=await response.text(); if(!text)return null; try{return JSON.parse(text);}catch{return { invalidJson:true,text:text.slice(0,200) };} }
async function authFetch(jar,path,init={}) { const headers=new Headers(init.headers); headers.set("accept","application/json"); headers.set("origin",APP_BASE); headers.set("referer",`${APP_BASE}/`); if(init.body)headers.set("content-type","application/json"); if(jar.header())headers.set("cookie",jar.header()); const response=await fetch(`${AUTH_URL}${path}`,{...init,headers,redirect:"manual"}); jar.absorb(response.headers); return response; }
function tokenSub(token) { const raw=token.split(".")[1]; const normalized=raw.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(raw.length/4)*4,"="); return JSON.parse(Buffer.from(normalized,"base64").toString("utf8")).sub; }
async function tokenFor(jar) { const response=await authFetch(jar,"/token"); const body=await readJson(response); const token=body?.token||body?.data?.token||""; assert.ok(response.ok&&token.length>40,`token unavailable ${response.status}`); return token; }
async function signup(email,name) { const jar=new CookieJar(); const response=await authFetch(jar,"/sign-up/email",{method:"POST",body:JSON.stringify({email,password,name})}); assert.ok(response.ok,`signup failed ${response.status}`); const token=await tokenFor(jar); return {token,id:tokenSub(token)}; }
async function dataApi(path,token,init={}) { const headers=new Headers(init.headers); headers.set("accept","application/json"); headers.set("authorization",`Bearer ${token}`); if(init.body)headers.set("content-type","application/json"); return fetch(`${DATA_API}${path}`,{...init,headers}); }
async function waitIdentity(token,id) { for(let i=0;i<20;i+=1){const r=await dataApi("/rpc/current_auth_user_id",token,{method:"POST",body:"{}"}); const b=await readJson(r); const actual=typeof b==="string"?b:Array.isArray(b)?b[0]?.current_auth_user_id:b?.current_auth_user_id; if(r.ok&&actual===id)return; await sleep(500);} throw new Error("fresh identity unavailable"); }
async function controller(action,extra={}) { const response=await fetch(controllerUrl,{method:"POST",headers:{"content-type":"application/json","x-publication7f-token":controllerToken},body:JSON.stringify({action,marker,...extra})}); const body=await readJson(response); assert.equal(response.status,200,`controller ${action} failed ${response.status}: ${JSON.stringify(body)}`); return body; }
async function calendar(token,body,expected=200) { const response=await fetch(`${APP_BASE}/api/calendar`,{method:"POST",headers:{accept:"application/json","content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)}); const result=await readJson(response); assert.equal(response.status,expected,`calendar expected ${expected}, got ${response.status}: ${JSON.stringify(result)}`); return result; }
async function createProfile(identity,label) { const response=await dataApi("/profiles?select=id,name,owner_auth_user_id,onboarding_completed",identity.token,{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify({name:`Publication 7F ${label} ${marker}`,slug:`publication7f-${marker}-${label}`,owner_auth_user_id:identity.id,onboarding_completed:true})}); const body=await readJson(response); assert.ok(response.ok,`profile creation failed ${response.status}`); return body[0].id; }

const preflight=await controller("preflight");
assert.deepEqual({users:preflight.recognizedQaUsers,profiles:preflight.qaProfiles,jobs:preflight.qaJobs},{users:0,profiles:0,jobs:0});
assert.equal(preflight.jobsTotal,0,"production had non-QA publication jobs before controlled runtime");
const owner=await signup(emails.owner,"Publication 7F Owner"); const other=await signup(emails.other,"Publication 7F Other");
await waitIdentity(owner.token,owner.id); await waitIdentity(other.token,other.id);
const profileId=await createProfile(owner,"owner"); await createProfile(other,"other");
writeFileSync("fase7f-profile-id.txt", profileId, { mode: 0o600 });
const fixture=await controller("fixture",{profileId});
const variants=Object.fromEntries(fixture.variants.map((row)=>[row.provider,row.id]));
assert.deepEqual(Object.keys(variants).sort(),["FACEBOOK","INSTAGRAM","LINKEDIN"]);

const unsafe=await fetch(`${APP_BASE}/api/social/publish-now`,{method:"POST",headers:{authorization:`Bearer ${owner.token}`,"content-type":"application/json"},body:"{}"});
assert.equal(unsafe.status,410,"direct publish bypass must remain closed");
await calendar(other.token,{action:"CREATE_JOB",profileId,variantId:variants.FACEBOOK,scheduledAt:new Date(Date.now()+180000).toISOString(),operationId:`cross_${marker}`},403);

const results=[];
for (const provider of ["FACEBOOK","LINKEDIN","INSTAGRAM"]) {
  const created=await calendar(owner.token,{action:"CREATE_JOB",profileId,variantId:variants[provider],scheduledAt:new Date(Date.now()+180000).toISOString(),operationId:`${provider.toLowerCase()}_${marker}`});
  assert.equal(created.state,"SCHEDULED");
  const before=await controller("state"); assert.equal(before.qaJobs,results.length+1);
  const run=await controller("run-job",{profileId,jobId:created.jobId});
  assert.equal(run.engine.published,1,`${provider} engine did not publish`);
  assert.equal(run.job?.state,"PUBLISHED",`${provider} local state not published`);
  assert.match(run.job?.remote_post_id||"",/^.+$/,`${provider} remote ID missing`);
  let verified;
  let cleanup;
  if (provider === "LINKEDIN") {
    // w_member_social proves create through the 201 x-restli-id consumed by the
    // product, and proves resource ownership through the documented 204 delete.
    // A GET would additionally require the restricted r_member_social scope.
    cleanup=await controller("cleanup-remote",{profileId,jobId:created.jobId});
    assert.equal(cleanup.deleteStatus,204,`LinkedIn remote cleanup failed: ${JSON.stringify(cleanup)}`);
    verified={verified:true,method:"CREATE_REMOTE_ID_AND_DELETE_204"};
  } else {
    verified=await controller("verify-remote",{profileId,jobId:created.jobId});
    assert.equal(verified.verified,true,`${provider} remote post not readable: ${JSON.stringify(verified)}`);
    cleanup=await controller("cleanup-remote",{profileId,jobId:created.jobId});
  }
  if (provider === "FACEBOOK" || provider === "LINKEDIN") assert.equal(cleanup.removed,true,`${provider} remote cleanup failed: ${JSON.stringify(cleanup)}`);
  else assert.ok(cleanup.removed || cleanup.expiresNaturally,`Instagram controlled story cleanup state invalid: ${JSON.stringify(cleanup)}`);
  results.push({provider,jobId:created.jobId,remotePostId:run.job.remote_post_id,publishedAt:run.job.published_at,removed:cleanup.removed,expiresNaturally:cleanup.expiresNaturally});
  console.log("FASE7F_PROVIDER: PASS",JSON.stringify({provider,remotePostId:run.job.remote_post_id,publishedAt:run.job.published_at,verification:verified.method||"REMOTE_READ",removed:cleanup.removed,expiresNaturally:cleanup.expiresNaturally}));
}
const finalState=await controller("state");
assert.equal(finalState.qaJobs,3); assert.equal(finalState.qaAttempts,3); assert.equal(finalState.qaAssets,1); assert.ok(finalState.qaUsage>=6);
console.log("FASE7F_REAL_PROVIDER_RUNTIME: PASS",JSON.stringify({providers:results,tenantIsolation:"PASS",publishNowClosed:"PASS",baselineProfiles:preflight.profilesTotal}));
