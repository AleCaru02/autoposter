import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const APP = "https://autoposter.02alessandrocaruso.workers.dev";
const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const marker = process.env.ONBOARDING_QA_MARKER || "";
const password = process.env.ONBOARDING_QA_PASSWORD || "";
const controllerUrl = process.env.ONBOARDING_QA_CONTROLLER_URL || "";
const controllerToken = process.env.ONBOARDING_QA_TOKEN_VALUE || "";
assert.match(marker, /^[0-9]{10,32}$/); assert.ok(password.length >= 24);

class CookieJar {
  values = new Map();
  absorb(headers) { for (const raw of headers.getSetCookie?.() || []) { const pair=raw.split(";",1)[0]; const i=pair.indexOf("="); if(i>0)this.values.set(pair.slice(0,i),pair.slice(i+1)); } }
  header() { return [...this.values].map(([k,v])=>`${k}=${v}`).join("; "); }
}
async function read(response) { const text=await response.text(); try{return text?JSON.parse(text):null;}catch{return {invalidJson:true};} }
async function authFetch(jar,path,init={}) { const headers=new Headers(init.headers); headers.set("accept","application/json"); headers.set("origin",APP); headers.set("referer",`${APP}/`); if(init.body)headers.set("content-type","application/json"); if(jar.header())headers.set("cookie",jar.header()); const response=await fetch(`${AUTH_URL}${path}`,{...init,headers,redirect:"manual"}); jar.absorb(response.headers); return response; }
function subject(token) { const value=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"); return JSON.parse(Buffer.from(value.padEnd(Math.ceil(value.length/4)*4,"="),"base64url").toString("utf8")).sub; }
function rpcIdentity(body) { if(typeof body==="string")return body.trim()||null; const value=Array.isArray(body)?body[0]:body; if(!value||typeof value!=="object")return null; return value.current_auth_user_id||value.auth_user_id||value.current_platform_identity||null; }
async function dataApi(path,token,init={}) { const headers=new Headers(init.headers); headers.set("authorization",`Bearer ${token}`); headers.set("accept","application/json"); if(init.body)headers.set("content-type","application/json"); return fetch(`${DATA_API}${path}`,{...init,headers}); }
async function waitForIdentity(token,id) { for(let attempt=0;attempt<20;attempt+=1){ const response=await dataApi("/rpc/current_auth_user_id",token,{method:"POST",body:"{}"}); const body=await read(response); if(response.ok&&rpcIdentity(body)===id)return; await new Promise(resolve=>setTimeout(resolve,500)); } throw new Error("Data API did not recognize freshly authenticated identity"); }
async function signup(kind) { const jar=new CookieJar(); const email=`onboarding-completion-smoke-${marker}-${kind}@example.invalid`; const response=await authFetch(jar,"/sign-up/email",{method:"POST",body:JSON.stringify({email,password,name:`Completion ${kind}`})}); assert.ok(response.ok,`signup ${kind} ${response.status}`); const tokenResponse=await authFetch(jar,"/token"); const body=await read(tokenResponse); const token=body?.token||body?.data?.token||""; assert.ok(tokenResponse.ok&&token.length>40); const id=subject(token); await waitForIdentity(token,id); return {token,id}; }
async function provision(token,payload) { const response=await fetch(`${APP}/api/onboarding-provision`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(payload)}); return {response,body:await read(response)}; }
async function complete(token,profileId) { const response=await fetch(`${APP}/api/onboarding-complete`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({profileId})}); return {response,body:await read(response)}; }
async function profile(token,profileId) { const response=await dataApi(`/profiles?id=eq.${profileId}&select=id,onboarding_completed`,token); return {response,body:await read(response)}; }
async function controller(action) { const response=await fetch(controllerUrl,{method:"POST",headers:{"content-type":"application/json","x-onboarding-qa-token":controllerToken},body:JSON.stringify({action,marker})}); const body=await read(response); assert.equal(response.status,200,`controller ${action}`); return body; }

const anonymous=await complete("invalid",randomUUID()); assert.equal(anonymous.response.status,401);
const primary=await signup("primary"); const other=await signup("other"); assert.notEqual(primary.id,other.id);
const primaryCreated=await provision(primary.token,{operationId:randomUUID(),name:`Completion QA ${marker}`,websiteUrl:null,industry:"QA"}); assert.equal(primaryCreated.response.status,201); const primaryId=primaryCreated.body?.profile?.id; assert.ok(primaryId); assert.equal(primaryCreated.body.profile.onboarding_completed,false);
const otherCreated=await provision(other.token,{operationId:randomUUID(),name:`Website QA ${marker}`,websiteUrl:"https://example.com/",industry:null}); assert.equal(otherCreated.response.status,201); const otherId=otherCreated.body?.profile?.id; assert.ok(otherId);

const directPatch=await dataApi(`/profiles?id=eq.${primaryId}`,primary.token,{method:"PATCH",headers:{prefer:"return=representation"},body:JSON.stringify({onboarding_completed:true})}); assert.equal(directPatch.ok,false);
assert.equal((await profile(primary.token,primaryId)).body[0].onboarding_completed,false);
const crossTenant=await complete(other.token,primaryId); assert.equal(crossTenant.response.status,404);
const websiteDenied=await complete(other.token,otherId); assert.equal(websiteDenied.response.status,409); assert.equal(websiteDenied.body.error,"WEBSITE_REQUIRES_ANALYSIS");
const first=await complete(primary.token,primaryId); assert.equal(first.response.status,200); assert.equal(first.body.completed,true);
const replay=await complete(primary.token,primaryId); assert.equal(replay.response.status,200); assert.equal((await profile(primary.token,primaryId)).body[0].onboarding_completed,true);
const directRpc=await dataApi("/rpc/complete_onboarding_profile",primary.token,{method:"POST",body:JSON.stringify({p_actor_auth_user_id:primary.id,p_profile_id:primaryId,p_mode:"NO_WEBSITE"})}); assert.equal(directRpc.ok,false);

const beforeBan=await controller("state"); assert.equal(beforeBan.qaUsers,2); assert.equal(beforeBan.qaProfiles,2); assert.equal(beforeBan.qaProvisionAudit,2); assert.equal(beforeBan.qaCompletionAudit,1); assert.equal(beforeBan.qaBanned,0); assert.equal(beforeBan.profilesWithoutOwner,0);
const banned=await controller("ban-other"); assert.equal(banned.qaBanned,1);
const bannedDenied=await complete(other.token,otherId); assert.equal(bannedDenied.response.status,401);
const finalState=await controller("state"); assert.equal(finalState.qaCompletionAudit,1); assert.equal(finalState.qaBanned,1);

console.log("FASE_5B_ONBOARDING_COMPLETION_RUNTIME: PASS",JSON.stringify({anonymousDenied:true,directCompletionBlocked:true,serverCompletion:true,replayIdempotent:true,singleAudit:true,tenantIsolation:true,websiteRequiresAnalysis:true,directCustomerRpc:false,bannedDenied:true,profiles:finalState.qaProfiles,qaResiduePendingCleanup:true}));
