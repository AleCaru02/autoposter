import { createHash, randomBytes } from 'node:crypto';
import { LocalSupabaseClient, jsonBody } from './db.js';
import { LocalAssetVisualReadinessService } from './asset-visual-readiness-service.js';

const q=(value:string)=>encodeURIComponent(value);
const now=()=>new Date().toISOString();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(18).toString('base64url');
const trim=(value:string,max:number)=>value.length<=max?value:`${value.slice(0,Math.max(1,max-1)).trimEnd()}…`;

interface TelegramConnectionRow {
  id:string;
  tenant_id:string;
  status:'disconnected'|'pending'|'connected'|'disabled';
  telegram_chat_id:string|null;
  telegram_user_id:string|null;
  connected_at:string|null;
  last_verified_at:string|null;
  metadata:Record<string,unknown>;
}

interface TelegramApprovalRequestRow {
  id:string;
  tenant_id:string;
  post_variant_id:string;
  telegram_connection_id:string|null;
  callback_token_hash:string;
  telegram_chat_id:string|null;
  telegram_message_id:string|null;
  status:string;
  expires_at:string;
}

interface TelegramUpdate {
  message?: {
    message_id:number;
    text?:string;
    chat:{id:number|string};
    from?:{id:number|string;username?:string;first_name?:string};
  };
  callback_query?: {
    id:string;
    data?:string;
    from:{id:number|string;username?:string;first_name?:string};
    message?:{message_id:number;chat:{id:number|string}};
  };
}

interface TelegramApiResponse<T> { ok:boolean; result?:T; description?:string }

export class TelegramApprovalService {
  private readonly db=new LocalSupabaseClient();
  private readonly visual=new LocalAssetVisualReadinessService();

  private get botToken(){return String(process.env.TELEGRAM_BOT_TOKEN??'').trim();}
  private get webhookSecret(){return String(process.env.TELEGRAM_WEBHOOK_SECRET??'').trim();}
  private get webhookUrl(){return String(process.env.TELEGRAM_WEBHOOK_URL??'').trim();}
  private get appBaseUrl(){return String(process.env.APP_BASE_URL??'').replace(/\/$/,'');}
  private get enabled(){return process.env.TELEGRAM_LIVE==='true'&&Boolean(this.botToken&&this.webhookSecret&&this.webhookUrl);}

  async status(userToken:string,tenantId:string){
    await this.db.requireTenantRole(userToken,tenantId);
    const rows=await this.db.userRest<TelegramConnectionRow[]>(userToken,`/rest/v1/telegram_connections?select=*&tenant_id=eq.${q(tenantId)}&limit=1`);
    const connection=rows[0]??null;
    return {
      configured:this.enabled,
      status:this.enabled?(connection?.status??'disconnected'):'not_configured',
      connectedAt:connection?.connected_at??null,
      lastVerifiedAt:connection?.last_verified_at??null,
      botUsername:connection?.metadata?.botUsername??null,
    };
  }

