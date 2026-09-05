import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const APP = "https://autoposter.02alessandrocaruso.workers.dev";
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
async function read(response) { const text=await response.text(); try{return text?JSON.parse(text):null;}catch{return { invalidJson:true };} }
async function authFetch(jar,path,init={}) { const headers=new Headers(init.headers); headers.set("accept","application/json"); headers.set("origin",APP); if(init.body)headers.set("content-type","application/json"); if(jar.header())headers.set("cookie",jar.header()); const response=await fetch(`${APP}/api/auth${path}`,{...init,headers,redirect:"manual"}); jar.absorb(response.headers); return response; }
function subject(token) { const value=token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"); return JSON.parse(Buffer.from(value.padEnd(Math.ceil(value.length/4)*4,"="),"base64url").toString("utf8")).sub; }
async function signup(kind) { const jar=new CookieJar(); const email=`onboarding-smoke-${marker}-${kind}@example.invalid`; const response=await authFetch(jar,"/sign-up/email",{method:"POST",body:JSON.stringify({email,password,name:`Onboarding ${kind}`})}); assert.ok(response.ok,`signup ${kind} ${response.status}`); const tokenResponse=await authFetch(jar,"/token"); const body=await read(tokenResponse); const token=body?.token||body?.data?.token||""; assert.ok(tokenResponse.ok&&token.length>40); return {token,id:subject(token)}; }
async function provision(token,payload) { const response=await fetch(`${APP}/api/onboarding-provision`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(payload)}); return {response,body:await read(response)}; }
async function dataApi(path,token,init={}) { const headers=new Headers(init.headers); headers.set("authorization",`Bearer ${token}`); headers.set("accept","application/json"); if(init.body)headers.set("content-type","application/json"); return fetch(`${DATA_API}${path}`,{...init,headers}); }
async function controller(action) { const response=await fetch(controllerUrl,{method:"POST",headers:{"content-type":"application/json","x-onboarding-qa-token":controllerToken},body:JSON.stringify({action,marker})}); const body=await read(response); assert.equal(response.status,200,`controller ${action}`); return body; }

const anonymous=await provision("invalid",{operationId:randomUUID(),name:"Denied"}); assert.equal(anonymous.response.status,401);
const primary=await signup("primary"); const other=await signup("other"); assert.notEqual(primary.id,other.id);
const operationId=randomUUID(); const payload={operationId,name:`Onboarding QA ${marker}`,websiteUrl:null,industry:"QA"};
const first=await provision(primary.token,payload); assert.equal(first.response.status,201); assert.ok(first.body?.profile?.id); assert.equal(first.body.profile.onboarding_completed,false);
const replay=await provision(primary.token,payload); assert.equal(replay.response.status,201); assert.equal(replay.body.profile.id,first.body.profile.id);
const conflict=await provision(primary.token,{...payload,name:`Changed ${marker}`}); assert.equal(conflict.response.status,409); assert.equal(conflict.body.error,"ONBOARDING_IDEMPOTENCY_CONFLICT");
const otherCreated=await provision(other.token,{operationId,name:`Other QA ${marker}`,websiteUrl:null,industry:null}); assert.equal(otherCreated.response.status,201); assert.notEqual(otherCreated.body.profile.id,first.body.profile.id);

const ownResponse=await dataApi(`/profile_entitlements?profile_id=eq.${first.body.profile.id}&select=capability_key,enabled,source&order=capability_key`,primary.token); const own=await read(ownResponse); assert.ok(ownResponse.ok); assert.equal(own.length,23); assert.equal(own.filter(x=>x.enabled).length,4); assert.ok(own.every(x=>x.source==="PACKAGE:commercial_guarded:v1"));
const isolated=await dataApi(`/profiles?id=eq.${first.body.profile.id}&select=id`,other.token); assert.deepEqual(await read(isolated),[]);
const direct=await dataApi("/rpc/provision_onboarding_profile",primary.token,{method:"POST",body:"{}"}); assert.equal(direct.ok,false);
const state=await controller("state"); assert.equal(state.qaUsers,2); assert.equal(state.qaProfiles,2); assert.equal(state.qaOwners,2); assert.equal(state.qaAssignments,2); assert.equal(state.qaEntitlements,46); assert.equal(state.qaOperations,2); assert.equal(state.qaAudit,2); assert.equal(state.profilesWithoutOwner,0);

console.log("FASE_5A_ONBOARDING_RUNTIME: PASS",JSON.stringify({anonymousDenied:true,profiles:state.qaProfiles,owners:state.qaOwners,assignments:state.qaAssignments,entitlements:state.qaEntitlements,replaySameProfile:true,idempotencyConflict:true,tenantIsolation:true,directCustomerProvisioning:false}));
