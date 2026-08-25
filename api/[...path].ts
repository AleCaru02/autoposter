import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LocalSupabaseClient } from '../apps/local-api/src/db.js';
import { handleApiRequest } from '../apps/local-api/src/server.js';
import { VercelSafeProductionAIWorkflowService } from '../apps/local-api/src/vercel-safe-production-ai-workflow-service.js';

const db=new LocalSupabaseClient();
const productionAi=new VercelSafeProductionAIWorkflowService();
const allowedBuckets=new Set(['brand-assets','post-assets','tenant-documents']);
const secret=()=>process.env.ASSET_SIGNING_SECRET?.trim()??'';
const parts=(pathname:string)=>pathname.split('/').filter(Boolean).map(decodeURIComponent);
const safeEqual=(left:string,right:string)=>{try{const a=Buffer.from(left,'hex'),b=Buffer.from(right,'hex');return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}catch{return false}};
const signature=(bucket:string,path:string,exp:number)=>createHmac('sha256',secret()).update(`${bucket}\n${path}\n${exp}`).digest('hex');
const readBytes=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks)};
const bearer=(req:IncomingMessage)=>{const value=Array.isArray(req.headers.authorization)?req.headers.authorization[0]:req.headers.authorization;if(!value?.startsWith('Bearer '))throw new Error('auth_required');return value.slice(7)};
const internalAuthorized=(req:IncomingMessage)=>{const key=secret();if(!key)return false;const api=Array.isArray(req.headers.apikey)?req.headers.apikey[0]:req.headers.apikey;const auth=Array.isArray(req.headers.authorization)?req.headers.authorization[0]:req.headers.authorization;return api===key&&auth===`Bearer ${key}`};
const origin=(req:IncomingMessage)=>{const host=Array.isArray(req.headers.host)?req.headers.host[0]:req.headers.host;return `https://${host??process.env.VERCEL_URL??''}`};
const json=(res:ServerResponse,status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};

async function handlePrivateAsset(req:IncomingMessage,res:ServerResponse,url:URL){
  const bucket=url.searchParams.get('bucket')??'',path=url.searchParams.get('path')??'',sig=url.searchParams.get('sig')??'',exp=Number(url.searchParams.get('exp')??0);
  if(!secret()||!allowedBuckets.has(bucket)||!path||!Number.isFinite(exp)||exp<Math.floor(Date.now()/1000)||exp>Math.floor(Date.now()/1000)+86400||!safeEqual(sig,signature(bucket,path,exp))){json(res,403,{error:'asset_link_invalid_or_expired'});return true;}
  const object=await db.getBinaryObject(bucket,path);if(!object){json(res,404,{error:'asset_not_found'});return true;}
  res.writeHead(200,{'content-type':object.mimeType,'content-length':String(object.bytes.length),'cache-control':'private, max-age=300','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});res.end(object.bytes);return true;
}

async function handleStorageCompat(req:IncomingMessage,res:ServerResponse,url:URL){
  if(!internalAuthorized(req)){json(res,404,{error:'not_found'});return true;}
  const p=parts(url.pathname);const objectIndex=p.findIndex((item)=>item==='object');if(objectIndex<0)return false;
  const rest=p.slice(objectIndex+1);
  if(rest[0]==='sign'&&req.method==='POST'){
    const bucket=rest[1]??'',path=rest.slice(2).join('/');if(!allowedBuckets.has(bucket)||!path){json(res,400,{error:'invalid_storage_path'});return true;}
    const exp=Math.floor(Date.now()/1000)+3600;const sig=signature(bucket,path,exp);const signedURL=`${origin(req)}/api/assets/private?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&exp=${exp}&sig=${sig}`;json(res,200,{signedURL});return true;
  }
  const bucket=rest[0]??'';if(!allowedBuckets.has(bucket)){json(res,400,{error:'invalid_storage_bucket'});return true;}
  const path=rest.slice(1).join('/');
  if(req.method==='POST'&&path){const bytes=await readBytes(req);const tenantId=path.split('/')[0]??'';const mime=String(req.headers['content-type']??'application/octet-stream').split(';')[0]??'application/octet-stream';await db.putBinaryObject({tenantId,bucket,path,bytes,mimeType:mime,upsert:req.headers['x-upsert']==='true'});json(res,200,{Key:path});return true;}
  if(req.method==='GET'&&path){const object=await db.getBinaryObject(bucket,path);if(!object){res.writeHead(404);res.end();return true;}res.writeHead(200,{'content-type':object.mimeType,'content-length':String(object.bytes.length),'cache-control':'no-store'});res.end(object.bytes);return true;}
  if(req.method==='DELETE'&&path){await db.deleteBinaryObject(bucket,path);json(res,200,{});return true;}
  if(req.method==='DELETE'&&!path){const body=JSON.parse((await readBytes(req)).toString('utf8')||'{}') as {prefixes?:string[]};for(const item of body.prefixes??[])await db.deleteBinaryObject(bucket,item);json(res,200,{});return true;}
  json(res,405,{error:'method_not_allowed'});return true;
}

async function handleVercelSafeAi(req:IncomingMessage,res:ServerResponse,url:URL){
  if(req.method!=='POST')return false;
  const p=parts(url.pathname);
  // /api/tenants/:tenant/posts/:post/generate
  if(p[0]==='api'&&p[1]==='tenants'&&p[2]&&p[3]==='posts'&&p[4]&&p[5]==='generate'){
    try{json(res,200,await productionAi.generatePost(bearer(req),p[2],p[4]));}catch(error){json(res,500,{error:error instanceof Error?error.message:'generation_failed'});}return true;
  }
  // /api/tenants/:tenant/variants/:variant/visual
  if(p[0]==='api'&&p[1]==='tenants'&&p[2]&&p[3]==='variants'&&p[4]&&p[5]==='visual'){
    try{json(res,200,await productionAi.generateVisualForVariant(bearer(req),p[2],p[4]));}catch(error){json(res,500,{error:error instanceof Error?error.message:'visual_generation_failed'});}return true;
  }
  // Keep legacy endpoint bounded to a single text generation. The web UI performs the long queue.
  if(p[0]==='api'&&p[1]==='tenants'&&p[2]&&p[3]==='posts'&&p[4]==='generate-all'){
    try{json(res,200,await productionAi.generateAllDrafts(bearer(req),p[2],1));}catch(error){json(res,500,{error:error instanceof Error?error.message:'generation_failed'});}return true;
  }
  return false;
}

export default async function handler(req:IncomingMessage,res:ServerResponse){
  const url=new URL(req.url??'/',`https://${req.headers.host??'localhost'}`);
  if(url.pathname==='/api/assets/private'){await handlePrivateAsset(req,res,url);return;}
  if(url.pathname.startsWith('/api/storage/v1/object')){await handleStorageCompat(req,res,url);return;}
  if(await handleVercelSafeAi(req,res,url))return;
  await handleApiRequest(req,res);
}
