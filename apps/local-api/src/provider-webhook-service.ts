import { createHash, randomUUID } from 'node:crypto';
import type { ProviderKey } from '@socialpilot/contracts';
import { HmacWebhookVerifier, WebhookCore } from '../../../packages/runtime/src/index.js';
import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);
const now=()=>new Date().toISOString();
const jsonHeaders={'content-type':'application/json'};

interface AccountRow {id:string;tenant_id:string;connection_id:string;external_account_id:string;platform:string;}
interface EventRow {id:string;provider:string;external_id:string|null;payload_hash:string;event_type:string;processing_status:string;}

export class ProviderWebhookService {
  private readonly db=new LocalSupabaseClient();
  private readonly core=new WebhookCore();
  private readonly secret=process.env.LOCAL_PROVIDER_WEBHOOK_SECRET??'local-provider-webhook-secret';

  sign(provider:ProviderKey,rawBody:string,timestampMs:number){return new HmacWebhookVerifier(provider,this.secret).sign(rawBody,timestampMs);}

  async process(provider:ProviderKey,input:{rawBody:string;headers:Record<string,string|undefined>;externalId?:string;eventType:string;tenantId?:string;accountId?:string;nowMs?:number}){
    const nowMs=input.nowMs??Date.now();
    const verifier=new HmacWebhookVerifier(provider,this.secret);
    const payloadHash=createHash('sha256').update(input.rawBody).digest('hex');
    const existing=input.externalId
      ?await this.db.serviceRest<EventRow[]>(`/rest/v1/provider_webhook_events?select=*&provider=eq.${q(provider)}&external_id=eq.${q(input.externalId)}&limit=1`)
      :await this.db.serviceRest<EventRow[]>(`/rest/v1/provider_webhook_events?select=*&provider=eq.${q(provider)}&event_type=eq.${q(input.eventType)}&payload_hash=eq.${payloadHash}&limit=1`);
    if(existing[0])return{status:'IGNORED_DUPLICATE',eventId:existing[0].id,payloadHash};

    const processed=this.core.process({provider,eventType:input.eventType,...(input.externalId?{externalId:input.externalId}:{}),rawBody:input.rawBody,headers:input.headers,nowMs,verifier});
    let tenantId=input.tenantId;let connectionId:string|undefined;let accountId=input.accountId;
    if(accountId){
      const account=(await this.db.serviceRest<AccountRow[]>(`/rest/v1/social_accounts?select=*&id=eq.${q(accountId)}&limit=1`))[0];
      if(!account)throw new Error('WEBHOOK_ACCOUNT_MAPPING_INVALID');
      if(tenantId&&account.tenant_id!==tenantId)throw new Error('WEBHOOK_TENANT_MAPPING_INVALID');
      tenantId=account.tenant_id;connectionId=account.connection_id;accountId=account.id;
    }
    const body:{tenant_id?:string;connection_id?:string;account_id?:string;provider:ProviderKey;event_type:string;external_id:string|null;payload_hash:string;signature_status:'verified';processing_status:'PROCESSED';attempts:number;correlation_id:string;provider_timestamp:string;received_at:string;processed_at:string;metadata:Record<string,unknown>}={provider,event_type:input.eventType,external_id:input.externalId??null,payload_hash:processed.payloadHash,signature_status:'verified',processing_status:'PROCESSED',attempts:1,correlation_id:randomUUID(),provider_timestamp:new Date(Number(input.headers['x-provider-timestamp']??nowMs)).toISOString(),received_at:now(),processed_at:now(),metadata:{fixture:true}};
    if(tenantId)body.tenant_id=tenantId;if(connectionId)body.connection_id=connectionId;if(accountId)body.account_id=accountId;
    const rows=await this.db.serviceRest<Array<{id:string}>>('/rest/v1/provider_webhook_events',{method:'POST',headers:jsonHeaders,body:jsonBody(body)});
    const event=rows[0];if(!event)throw new Error('WEBHOOK_PERSIST_FAILED');
    return{status:'PROCESSED',eventId:event.id,payloadHash};
  }
}