  async createPairing(userToken:string,tenantId:string){
    this.requireConfigured();
    const actor=await this.db.requireTenantRole(userToken,tenantId,['owner','admin','editor']);
    const me=await this.telegram<{username?:string}>('getMe',{});
    const botUsername=String(me.username??'').trim();
    if(!botUsername)throw new Error('TELEGRAM_BOT_USERNAME_MISSING');
    await this.ensureWebhook();

    const raw=token();
    const tokenHash=hash(raw);
    await this.db.serviceRest(`/rest/v1/telegram_pairing_requests?tenant_id=eq.${q(tenantId)}&used_at=is.null`,{method:'DELETE',headers:{'content-profile':'app_private','accept-profile':'app_private',prefer:'return=minimal'}}).catch(()=>undefined);
    await this.db.serviceRest('/rest/v1/telegram_pairing_requests',{method:'POST',headers:{'content-profile':'app_private','accept-profile':'app_private',prefer:'return=minimal'},body:jsonBody({tenant_id:tenantId,token_hash:tokenHash,requested_by:actor.userId,expires_at:new Date(Date.now()+15*60_000).toISOString()})});

    const rows=await this.db.serviceRest<TelegramConnectionRow[]>('/rest/v1/telegram_connections?on_conflict=tenant_id',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=representation'},body:jsonBody({tenant_id:tenantId,status:'pending',telegram_chat_id:null,telegram_user_id:null,metadata:{botUsername}})});
    const connection=rows[0];
    if(!connection)throw new Error('TELEGRAM_CONNECTION_CREATE_FAILED');
    return {status:'pending',botUsername,link:`https://t.me/${botUsername}?start=pa_${raw}`,expiresInSeconds:900};
  }

  async disconnect(userToken:string,tenantId:string){
    await this.db.requireTenantRole(userToken,tenantId,['owner','admin','editor']);
    await this.db.serviceRest(`/rest/v1/telegram_connections?tenant_id=eq.${q(tenantId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'disconnected',telegram_chat_id:null,telegram_user_id:null,last_verified_at:now()})});
    return {ok:true};
  }

  async sendVariantPreview(userToken:string,tenantId:string,variantId:string){
    this.requireConfigured();
    await this.db.requireTenantRole(userToken,tenantId,['owner','admin','editor']);
    const connection=this.one(await this.db.userRest<TelegramConnectionRow[]>(userToken,`/rest/v1/telegram_connections?select=*&tenant_id=eq.${q(tenantId)}&status=eq.connected&limit=1`),'TELEGRAM_NOT_CONNECTED');
    if(!connection.telegram_chat_id)throw new Error('TELEGRAM_NOT_CONNECTED');
    const variant=this.one(await this.db.userRest<Array<any>>(userToken,`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(variantId)}&limit=1`),'variant_not_found');
    const post=this.one(await this.db.userRest<Array<any>>(userToken,`/rest/v1/posts?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(String(variant.post_id))}&limit=1`),'post_not_found');
    if(variant.platform_decision==='skip')throw new Error('VARIANT_SKIPPED');
    if(variant.approval_status==='approved')throw new Error('VARIANT_ALREADY_APPROVED');

    const visual=await this.visual.latestVisual(userToken,tenantId,variantId).catch(()=>null) as any;
    const previewUrl=Array.isArray(visual?.preview_urls)?String(visual.preview_urls[0]??''):'';
    const callbackToken=token();
    const callbackHash=hash(callbackToken);
    const expiresAt=new Date(Date.now()+7*24*60*60_000).toISOString();

    await this.db.serviceRest(`/rest/v1/telegram_approval_requests?tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&status=eq.pending`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'expired',acted_at:now()})});
    const requests=await this.db.serviceRest<TelegramApprovalRequestRow[]>('/rest/v1/telegram_approval_requests',{method:'POST',body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,telegram_connection_id:connection.id,callback_token_hash:callbackHash,telegram_chat_id:String(connection.telegram_chat_id),status:'pending',expires_at:expiresAt,metadata:{postId:post.id,platform:variant.platform}})});
    const approvalRequest=this.one(requests,'TELEGRAM_APPROVAL_REQUEST_CREATE_FAILED');

    const scheduled=variant.scheduled_at?new Date(String(variant.scheduled_at)).toLocaleString('it-IT'):'Non programmato';
    const previewLink=this.appBaseUrl?`${this.appBaseUrl}/app/posts/${encodeURIComponent(String(post.id))}`:'';
    const text=[
      `📝 ${String(post.topic??'Contenuto')}`,
      `Canale: ${this.platformLabel(String(variant.platform))}`,
      `Programmazione: ${scheduled}`,
      '',
      trim(String(variant.hook??''),300),
      trim(String(variant.caption??''),1200),
      Array.isArray(variant.hashtags)&&variant.hashtags.length?trim(variant.hashtags.join(' '),400):'',
      previewLink?`\nPreview completa: ${previewLink}`:'',
      '\nDecidi tu: nessuna pubblicazione parte senza approvazione.',
    ].filter(Boolean).join('\n');
    const replyMarkup={inline_keyboard:[
      [{text:'✅ APPROVA / PUBBLICA',callback_data:`pa:${callbackToken}:approve`}],
      [{text:'❌ NON PUBBLICARE',callback_data:`pa:${callbackToken}:reject`}],
    ]};

    let sent:any;
    if(this.isTelegramFetchable(previewUrl)){
      sent=await this.telegram<any>('sendPhoto',{chat_id:connection.telegram_chat_id,photo:previewUrl,caption:trim(text,1000),reply_markup:replyMarkup}).catch(()=>null);
    }
    if(!sent)sent=await this.telegram<any>('sendMessage',{chat_id:connection.telegram_chat_id,text:trim(text,3900),disable_web_page_preview:false,reply_markup:replyMarkup});
    await this.db.serviceRest(`/rest/v1/telegram_approval_requests?id=eq.${q(approvalRequest.id)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({telegram_message_id:String(sent.message_id??'')})});
    return {ok:true,requestId:approvalRequest.id,status:'pending'};
  }

  async handleWebhook(secretHeader:string|undefined,update:TelegramUpdate){
    this.requireConfigured();
    if(!secretHeader||secretHeader!==this.webhookSecret)throw new Error('TELEGRAM_WEBHOOK_SIGNATURE_INVALID');
    if(update.message?.text?.startsWith('/start '))return this.handleStart(update.message);
    if(update.callback_query?.data?.startsWith('pa:'))return this.handleCallback(update.callback_query);
    return {ok:true,ignored:true};
  }

  private async handleStart(message:NonNullable<TelegramUpdate['message']>){
    const raw=String(message.text??'').split(/\s+/)[1]??'';
    if(!raw.startsWith('pa_')){await this.telegram('sendMessage',{chat_id:message.chat.id,text:'Link di collegamento non valido. Apri Post Automatici e genera un nuovo link Telegram.'});return {ok:true,paired:false};}
    const tokenHash=hash(raw.slice(3));
    const rows=await this.db.serviceRest<Array<any>>(`/rest/v1/telegram_pairing_requests?select=*&token_hash=eq.${q(tokenHash)}&used_at=is.null&expires_at=gt.${q(now())}&limit=1`,{headers:{'content-profile':'app_private','accept-profile':'app_private'}});
    const pairing=rows[0];
    if(!pairing){await this.telegram('sendMessage',{chat_id:message.chat.id,text:'Link scaduto o già usato. Generane uno nuovo da Post Automatici.'});return {ok:true,paired:false};}
    const connections=await this.db.serviceRest<TelegramConnectionRow[]>(`/rest/v1/telegram_connections?tenant_id=eq.${q(String(pairing.tenant_id))}&limit=1`);
    const connection=this.one(connections,'TELEGRAM_CONNECTION_NOT_FOUND');
    await this.db.serviceRest(`/rest/v1/telegram_connections?id=eq.${q(connection.id)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'connected',telegram_chat_id:String(message.chat.id),telegram_user_id:String(message.from?.id??''),connected_at:now(),last_verified_at:now(),metadata:{...(connection.metadata??{}),telegramUsername:message.from?.username??null}})});
    await this.db.serviceRest(`/rest/v1/telegram_pairing_requests?id=eq.${q(String(pairing.id))}`,{method:'PATCH',headers:{'content-profile':'app_private','accept-profile':'app_private',prefer:'return=minimal'},body:jsonBody({used_at:now()})});
    await this.telegram('sendMessage',{chat_id:message.chat.id,text:'✅ Telegram collegato a Post Automatici. Da ora le anteprime possono arrivare qui per la tua approvazione.'});
    return {ok:true,paired:true};
  }

  private async handleCallback(callback:NonNullable<TelegramUpdate['callback_query']>){
    const [,raw,action]=String(callback.data??'').split(':');
    if(!raw||!['approve','reject'].includes(action??'')){await this.answerCallback(callback.id,'Azione non valida.');return {ok:true,handled:false};}
    const requests=await this.db.serviceRest<TelegramApprovalRequestRow[]>(`/rest/v1/telegram_approval_requests?select=*&callback_token_hash=eq.${q(hash(raw))}&status=eq.pending&expires_at=gt.${q(now())}&limit=1`);
    const request=requests[0];
    if(!request){await this.answerCallback(callback.id,'Anteprima scaduta o già gestita.');return {ok:true,handled:false};}
    const connections=await this.db.serviceRest<TelegramConnectionRow[]>(`/rest/v1/telegram_connections?select=*&id=eq.${q(String(request.telegram_connection_id??''))}&tenant_id=eq.${q(request.tenant_id)}&status=eq.connected&limit=1`);
    const connection=connections[0];
    if(!connection||String(connection.telegram_user_id)!==String(callback.from.id)){await this.answerCallback(callback.id,'Utente Telegram non autorizzato.');throw new Error('TELEGRAM_USER_NOT_AUTHORIZED');}

    if(action==='approve')await this.approveFromTelegram(request);
    else await this.rejectFromTelegram(request);
    await this.answerCallback(callback.id,action==='approve'?'Approvato.':'Non verrà pubblicato.');
    if(callback.message)await this.telegram('editMessageReplyMarkup',{chat_id:callback.message.chat.id,message_id:callback.message.message_id,reply_markup:{inline_keyboard:[]}}).catch(()=>undefined);
    return {ok:true,handled:true,action};
  }

  private async approveFromTelegram(request:TelegramApprovalRequestRow){
    const existing=await this.db.serviceRest<Array<{id:string}>>(`/rest/v1/post_approvals?select=id&tenant_id=eq.${q(request.tenant_id)}&post_variant_id=eq.${q(request.post_variant_id)}&source=eq.telegram&limit=1`);
    if(!existing[0])await this.db.serviceRest('/rest/v1/post_approvals',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:request.tenant_id,post_variant_id:request.post_variant_id,approved_by:null,source:'telegram'})});
    const variants=await this.db.serviceRest<Array<any>>(`/rest/v1/post_variants?select=*&tenant_id=eq.${q(request.tenant_id)}&id=eq.${q(request.post_variant_id)}&limit=1`);
    const variant=this.one(variants,'variant_not_found');
    await this.db.serviceRest(`/rest/v1/post_variants?id=eq.${q(request.post_variant_id)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({approval_status:'approved',status:'approved'})});
    await this.db.serviceRest('/rest/v1/publication_jobs?on_conflict=tenant_id,idempotency_key',{method:'POST',headers:{prefer:'resolution=ignore-duplicates,return=minimal'},body:jsonBody({tenant_id:request.tenant_id,post_variant_id:request.post_variant_id,platform:variant.platform,scheduled_at:variant.scheduled_at??now(),idempotency_key:`${request.tenant_id}:${request.post_variant_id}:v1`,status:'queued',max_attempts:3})});
    await this.db.serviceRest(`/rest/v1/post_variants?id=eq.${q(request.post_variant_id)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'scheduled'})});
    await this.db.serviceRest(`/rest/v1/telegram_approval_requests?id=eq.${q(request.id)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'approved',last_action:'publish',acted_at:now()})});
    await this.reconcilePost(String(variant.post_id),request.tenant_id);
  }

  private async rejectFromTelegram(request:TelegramApprovalRequestRow){
    const variants=await this.db.serviceRest<Array<any>>(`/rest/v1/post_variants?select=*&tenant_id=eq.${q(request.tenant_id)}&id=eq.${q(request.post_variant_id)}&limit=1`);
    const variant=this.one(variants,'variant_not_found');
    await this.db.serviceRest('/rest/v1/post_rejections',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:request.tenant_id,post_variant_id:request.post_variant_id,rejected_by:null,reason:'Non pubblicare · decisione Telegram',source:'telegram'})});
    await this.db.serviceRest(`/rest/v1/post_variants?id=eq.${q(request.post_variant_id)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({approval_status:'rejected',status:'rejected'})});
    await this.db.serviceRest(`/rest/v1/telegram_approval_requests?id=eq.${q(request.id)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'rejected',last_action:'reject',acted_at:now()})});
    await this.reconcilePost(String(variant.post_id),request.tenant_id);
  }

  private async reconcilePost(postId:string,tenantId:string){
    const variants=await this.db.serviceRest<Array<any>>(`/rest/v1/post_variants?select=id,platform_decision,approval_status,status&tenant_id=eq.${q(tenantId)}&post_id=eq.${q(postId)}`);
    const active=variants.filter((item)=>item.platform_decision!=='skip');
    const pending=active.some((item)=>!['approved','rejected'].includes(String(item.approval_status)));
    const approved=active.some((item)=>item.approval_status==='approved');
    const next=pending?'awaiting_approval':approved?'scheduled':'rejected';
    await this.db.serviceRest(`/rest/v1/posts?id=eq.${q(postId)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:next})});
  }

  private requireConfigured(){if(!this.enabled)throw new Error('TELEGRAM_NOT_CONFIGURED');}
  private one<T>(rows:T[],message:string):T{const row=rows[0];if(!row)throw new Error(message);return row;}

  private async ensureWebhook(){
    await this.telegram('setWebhook',{url:this.webhookUrl,secret_token:this.webhookSecret,allowed_updates:['message','callback_query']});
  }

  private async answerCallback(callbackQueryId:string,text:string){await this.telegram('answerCallbackQuery',{callback_query_id:callbackQueryId,text,show_alert:false}).catch(()=>undefined);}

  private async telegram<T=any>(method:string,payload:Record<string,unknown>):Promise<T>{
    this.requireConfigured();
    const response=await fetch(`https://api.telegram.org/bot${this.botToken}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10_000)});
    const body=await response.json().catch(()=>({})) as TelegramApiResponse<T>;
    if(!response.ok||!body.ok)throw new Error(`TELEGRAM_API_${method}:${body.description??response.status}`);
    return body.result as T;
  }

  private platformLabel(platform:string){return platform==='google_business_profile'?'Google Business Profile':platform.charAt(0).toUpperCase()+platform.slice(1);}

  private isTelegramFetchable(value:string){
    try{
      const url=new URL(value);
      if(url.protocol!=='https:')return false;
      const host=url.hostname.toLowerCase();
      if(host==='localhost'||host==='127.0.0.1'||host==='::1'||host.endsWith('.local'))return false;
      if(/^10\./.test(host)||/^192\.168\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host))return false;
      return true;
    }catch{return false;}
  }
}
