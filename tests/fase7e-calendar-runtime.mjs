import assert from "node:assert/strict";

const AUTH_URL = "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth";
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const APP_BASE = "https://autoposter.02alessandrocaruso.workers.dev";
const marker = process.env.CALENDAR7E_MARKER || "";
const password = process.env.CALENDAR7E_PASSWORD || "";
const controllerUrl = process.env.CALENDAR7E_CONTROLLER_URL || "";
const controllerToken = process.env.CALENDAR7E_TOKEN_VALUE || "";

assert.match(marker, /^[a-z0-9]{10,32}$/);
assert.ok(password.length >= 24 && controllerToken.length >= 32 && controllerUrl.startsWith("https://"));
const emails = { owner: `calendar7e-${marker}-owner@example.invalid`, other: `calendar7e-${marker}-other@example.invalid` };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CookieJar {
  constructor() { this.values = new Map(); }
  absorb(headers) { for (const raw of headers.getSetCookie?.() || []) { const pair=raw.split(";",1)[0]; const i=pair.indexOf("="); if(i>0)this.values.set(pair.slice(0,i).trim(),pair.slice(i+1).trim()); } }
  header() { return [...this.values].map(([k,v]) => `${k}=${v}`).join("; "); }
}

async function readJson(response) { const text=await response.text(); if(!text)return null; try{return JSON.parse(text);}catch{return { invalidJson:true };} }
async function authFetch(jar,path,init={}) { const headers=new Headers(init.headers); headers.set("accept","application/json"); headers.set("origin",APP_BASE); headers.set("referer",`${APP_BASE}/`); if(init.body)headers.set("content-type","application/json"); if(jar.header())headers.set("cookie",jar.header()); const response=await fetch(`${AUTH_URL}${path}`,{...init,headers,redirect:"manual"}); jar.absorb(response.headers); return response; }
function tokenSub(token) { const raw=token.split(".")[1]; const normalized=raw.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(raw.length/4)*4,"="); return JSON.parse(Buffer.from(normalized,"base64").toString("utf8")).sub; }
async function tokenFor(jar) { const response=await authFetch(jar,"/token"); const body=await readJson(response); const token=body?.token||body?.data?.token||""; assert.ok(response.ok&&token.length>40,`token unavailable ${response.status}`); return token; }
async function signup(email,name) { const jar=new CookieJar(); const response=await authFetch(jar,"/sign-up/email",{method:"POST",body:JSON.stringify({email,password,name})}); assert.ok(response.ok,`signup failed ${response.status}`); const token=await tokenFor(jar); return {token,id:tokenSub(token)}; }
async function dataApi(path,token,init={}) { const headers=new Headers(init.headers); headers.set("accept","application/json"); headers.set("authorization",`Bearer ${token}`); if(init.body)headers.set("content-type","application/json"); return fetch(`${DATA_API}${path}`,{...init,headers}); }
async function waitIdentity(token,id) { for(let i=0;i<20;i+=1){const r=await dataApi("/rpc/current_auth_user_id",token,{method:"POST",body:"{}"}); const b=await readJson(r); const actual=typeof b==="string"?b:Array.isArray(b)?b[0]?.current_auth_user_id:b?.current_auth_user_id; if(r.ok&&actual===id)return; await sleep(500);} throw new Error("fresh identity unavailable"); }
async function controller(action,extra={}) { const response=await fetch(controllerUrl,{method:"POST",headers:{"content-type":"application/json","x-calendar7e-token":controllerToken},body:JSON.stringify({action,marker,...extra})}); const body=await readJson(response); assert.equal(response.status,200,`controller ${action} failed ${response.status}`); return body; }
async function calendar(token,body,expected=200) { const response=await fetch(`${APP_BASE}/api/calendar`,{method:"POST",headers:{accept:"application/json","content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body)}); const result=await readJson(response); assert.equal(response.status,expected,`calendar ${body.action} expected ${expected}, got ${response.status}: ${JSON.stringify(result)}`); return result; }
async function createProfile(identity,label) { const response=await dataApi("/profiles?select=id,name,owner_auth_user_id,onboarding_completed",identity.token,{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify({name:`Calendar 7E ${label} ${marker}`,slug:`calendar7e-${marker}-${label}`,owner_auth_user_id:identity.id,onboarding_completed:true})}); const body=await readJson(response); assert.ok(response.ok,`profile creation failed ${response.status}`); assert.equal(body?.[0]?.owner_auth_user_id,identity.id); return body[0].id; }

const preflight=await controller("preflight");
assert.equal(preflight.recognizedQaUsers,0); assert.equal(preflight.profilesWithoutOwner,0);
const owner=await signup(emails.owner,"Calendar 7E Owner");
const other=await signup(emails.other,"Calendar 7E Other");
await waitIdentity(owner.token,owner.id); await waitIdentity(other.token,other.id);
const profileId=await createProfile(owner,"owner");
const otherProfileId=await createProfile(other,"other");
const fixture=await controller("fixture",{profileId});
assert.match(fixture.approvedVariantId,/^[0-9a-f-]{36}$/i); assert.match(fixture.pendingVariantId,/^[0-9a-f-]{36}$/i);

const schedule=await calendar(owner.token,{action:"SAVE_SCHEDULE",profileId,provider:"INSTAGRAM",timezone:"Europe/Rome",postsPerWeek:4,preferredSlots:[{day:1,time:"09:30"}],autoChoose:true,enabled:true});
assert.match(schedule.scheduleId,/^[0-9a-f-]{36}$/i);
await calendar(owner.token,{action:"SAVE_SCHEDULE",profileId:otherProfileId,provider:"INSTAGRAM",timezone:"Europe/Rome",postsPerWeek:1,preferredSlots:[],autoChoose:true,enabled:true},403);

const direct=await dataApi("/schedules",owner.token,{method:"POST",headers:{prefer:"return=representation"},body:JSON.stringify({profile_id:profileId,provider:"FACEBOOK",timezone:"Europe/Rome",posts_per_week:2,preferred_slots:[],auto_choose:true,enabled:true})});
assert.ok(!direct.ok,`direct client schedule write unexpectedly allowed ${direct.status}`);

await controller("entitlement",{profileId,enabled:false});
await calendar(owner.token,{action:"CREATE_JOB",profileId,variantId:fixture.approvedVariantId,scheduledAt:new Date(Date.now()+7200000).toISOString(),operationId:`disabled_${marker}`},429);
await controller("entitlement",{profileId,enabled:true});

await calendar(owner.token,{action:"CREATE_JOB",profileId,variantId:fixture.pendingVariantId,scheduledAt:new Date(Date.now()+7200000).toISOString(),operationId:`pending_${marker}`},400);
let state=await controller("state");
assert.deepEqual({jobs:state.qaJobs,committed:state.qaCommitted,released:state.qaReleased,reserved:state.qaReserved},{jobs:0,committed:0,released:1,reserved:0});

const operationId=`approved_${marker}`;
const created=await calendar(owner.token,{action:"CREATE_JOB",profileId,variantId:fixture.approvedVariantId,scheduledAt:new Date(Date.now()+10800000).toISOString(),operationId});
const replay=await calendar(owner.token,{action:"CREATE_JOB",profileId,variantId:fixture.approvedVariantId,scheduledAt:new Date(Date.now()+14400000).toISOString(),operationId});
assert.equal(replay.jobId,created.jobId,"idempotent replay created a different job");
state=await controller("state");
assert.deepEqual({jobs:state.qaJobs,committed:state.qaCommitted,released:state.qaReleased,reserved:state.qaReserved},{jobs:1,committed:1,released:1,reserved:0});

await calendar(owner.token,{action:"RESCHEDULE_JOB",profileId,jobId:created.jobId,expectedUpdatedAt:new Date(0).toISOString(),scheduledAt:new Date(Date.now()+18000000).toISOString()},409);
const moved=await calendar(owner.token,{action:"RESCHEDULE_JOB",profileId,jobId:created.jobId,expectedUpdatedAt:created.updatedAt,scheduledAt:new Date(Date.now()+18000000).toISOString()});
assert.equal(moved.jobId,created.jobId); assert.notEqual(moved.updatedAt,created.updatedAt);
const removed=await calendar(owner.token,{action:"REMOVE_JOB",profileId,jobId:created.jobId,expectedUpdatedAt:moved.updatedAt});
assert.equal(removed.removed,true);
state=await controller("state");
assert.deepEqual({jobs:state.qaJobs,committed:state.qaCommitted,released:state.qaReleased,reserved:state.qaReserved},{jobs:0,committed:1,released:1,reserved:0});

console.log("FASE7E_CALENDAR_RUNTIME: PASS",JSON.stringify({serverSchedule:"PASS",tenantIsolation:"PASS",directWriteDenied:"PASS",capabilityGate:"PASS",failedReservationRelease:"PASS",idempotency:"PASS",metering:"PASS",staleWrite:"PASS",reschedule:"PASS",remove:"PASS",profilesBaseline:preflight.profilesTotal}));
