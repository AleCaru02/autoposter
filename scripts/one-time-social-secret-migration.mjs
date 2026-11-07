/**
 * ONE-TIME OWNER-APPROVED CREDENTIAL MIGRATION.
 * Transfers existing Worker secrets directly to the same owner's Vercel project.
 * No secrets are printed, persisted to Git, or returned to this CLI.
 * Uploads an UNDEPLOYED Worker version, authenticates via 256-bit nonce,
 * sends secrets from Cloudflare runtime straight to Vercel's HTTPS API,
 * then deletes the temporary version.
 * DELETE THIS FILE AND ITS WORKFLOW JOB AFTER EXECUTION.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cfToken=process.env.CLOUDFLARE_API_TOKEN;
const cfAccount=process.env.CLOUDFLARE_ACCOUNT_ID;
const vercelToken=process.env.VERCEL_TOKEN;
if(!cfToken || !cfAccount || !vercelToken) throw new Error("MIGRATION_CREDENTIAL_NOT_AVAILABLE");
const cfRoot="https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(cfAccount);
const temp=mkdtempSync(join(tmpdir(),"pa-social-secret-migrate-"));
chmodSync(temp,0o700);
const nonce=randomBytes(32).toString("hex");
const versionFile=join(temp,"version-id.txt");
let versionId="";
let complete=false;
const required=["SOCIAL_TOKEN_KEY","META_APP_SECRET","LINKEDIN_CLIENT_SECRET","GOOGLE_CLIENT_SECRET"];

async function cfApi(path, init={}){
  const response=await fetch(cfRoot+path,{
    ...init,
    headers:{authorization:"Bearer "+cfToken,...init.headers},
    signal:AbortSignal.timeout(20000)
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok || data.success!==true) throw new Error("CLOUDFLARE_API_FAILED_"+response.status);
  return data.result;
}

async function tryCleanup(){
  if(!versionId) return true;
  try{
    const response=await fetch(cfRoot+"/workers/workers/autoposter/versions/"+versionId,{
      method:"DELETE",headers:{authorization:"Bearer "+cfToken},
      signal:AbortSignal.timeout(20000)
    });
    const body=await response.json().catch(()=>({}));
    if(response.ok && body.success===true) { console.log("TEMPORARY_VERSION_REMOVED=PASS"); return true; }
    console.error("TEMPORARY_VERSION_REMOVAL_FAILED="+response.status);
    return false;
  }catch{console.error("TEMPORARY_VERSION_REMOVAL_FAILED=NETWORK");return false}
}

const workerSource=String.raw`
const KEYS=["SOCIAL_TOKEN_KEY","META_APP_SECRET","LINKEDIN_CLIENT_SECRET","GOOGLE_CLIENT_SECRET"];
function equals(a,b){
  const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
  let diff=x.length^y.length;
  for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]||0)^(y[i]||0);
  return diff===0;
}
function response(obj,status=200){
  return new Response(JSON.stringify(obj),{
    status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method!=="POST"||url.pathname!=="/__pa_private_migrate_20261107")return response({error:"NOT_FOUND"},404);
    if(!env.PA_MIGRATION_NONCE||!equals(request.headers.get("authorization")||"","Bearer "+env.PA_MIGRATION_NONCE))return response({error:"NOT_FOUND"},404);
    const missing=KEYS.filter(k=>typeof env[k]!=="string"||!env[k].trim());
    if(missing.length || typeof env.SOCIAL_TOKEN_KEY!=="string" || env.SOCIAL_TOKEN_KEY.length<24)
      return response({ok:false,stage:"WORKER_SECRETS_UNAVAILABLE",missingNames:missing},503);
    if(!env.PA_MIGRATION_VERCEL_TOKEN)return response({ok:false,stage:"TRANSFER_TOKEN_MISSING"},503);
    const endpoint="https://api.vercel.com/v10/projects/prj_UMvNIeyJGyaUlFmgDmYksUEqzvD2/env?upsert=true&teamId=team_M6fYd90idkyQEw1ba5tc8WwS";
    const migrated=[];
    for(const name of KEYS){
      let rsp;
      try{
        rsp=await fetch(endpoint,{
          method:"POST",
          headers:{"authorization":"Bearer "+env.PA_MIGRATION_VERCEL_TOKEN,"content-type":"application/json"},
          body:JSON.stringify({key:name,value:env[name],type:"sensitive",target:["production"]})
        });
      }catch{return response({ok:false,stage:"VERCEL_NETWORK_ERROR",migrated},502)}
      if(!rsp.ok)return response({ok:false,stage:"VERCEL_ENV_WRITE_FAILED",key:name,code:rsp.status,migrated},502);
      migrated.push(name);
    }
    return response({ok:true,migrated});
  }
};
`;
try{
  console.log("MIGRATION_START=AUTHORIZED_SAME_OWNER");
  const projectRsp=await fetch("https://api.vercel.com/v9/projects/prj_UMvNIeyJGyaUlFmgDmYksUEqzvD2?teamId=team_M6fYd90idkyQEw1ba5tc8WwS",{
    headers:{authorization:"Bearer "+vercelToken},signal:AbortSignal.timeout(20000)
  });
  if(!projectRsp.ok)throw new Error("VERCEL_PROJECT_ACCESS_FAILED_"+projectRsp.status);
  console.log("VERCEL_PROJECT_ACCESS=PASS");
  const versionsEndpoint="/workers/scripts/autoposter/versions?per_page=30";
  const oldVersions=await cfApi(versionsEndpoint);
  const oldIds=new Set((Array.isArray(oldVersions)?oldVersions:[]).map(x=>x.id));
  const workerPath=join(temp,"recovery.mjs");
  const confPath=join(temp,"wrangler.json");
  const secretsPath=join(temp,"secrets.json");
  writeFileSync(workerPath,workerSource,{mode:0o600});
  writeFileSync(confPath,JSON.stringify({
    name:"autoposter",main:workerPath,compatibility_date:"2026-08-26",
    compatibility_flags:["nodejs_compat"],keep_vars:true,preview_urls:true
  }),{mode:0o600});
  writeFileSync(secretsPath,JSON.stringify({
    PA_MIGRATION_NONCE:nonce,PA_MIGRATION_VERCEL_TOKEN:vercelToken
  }),{mode:0o600});
  const structuredPath=join(temp,"wrangler.jsonl");
  const cmd=spawnSync("npx",["--no-install","wrangler","versions","upload",
    "--config",confPath,"--secrets-file",secretsPath,"--keep-vars",
    "--message","TEMPORARY PRIVATE OWNER-REQUESTED SOCIAL SECRET MIGRATION; DO NOT DEPLOY"
  ],{
    encoding:"utf8",cwd:process.cwd(),timeout:120000,maxBuffer:4*1024*1024,
    env:{...process.env,WRANGLER_OUTPUT_FILE_PATH:structuredPath,WRANGLER_SEND_METRICS:"false"}
  });
  // Never print raw Wrangler output: it may contain operational metadata.
  if(cmd.status!==0) throw new Error("WRANGLER_VERSION_UPLOAD_FAILED_STATUS_"+cmd.status);
  let versionUrl="";
  try{
    for(const line of readFileSync(structuredPath,"utf8").split(/\r?\n/)){
      if(!line.trim())continue;
      const info=JSON.parse(line);
      if(info.type==="version-upload"){
        versionId=info.version_id||versionId;
        versionUrl=info.preview_url||versionUrl;
      }
    }
  }catch{}
  const clean=(cmd.stdout||"").replace(/\x1b\[[0-9;]*m/g,"");
  versionId=versionId || (/Worker Version ID:\s*([0-9a-f-]{36})/i.exec(clean)||[])[1] || "";
  versionUrl=versionUrl || (/Version (?:Preview )?URL:\s*(https:\/\/[^\s]+)/i.exec(clean)||[])[1] || "";
  if(!versionId){
    const nowVersions=await cfApi(versionsEndpoint);
    const fresh=(Array.isArray(nowVersions)?nowVersions:[]).filter(x=>!oldIds.has(x.id));
    if(fresh.length===1)versionId=fresh[0].id;
  }
  if(!versionId)throw new Error("NEW_VERSION_ID_NOT_FOUND");
  writeFileSync(versionFile,versionId,{mode:0o600});
  if(!versionUrl){
    const data=await cfApi("/workers/workers/autoposter/versions/"+versionId);
    versionUrl=(data.urls||[]).find(x=>x.startsWith("https://")&&x.includes("-autoposter."))||"";
  }
  const host=new URL(versionUrl).hostname;
  if(!host.endsWith("-autoposter.02alessandrocaruso.workers.dev"))
    throw new Error("VERSION_ONLY_URL_NOT_VALID");
  console.log("UNDEPLOYED_VERSION_CREATED=PASS");
  let result=null;
  for(let attempt=0;attempt<5;attempt++){
    try{
      const response=await fetch(versionUrl.replace(/\/$/,"")+"/__pa_private_migrate_20261107",{
        method:"POST",headers:{authorization:"Bearer "+nonce},signal:AbortSignal.timeout(30000)
      });
      result=await response.json().catch(()=>null);
      if(response.status===200 && result?.ok===true)break;
      if(response.status===503 || response.status===502)break;
    }catch{}
    await new Promise(r=>setTimeout(r,1000*(attempt+1)));
  }
  if(!result?.ok || !required.every(key=>result.migrated?.includes(key)))
    throw new Error("CLOUDFLARE_TO_VERCEL_TRANSFER_FAILED_STAGE_"+(result?.stage||"UNKNOWN"));
  console.log("VERCEL_SECRETS_MIGRATED=4/4");
  complete=true;
}catch(error){
  console.error("MIGRATION_FAILED="+String(error?.message||"UNKNOWN").replace(/[^A-Za-z0-9_=:-]/g,"").slice(0,160));
}finally{
  const cleaned=await tryCleanup();
  rmSync(temp,{recursive:true,force:true});
  if(!complete||!cleaned)process.exitCode=1;
}
