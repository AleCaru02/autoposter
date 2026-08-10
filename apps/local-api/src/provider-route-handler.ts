import type { IncomingMessage } from 'node:http';
import type { NormalizedPublishPayload, ProviderKey } from '@socialpilot/contracts';
import { DocumentKnowledgeService } from './document-knowledge-service.js';
import { ProviderReadinessService } from './provider-readiness-service.js';
import { ProviderWebhookService } from './provider-webhook-service.js';

const providers=new ProviderReadinessService();
const documents=new DocumentKnowledgeService();
const webhooks=new ProviderWebhookService();

const readText=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8');};
const readJson=async<T extends Record<string,unknown>>(req:IncomingMessage):Promise<T>=>{const text=await readText(req);return(text?JSON.parse(text):{}) as T;};
const bearer=(req:IncomingMessage)=>{const value=req.headers.authorization??'';if(!value.startsWith('Bearer '))throw new Error('auth_required');return value.slice(7);};
const header=(req:IncomingMessage,name:string)=>{const value=req.headers[name.toLowerCase()];return Array.isArray(value)?value[0]:value;};

export interface ProviderRouteResult {handled:boolean;status?:number;body?:unknown;}

export async function tryProviderReadinessRoute(req:IncomingMessage,url:URL,parts:string[],method:string):Promise<ProviderRouteResult>{
  if(method==='GET'&&url.pathname==='/provider-readiness/catalog')return{handled:true,status:200,body:await providers.catalog()};
  if(method==='GET'&&url.pathname==='/provider-readiness/score')return{handled:true,status:200,body:providers.readiness()};

  if(method==='POST'&&parts[0]==='webhooks'&&parts[1]==='mock'&&parts[2]){
    const rawBody=await readText(req);const provider=parts[2] as ProviderKey;
    return{handled:true,status:200,body:await webhooks.process(provider,{rawBody,headers:{'x-provider-signature':header(req,'x-provider-signature'),'x-provider-timestamp':header(req,'x-provider-timestamp')},...(header(req,'x-event-id')?{externalId:header(req,'x-event-id')}:{}),eventType:header(req,'x-event-type')??'fixture.event',...(header(req,'x-tenant-id')?{tenantId:header(req,'x-tenant-id')}:{}),...(header(req,'x-account-id')?{accountId:header(req,'x-account-id')}:{}),})};
  }

  if(parts[0]!=='tenants'||!parts[1])return{handled:false};
  const tenantId=parts[1];const token=()=>bearer(req);
  if(method==='GET'&&parts[2]==='documents')return{handled:true,status:200,body:await documents.list(token(),tenantId)};
  if(method==='GET'&&parts[2]==='knowledge-sources')return{handled:true,status:200,body:await documents.knowledgeSources(token(),tenantId)};
  if(method==='POST'&&parts[2]==='assets'&&parts[3]&&parts[4]==='ingest')return{handled:true,status:200,body:await documents.ingest(token(),tenantId,parts[3])};
  if(method==='GET'&&parts[2]==='provider-connections'&&parts.length===3)return{handled:true,status:200,body:await providers.listConnections(token(),tenantId)};
  if(method==='GET'&&parts[2]==='provider-audit')return{handled:true,status:200,body:await providers.auditLog(token(),tenantId)};

  if(parts[2]==='providers'&&parts[3]){
    const provider=parts[3];
    if(method==='POST'&&parts[4]==='connect-mock')return{handled:true,status:200,body:await providers.connectMock(token(),tenantId,provider)};
    if(method==='POST'&&parts[4]==='oauth-start')return{handled:true,status:200,body:await providers.startOAuth(token(),tenantId,provider,await readJson(req))};
    if(method==='POST'&&parts[4]==='oauth-complete')return{handled:true,status:200,body:await providers.completeOAuth(token(),tenantId,provider,await readJson(req) as {state:string;code?:string;redirectUri?:string})};
  }

  if(parts[2]==='provider-connections'&&parts[3]){
    const connectionId=parts[3];
    if(method==='GET'&&parts[4]==='health')return{handled:true,status:200,body:await providers.connectionHealth(token(),tenantId,connectionId)};
    if(method==='POST'&&parts[4]==='reconnect')return{handled:true,status:200,body:await providers.reconnect(token(),tenantId,connectionId)};
    if(method==='POST'&&parts[4]==='revoke')return{handled:true,status:200,body:await providers.revoke(token(),tenantId,connectionId)};
    if(method==='POST'&&parts[4]==='simulate'){const body=await readJson<{scenario:string}>(req);return{handled:true,status:200,body:await providers.simulate(token(),tenantId,connectionId,body.scenario as Parameters<typeof providers.simulate>[3])};}
  }

  if(parts[2]==='provider-accounts'&&parts[3]){
    const accountId=parts[3];
    if(method==='POST'&&parts[4]==='select'){const body=await readJson<{connectionId:string}>(req);return{handled:true,status:200,body:await providers.selectAccount(token(),tenantId,body.connectionId,accountId)};}
    if(method==='POST'&&parts[4]==='validate')return{handled:true,status:200,body:await providers.validate(token(),tenantId,accountId,await readJson(req) as unknown as NormalizedPublishPayload)};
    if(method==='POST'&&parts[4]==='dry-run')return{handled:true,status:200,body:await providers.dryRun(token(),tenantId,accountId,await readJson(req) as unknown as NormalizedPublishPayload)};
    if(method==='POST'&&parts[4]==='mock-publish')return{handled:true,status:200,body:await providers.mockPublish(token(),tenantId,accountId,await readJson(req) as unknown as NormalizedPublishPayload)};
    if(method==='GET'&&parts[4]==='analytics')return{handled:true,status:200,body:await providers.analytics(token(),tenantId,accountId,url.searchParams.get('externalPostId')??'fixture-post')};
  }

  return{handled:false};
}
