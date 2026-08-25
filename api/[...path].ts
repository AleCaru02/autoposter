import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LocalSupabaseClient } from '../apps/local-api/src/db.js';
import { handleApiRequest } from '../apps/local-api/src/server.js';

const db=new LocalSupabaseClient();
const allowedBuckets=new Set(['brand-assets','post-assets','tenant-documents']);
const secret=()=>process.env.ASSET_SIGNING_SECRET?.trim()??'';
const parts=(pathname:string)=>pathname.split('/').filter(Boolean).map(decodeURIComponent);
const safeEqual=(left:string,right:string)=>{try{const a=Buffer.from(left,'hex'),b=Buffer.from(right,'hex');return a.length===b.length&&a.length>0&&timingSafeEqual(a,b)}catch{return false}};
const signature=(bucket:string,path:string,exp:number)=>createHmac('sha256',secret()).update(`${bucket}\n${path}\n${exp}`).digest('hex');
const readBytes=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks)};
const internalAuthorized=(req:IncomingMessage)=>{const key=secret();if(!key)return false;const api=Array.isArray(req.headers.apikey)?req.headers.apikey[0]:req.headers.apikey;const auth=Array.isArray(req.headers.authorization)?req.headers.authorization[0]:req.headers.authorization;return api===key&&auth===`Bearer ${key}`};
const origin=(req:IncomingMessage)=>{const host=Array.isArray(req.headers.host)?req.headers.host[0]:req.headers.host;return `https://${host??process.env.VERCEL_URL??''}`};

async function handlePrivateAsset(req:IncomingMessage,res:ServerResponse,url:URL){
  const bucket=url.searchParams.get('bucket')??'',path=url.searchParams.get('path')??'',sig=url.searchParams.get('sig')??'',exp=Number(url.searchParams.get('exp')??0);
  if(!secret()||!allowedBuckets.has(bucket)||!path||!Number.isFinite(exp)||exp<Math.floor(Date.now()/1000)||exp>Math.floor(Date.now()/1000)+86400||!safeEqual(sig,signature(bucket,path,exp))){res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'asset_link_invalid_or_expired'}));return true;}
  const object=await db.getBinaryObject(bucket,path);if(!object){res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'asset_not_found'}));return true;}
  res.writeHead(200,{'content-type':object.mimeType,'content-length':String(object.bytes.length),'cache-control':'private, max-age=300','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});res.end(object.bytes);return true;
}

async function handleStorageCompat(req:IncomingMessage,res:ServerResponse,url:URL){
  if(!internalAuthorized(req)){res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'not_found'}));return true;}
  const p=parts(url.pathname);const objectIndex=p.findIndex((item)=>item==='object');if(objectIndex<0)return false;
  const rest=p.slice(objectIndex+1);
  if(rest[0]==='sign'&&req.method==='POST'){
    const bucket=rest[1]??'',path=rest.slice(2).join('/');if(!allowedBuckets.has(bucket)||!path){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'invalid_storage_path'}));return true;}
    const exp=Math.floor(Date.now()/1000)+3600;const sig=signature(bucket,path,exp);const signedURL=`${origin(req)}/api/assets/private?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}&exp=${exp}&sig=${sig}`;
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({signedURL}));return true;
  }
  const bucket=rest[0]??'';if(!allowedBuckets.has(bucket)){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'invalid_storage_bucket'}));return true;}
  const path=rest.slice(1).join('/');
  if(req.method==='POST'&&path){const bytes=await readBytes(req);const tenantId=path.split('/')[0]??'';const mime=String(req.headers['content-type']??'application/octet-stream').split(';')[0]??'application/octet-stream';await db.putBinaryObject({tenantId,bucket,path,bytes,mimeType:mime,upsert:req.headers['x-upsert']==='true'});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({Key:path}));return true;}
  if(req.method==='GET'&&path){const object=await db.getBinaryObject(bucket,path);if(!object){res.writeHead(404);res.end();return true;}res.writeHead(200,{'content-type':object.mimeType,'content-length':String(object.bytes.length),'cache-control':'no-store'});res.end(object.bytes);return true;}
  if(req.method==='DELETE'&&path){await db.deleteBinaryObject(bucket,path);res.writeHead(200,{'content-type':'application/json'});res.end('{}');return true;}
  if(req.method==='DELETE'&&!path){const body=JSON.parse((await readBytes(req)).toString('utf8')||'{}') as {prefixes?:string[]};for(const item of body.prefixes??[])await db.deleteBinaryObject(bucket,item);res.writeHead(200,{'content-type':'application/json'});res.end('{}');return true;}
  res.writeHead(405,{'content-type':'application/json'});res.end(JSON.stringify({error:'method_not_allowed'}));return true;
}

export default async function handler(req:IncomingMessage,res:ServerResponse){
  const url=new URL(req.url??'/',`https://${req.headers.host??'localhost'}`);
  if(url.pathname==='/api/assets/private'){await handlePrivateAsset(req,res,url);return;}
  if(url.pathname.startsWith('/api/storage/v1/object')){await handleStorageCompat(req,res,url);return;}
  await handleApiRequest(req,res);
}
