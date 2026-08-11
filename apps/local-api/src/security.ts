import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const splitCsv=(value:string|undefined)=>String(value??'').split(',').map((item)=>item.trim()).filter(Boolean);
const localOrigins=['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:3000','http://localhost:3000'];
export const allowedOrigins=()=>new Set([...localOrigins,...splitCsv(process.env.CORS_ALLOWED_ORIGINS)]);

export const corsHeaders=(req:IncomingMessage):Record<string,string>=>{const origin=req.headers.origin;const allowed=allowedOrigins();return origin&&allowed.has(origin)?{'access-control-allow-origin':origin,'access-control-allow-headers':'content-type, authorization, x-provider-signature, x-provider-timestamp, x-event-id, x-event-type, x-tenant-id, x-account-id','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-max-age':'600','vary':'Origin'}:{}};

export const securityHeaders=():Record<string,string>=>({
  'x-content-type-options':'nosniff',
  'x-frame-options':'DENY',
  'referrer-policy':'strict-origin-when-cross-origin',
  'permissions-policy':'camera=(), microphone=(), geolocation=()',
  'cross-origin-resource-policy':'same-site',
  'content-security-policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
});

export const clientSubject=(req:IncomingMessage):string=>{const forwarded=String(req.headers['x-forwarded-for']??'').split(',')[0]?.trim();const raw=forwarded||req.socket.remoteAddress||'unknown';return createHash('sha256').update(raw).digest('hex');};

type Bucket={windowStart:number;hits:number};
export class FixedWindowRateLimiter{
  private readonly buckets=new Map<string,Bucket>();
  consume(input:{scope:string;subject:string;limit:number;windowMs:number;now?:number}){const now=input.now??Date.now();const windowStart=Math.floor(now/input.windowMs)*input.windowMs;const key=`${input.scope}:${input.subject}:${windowStart}`;const current=this.buckets.get(key)??{windowStart,hits:0};current.hits+=1;this.buckets.set(key,current);if(this.buckets.size>10_000)for(const [bucketKey,bucket]of this.buckets)if(bucket.windowStart+input.windowMs<now)this.buckets.delete(bucketKey);return{allowed:current.hits<=input.limit,remaining:Math.max(0,input.limit-current.hits),retryAfterSeconds:Math.max(1,Math.ceil((windowStart+input.windowMs-now)/1000))};}
}

export const ratePolicy=(pathname:string):{scope:string;limit:number;windowMs:number}|null=>{
  if(pathname==='/auth/register'||pathname==='/auth/login')return{scope:'auth',limit:Number(process.env.RATE_LIMIT_AUTH_PER_MINUTE??20),windowMs:60_000};
  if(/^\/tenants\/[^/]+\/scan$/.test(pathname))return{scope:'scanner',limit:Number(process.env.RATE_LIMIT_SCANNER_PER_MINUTE??6),windowMs:60_000};
  if(/\/(ai|generate|strategy|chat)(\/|$)/.test(pathname)||pathname==='/chat/public')return{scope:'ai-future',limit:Number(process.env.RATE_LIMIT_AI_PER_MINUTE??30),windowMs:60_000};
  return null;
};

export const readJsonLimited=async<T extends Record<string,unknown>>(req:IncomingMessage,maxBytes=Number(process.env.MAX_JSON_BODY_BYTES??1_000_000)):Promise<T>=>{const chunks:Buffer[]=[];let total=0;for await(const chunk of req){const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=buffer.byteLength;if(total>maxBytes)throw new Error('request_body_too_large');chunks.push(buffer);}const text=Buffer.concat(chunks).toString('utf-8');return(text?JSON.parse(text):{})as T;};

const safeCodes=new Set(['auth_required','tenant_access_denied','platform_admin_required','FEATURE_NOT_ENTITLED','website_required','plan_not_found','tenant_not_found','invalid_ai_budget','REAL_PROVIDER_NOT_CONFIGURED','REAL_DATA_UNAVAILABLE','request_body_too_large','rate_limit_exceeded','account_owns_active_tenant']);
export const sanitizedError=(error:unknown):string=>{const raw=error instanceof Error?error.message:String(error);if((process.env.APP_ENV??'LOCAL')==='LOCAL')return raw;for(const code of safeCodes)if(raw.includes(code))return code;return'internal_error';};
