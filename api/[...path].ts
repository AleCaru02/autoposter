import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiBudgetService } from '../apps/local-api/src/ai-budget-service.js';
import { runAiRequestContext } from '../apps/local-api/src/ai-request-context.js';
import { LocalSupabaseClient } from '../apps/local-api/src/db.js';
import { handleApiRequest } from '../apps/local-api/src/server.js';
import { VercelSafeProductionAIWorkflowService } from '../apps/local-api/src/vercel-safe-production-ai-workflow-service.js';
import { PersonalOnboardingCompletionService } from '../apps/local-api/src/personal-onboarding-completion-service.js';
import { PlatformApiSettingsService } from '../apps/local-api/src/platform-api-settings-service.js';
import { MasterAdminService } from '../apps/local-api/src/master-admin-service.js';

const db=new LocalSupabaseClient();
const productionAi=new VercelSafeProductionAIWorkflowService();
const aiBudget=new AiBudgetService(db);
const personalOnboarding=new PersonalOnboardingCompletionService(db);
const platformSettings=new PlatformApiSettingsService(db);
const masterAdmin=new MasterAdminService(db);
const allowedBuckets=new Set(['brand-assets','post-assets','tenant-documents']);
const allowedNeonAuthPaths=new Set(['sign-up/email','sign-in/email','get-session','token','sign-out']);
const secret=()=>process.env.ASSET_SIGNING_SECRET?.trim()??'';
const configured=(value:string|undefined)=>Boolean(value?.trim());
const parts=(pathname:string)=>pathname.split('/').filter(Boolean).map(decodeURIComponent);
const safeEqual=(left:string,right:string)=>{try{const a=Buffer.from(left,'hex'),b=Buffer.from(right,'hex');return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}catch{return false}};
const signature=(bucket:string,path:string,exp:number)=>createHmac('sha256',secret()).update(`${bucket}\n${path}\n${exp}`).digest('hex');
const readBytes=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks)};
const readJsonBody=async(req:IncomingMessage)=>{const bytes=await readBytes(req);if(!bytes.length)return{} as Record<string,unknown>;if(bytes.length>1_000_000)throw new Error('body_too_large');const value=JSON.parse(bytes.toString('utf8')) as unknown;if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('json_object_required');return value as Record<string,unknown>;};
const bearer=(req:IncomingMessage)=>{const value=Array.isArray(req.headers.authorization)?req.headers.authorization[0]:req.headers.authorization;if(!value?.startsWith('Bearer '))throw new Error('auth_required');return value.slice(7)};
const internalAuthorized=(req:IncomingMessage)=>{const key=secret();if(!key)return false;const api=Array.isArray(req.headers.apikey)?req.headers.apikey[0]:req.headers.apikey;const auth=Array.isArray(req.headers.authorization)?req.headers.authorization[0]:req.headers.authorization;return api===key&&auth===`Bearer ${key}`};
const origin=(req:IncomingMessage)=>{const host=Array.isArray(req.headers.host)?req.headers.host[0]:req.headers.host;return `https://${host??process.env.VERCEL_URL??''}`};
const json=(res:ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
const getSetCookies=(headers:Headers):string[]=>{const enhanced=headers as Headers&{getSetCookie?:()=>string[]};const values=enhanced.getSetCookie?.();if(values?.length)return values;const fallback=headers.get('set-cookie');return fallback?[fallback]:[];};
const rewriteProxyCookie=(cookie:string):string=>{let next=cookie.replace(/;\s*Domain=[^;]+/gi,'').replace(/;\s*Path=[^;]+/i,'; Path=/');if(!/;\s*Path=/i.test(next))next+='; Path=/';return next;};
const adminErrorStatus=(message:string)=>/platform_admin_required|auth_required/i.test(message)?403:/NOT_CONFIGURED|ENCRYPTION/i.test(message)?503:400;

function handleProductionHealth(res:ServerResponse){
  const ai=productionAi.readiness();
  const database=configured(process.env.NEON_DATABASE_URL)&&configured(process.env.NEON_DATA_API_URL);
  const auth=configured(process.env.NEON_AUTH_URL);
  const staging=(process.env.APP_ENV??'').toUpperCase()==='STAGING';
  const encryption=configured(process.env.ENCRYPTION_KEY_CURRENT)||(staging&&configured(process.env.ASSET_SIGNING_SECRET));
  json(res,200,{ok:true,environment:staging?'staging':'production',approval:'human-required',testFixtures:false,capabilities:{database,databaseProvider:database?'neon':undefined,auth,openai:ai.configured,openaiTextModel:ai.textModel,openaiImages2:ai.configured&&ai.imageModel===ai.imageModelRequired,openaiImageModel:ai.imageModel,telegram:process.env.TELEGRAM_LIVE==='true'&&configured(process.env.TELEGRAM_BOT_TOKEN)&&configured(process.env.TELEGRAM_WEBHOOK_SECRET),instagram:process.env.META_LIVE==='true'&&configured(process.env.META_APP_ID)&&configured(process.env.META_APP_SECRET),facebook:process.env.META_LIVE==='true'&&configured(process.env.META_APP_ID)&&configured(process.env.META_APP_SECRET),linkedin:process.env.LINKEDIN_LIVE==='true'&&configured(process.env.LINKEDIN_CLIENT_ID)&&configured(process.env.LINKEDIN_CLIENT_SECRET),googleBusinessProfile:process.env.GBP_LIVE==='true'&&configured(process.env.GOOGLE_CLIENT_ID)&&configured(process.env.GOOGLE_CLIENT_SECRET)},aiBudget:{failClosed:true,pricingConfigured:configured(process.env.OPENAI_PRICING_JSON)},hardening:{privateAssets:true,credentialEncryption:encryption}});
}

async function handleNeonAuthProxy(req:IncomingMessage,res:ServerResponse,url:URL){
  const authRoot=process.env.NEON_AUTH_URL?.trim().replace(/\/$/,'')??'';
  if(!authRoot){json(res,503,{error:'NEON_AUTH_NOT_CONFIGURED'});return true;}
  const relative=url.pathname.slice('/api/auth/neon/'.length);
  if(!allowedNeonAuthPaths.has(relative)){json(res,404,{error:'not_found'});return true;}
  const method=req.method??'GET';
  if(!['GET','POST'].includes(method)){json(res,405,{error:'method_not_allowed'});return true;}
  const headers=new Headers();
  const contentType=Array.isArray(req.headers['content-type'])?req.headers['content-type'][0]:req.headers['content-type'];if(contentType)headers.set('content-type',contentType);
  const cookie=Array.isArray(req.headers.cookie)?req.headers.cookie.join('; '):req.headers.cookie;if(cookie)headers.set('cookie',cookie);
  const userAgent=Array.isArray(req.headers['user-agent'])?req.headers['user-agent'][0]:req.headers['user-agent'];if(userAgent)headers.set('user-agent',userAgent);
  headers.set('origin',Array.isArray(req.headers.origin)?req.headers.origin[0]??origin(req):req.headers.origin??origin(req));
  const init:RequestInit={method,headers,redirect:'manual'};
  if(method==='POST'){const bytes=await readBytes(req);if(bytes.length)init.body=new Uint8Array(bytes);}
  const upstream=await fetch(`${authRoot}/auth/${relative}${url.search}`,init);
  const responseHeaders:Record<string,string|string[]>={'content-type':upstream.headers.get('content-type')??'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
  const authJwt=upstream.headers.get('set-auth-jwt');if(authJwt)responseHeaders['set-auth-jwt']=authJwt;
  const location=upstream.headers.get('location');if(location)responseHeaders.location=location;
  const cookies=getSetCookies(upstream.headers).map(rewriteProxyCookie);if(cookies.length)responseHeaders['set-cookie']=cookies;
  res.writeHead(upstream.status,responseHeaders);res.end(Buffer.from(await upstream.arrayBuffer()));return true;
}

async function handleMasterAdmin(req:IncomingMessage,res:ServerResponse,url:URL){
  const p=parts(url.pathname);
  if(!(p[0]==='api'&&p[1]==='admin'))return false;
  try{
    if(req.method==='GET'&&p[2]==='customers'&&p.length===3){json(res,200,await masterAdmin.snapshot(bearer(req)));return true;}
    if(req.method==='GET'&&p[2]==='platform-settings'&&p.length===3){json(res,200,await platformSettings.status(bearer(req)));return true;}
    if(req.method==='PATCH'&&p[2]==='platform-settings'&&p[3]){json(res,200,await platformSettings.save(bearer(req),p[3],await readJsonBody(req)));return true;}
    if(req.method==='DELETE'&&p[2]==='platform-settings'&&p[3]){json(res,200,await platformSettings.remove(bearer(req),p[3]));return true;}
    return false;
  }catch(error){const message=error instanceof Error?error.message:String(error);json(res,adminErrorStatus(message),{error:message});return true;}
}

async function handleOnboardingCompletion(req:IncomingMessage,res:ServerResponse,url:URL){
  const p=parts(url.pathname);
  if(!(req.method==='POST'&&p[0]==='api'&&p[1]==='tenants'&&p[2]&&p[3]==='onboarding'&&p[4]==='complete'))return false;
  try{json(res,200,await personalOnboarding.complete(bearer(req),p[2]));}
  catch(error){const message=error instanceof Error?error.message:String(error);json(res,/auth_required|access_denied/.test(message)?403:400,{error:message});}
  return true;
}

async function handlePrivateAsset(req:IncomingMessage,res:ServerResponse,url:URL){const bucket=url.searchParams.get('bucket')??'',path=url.searchParams.get('path')??'',sig=url.searchParams.get('sig')??'',exp=Number(url.searchParams.get('exp')??0);if(!secret()||!allowedBuckets.has(bucket)||!path||!Number.isFinite(exp)||exp<Math.floor(Date.now()/1000)||exp>Math.floor(Date.now()/1000)+86400||!safeEqual(sig,signature(bucket,path,exp))){json(res,403,{error:'asset_link_invalid_or_expired'});return true;}const object=await db.getBinaryObject(bucket,path);if(!object){json(res,404,{error:'asset_not_found'});return true;}res.writeHead(200,{'content-type':object.mimeType,'content-length':String(object.bytes.length),'cache-control':'private, max-age=300','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});res.end(object.bytes);return true;}

async function handleStorageCompat(req:IncomingMessage,res:ServerResponse,url:URL){if(!internalAuthorized(req)){json(res,404,{error:'not_found'});return true;}const p=parts(url.pathname);const objectIndex=p.findIndex((item)=>item==='object');if(objectIndex<0)return false;const rest=p.slice(objectIndex+1);if(rest[0]==='sign'&&req.method==='POST'){const bucket=rest[1]??'',path=rest.slice(2).join('/');if(!allowedBuckets.has(bucket)||!path){json(res,400,{error:'invalid_storage_path'});return true;}const exp=Math.floor(Date.now()/1000)+3600;const sig=signature(bucket,path,exp);const signedURL=`${origin(req)}/api/assets/private?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&exp=${exp}&sig=${sig}`;json(res,200,{signedURL});return true;}const bucket=rest[0]??'';if(!allowedBuckets.has(bucket)){json(res,400,{error:'invalid_storage_bucket'});return true;}const path=rest.slice(1).join('/');if(req.method==='POST'&&path){const bytes=await readBytes(req);const tenantId=path.split('/')[0]??'';const mime=String(req.headers['content-type']??'application/octet-stream').split(';')[0]??'application/octet-stream';await db.putBinaryObject({tenantId,bucket,path,bytes,mimeType:mime,upsert:req.headers['x-upsert']==='true'});json(res,200,{Key:path});return true;}if(req.method==='GET'&&path){const object=await db.getBinaryObject(bucket,path);if(!object){res.writeHead(404);res.end();return true;}res.writeHead(200,{'content-type':object.mimeType,'content-length':String(object.bytes.length),'cache-control':'no-store'});res.end(object.bytes);return true;}if(req.method==='DELETE'&&path){await db.deleteBinaryObject(bucket,path);json(res,200,{});return true;}if(req.method==='DELETE'&&!path){const body=JSON.parse((await readBytes(req)).toString('utf8')||'{}') as {prefixes?:string[]};for(const item of body.prefixes??[])await db.deleteBinaryObject(bucket,item);json(res,200,{});return true;}json(res,405,{error:'method_not_allowed'});return true;}

async function handleAiBudget(req:IncomingMessage,res:ServerResponse,url:URL){const p=parts(url.pathname);if(!(p[0]==='api'&&p[1]==='tenants'&&p[2]))return false;try{if(p[3]==='ai-budget'){if(req.method==='GET'){json(res,200,await aiBudget.get(bearer(req),p[2]));return true;}if(req.method==='PATCH'){json(res,200,await aiBudget.update(bearer(req),p[2],await readJsonBody(req)));return true;}json(res,405,{error:'method_not_allowed'});return true;}if(p[3]==='ai-cost-report'&&req.method==='GET'){json(res,200,await aiBudget.report(bearer(req),p[2],{from:url.searchParams.get('from')??'',to:url.searchParams.get('to')??'',scope:url.searchParams.get('scope')??'tenant'}));return true;}return false;}catch(error){const message=error instanceof Error?error.message:'ai_budget_failed';json(res,message.includes('access_denied')||message.includes('OWNER')?403:400,{error:message});return true;}}

async function handleVercelSafeAi(req:IncomingMessage,res:ServerResponse,url:URL){if(req.method!=='POST')return false;const p=parts(url.pathname);if(p[0]==='api'&&p[1]==='tenants'&&p[2]&&p[3]==='posts'&&p[4]&&p[5]==='generate'){try{json(res,200,await productionAi.generatePost(bearer(req),p[2],p[4]));}catch(error){json(res,500,{error:error instanceof Error?error.message:'generation_failed'});}return true;}if(p[0]==='api'&&p[1]==='tenants'&&p[2]&&p[3]==='variants'&&p[4]&&p[5]==='visual'){try{json(res,200,await productionAi.generateVisualForVariant(bearer(req),p[2],p[4]));}catch(error){json(res,500,{error:error instanceof Error?error.message:'visual_generation_failed'});}return true;}if(p[0]==='api'&&p[1]==='tenants'&&p[2]&&p[3]==='posts'&&p[4]==='generate-all'){try{json(res,200,await productionAi.generateAllDrafts(bearer(req),p[2],1));}catch(error){json(res,500,{error:error instanceof Error?error.message:'generation_failed'});}return true;}return false;}

async function dispatch(req:IncomingMessage,res:ServerResponse,url:URL){
  await platformSettings.hydrateRuntime().catch(()=>false);
  if(url.pathname==='/api/health'){handleProductionHealth(res);return;}
  if(url.pathname.startsWith('/api/auth/neon/')){await handleNeonAuthProxy(req,res,url);return;}
  if(await handleMasterAdmin(req,res,url))return;
  if(await handleOnboardingCompletion(req,res,url))return;
  if(url.pathname==='/api/assets/private'){await handlePrivateAsset(req,res,url);return;}
  if(url.pathname.startsWith('/api/storage/v1/object')){await handleStorageCompat(req,res,url);return;}
  if(await handleAiBudget(req,res,url))return;
  if(await handleVercelSafeAi(req,res,url))return;
  await handleApiRequest(req,res);
}

export default async function handler(req:IncomingMessage,res:ServerResponse){const url=new URL(req.url??'/',`https://${req.headers.host??'localhost'}`);const p=parts(url.pathname);const tenantId=p[0]==='api'&&p[1]==='tenants'&&p[2]?p[2]:null;if(tenantId){const postId=p[3]==='posts'&&p[4]&&p[5]==='generate'?p[4]:undefined;const postVariantId=p[3]==='variants'&&p[4]&&['visual','repair'].includes(p[5]??'')?p[4]:undefined;await runAiRequestContext({tenantId,...(postId?{postId}:{}),...(postVariantId?{postVariantId}:{})},()=>dispatch(req,res,url));return;}await dispatch(req,res,url);}
