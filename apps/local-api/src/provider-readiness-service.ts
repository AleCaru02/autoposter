import { createHash, randomUUID } from 'node:crypto';
import type { NormalizedPublishPayload, ProviderAccount, ProviderKey, ProviderSocialPlatform } from '@socialpilot/contracts';
import {
  ConnectionLifecycle, EnvelopeCredentialVault, MockOAuthProvider, OAuthStateManager, PlanEntitlementGuard,
  buildFixtureAccounts, createFixtureProvider, providerFixtureConfigs, readinessRow, type FixtureScenario,
} from '../../../packages/runtime/src/index.js';
import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);
const now=()=>new Date().toISOString();
const jsonHeaders={'content-type':'application/json'};
const localCallback='http://127.0.0.1:8787/oauth/mock/callback';
const mapHealth=(value:string):ProviderAccount['health']=>({connected:'CONNECTED',degraded:'DEGRADED',expiring:'EXPIRING',expired:'EXPIRED',reauth_required:'REAUTH_REQUIRED',permission_missing:'PERMISSION_MISSING',rate_limited:'RATE_LIMITED',provider_error:'PROVIDER_ERROR',disconnected:'DISCONNECTED'}[value]??'CONNECTED') as ProviderAccount['health'];
const dbHealth=(value:ProviderAccount['health'])=>value.toLowerCase();
const platformForConnection=(provider:string):ProviderSocialPlatform=>provider==='meta'?'facebook':provider as ProviderSocialPlatform;
const providerForAccount=(platform:string):ProviderSocialPlatform=>platform as ProviderSocialPlatform;
const subjectFor=(tenantId:string,provider:string)=>`mock-${provider}-${createHash('sha256').update(`${tenantId}:${provider}`).digest('hex').slice(0,16)}`;

interface ConnectionRow {
  id:string;tenant_id:string;platform:ProviderSocialPlatform;connection_status:string;approval_mode:'auto'|'manual';granted_scopes:string[];token_expires_at:string|null;
  connected_at:string|null;last_checked_at:string|null;metadata:Record<string,unknown>;provider_subject_id:string|null;provider_connection_key:string|null;
  last_error_code:string|null;last_error_message:string|null;recommended_action:string|null;last_publish_at:string|null;reconnect_count:number;
}
interface AccountRow {
  id:string;tenant_id:string;connection_id:string;platform:ProviderSocialPlatform;external_account_id:string;account_type:string|null;display_name:string|null;username:string|null;location_id:string|null;
  is_selected:boolean;metadata:Record<string,unknown>;health_status:string;granted_scopes:string[];capabilities:string[];missing_permissions:string[];token_expires_at:string|null;last_checked_at:string|null;last_publish_at:string|null;last_error_code:string|null;last_error_message:string|null;
}
interface Entitlements {platforms:string[];posts_per_week:number;monthly_post_limit:number|null;auto_publish_allowed:boolean;image_generation_allowed?:boolean;analytics_level:string;premium_chat_allowed?:boolean;}

export class ProviderReadinessService {
  private readonly db=new LocalSupabaseClient();
  private readonly oauth=new OAuthStateManager([localCallback,'http://localhost:8787/oauth/mock/callback']);
  private readonly vault=new EnvelopeCredentialVault(Buffer.alloc(32,19));
  private readonly entitlementGuard=new PlanEntitlementGuard();
  private readonly lifecycle=new ConnectionLifecycle();
  private readonly fixtureProviders=new Map<string,ReturnType<typeof createFixtureProvider>>();

  async catalog(){
    return Object.fromEntries(Object.entries(providerFixtureConfigs).map(([platform,config])=>[platform,{provider:config.provider,apiLabel:config.apiLabel,capabilities:config.capabilities,formats:Object.keys(config.formats),permissions:config.permissions,sourceRef:config.sourceRef}]));
  }

  async listConnections(token:string,tenantId:string){
    await this.db.requireTenantRole(token,tenantId);
    const connections=await this.db.userRest<ConnectionRow[]>(token,`/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&order=created_at.asc`);
    const accounts=await this.db.userRest<AccountRow[]>(token,`/rest/v1/social_accounts?select=*&tenant_id=eq.${q(tenantId)}&order=created_at.asc`);
    return connections.map((connection)=>({
      ...connection,
      provider:String(connection.metadata.auth_provider??connection.platform),
      health:this.connectionHealth(connection,accounts.filter((item)=>item.connection_id===connection.id)),
      accounts:accounts.filter((item)=>item.connection_id===connection.id).map((item)=>this.mapAccount(item)),
    }));
  }

  async startOAuth(token:string,tenantId:string,provider:string,input:{redirectUri?:string}={}){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin']);
    const scopes=this.scopesFor(provider);
    const redirectUri=input.redirectUri??localCallback;
    const result=this.oauth.start({tenantId,userId:auth.userId,provider:this.providerKey(provider),redirectUri,scopes,usePkce:true});
    await this.audit(tenantId,auth.userId,provider,'oauth_start','success',{redirectUri,scopeCount:scopes.length});
    return result;
  }

  async completeOAuth(token:string,tenantId:string,provider:string,input:{state:string;code?:string;redirectUri?:string}){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin']);
    const redirectUri=input.redirectUri??localCallback;
    const providerKey=this.providerKey(provider);
    const state=this.oauth.consume({state:input.state,provider:providerKey,tenantId,userId:auth.userId,redirectUri});
    const oauthProvider=new MockOAuthProvider(platformForConnection(provider));
    const callback={state:input.state,provider:providerKey,tenantId,userId:auth.userId,redirectUri,code:input.code??'mock-code'} as const;
    const exchange=oauthProvider.exchange(callback,state.scopes);
    const connection=await this.persistConnection(tenantId,auth.userId,provider,exchange.grantedScopes,exchange.providerSubjectId,exchange.expiresAt);
    this.vault.rotate(connection.id,{accessToken:`mock-access-${connection.id}`,refreshToken:exchange.hasRefreshCredential?`mock-refresh-${connection.id}`:undefined,expiresAt:exchange.expiresAt,scopes:exchange.grantedScopes});
    await this.persistFixtureAccounts(tenantId,connection.id,provider,exchange.expiresAt);
    await this.audit(tenantId,auth.userId,provider,'oauth_callback','success',{connectionId:connection.id,accountDiscovery:true,pkce:Boolean(state.codeVerifier)});
    return{connectionId:connection.id,provider,accounts:(await this.listConnections(token,tenantId)).find((item)=>item.id===connection.id)?.accounts??[]};
  }

  async connectMock(token:string,tenantId:string,provider:string){
    const start=await this.startOAuth(token,tenantId,provider);
    return this.completeOAuth(token,tenantId,provider,{state:start.state,code:'mock-code'});
  }

  async selectAccount(token:string,tenantId:string,connectionId:string,accountId:string){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const account=this.first(await this.db.userRest<AccountRow[]>(token,`/rest/v1/social_accounts?select=*&tenant_id=eq.${q(tenantId)}&connection_id=eq.${q(connectionId)}&id=eq.${q(accountId)}&limit=1`),'provider_account_not_found');
    await this.db.serviceRest(`/rest/v1/social_accounts?tenant_id=eq.${q(tenantId)}&connection_id=eq.${q(connectionId)}&platform=eq.${q(account.platform)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({is_selected:false,updated_at:now()})});
    const selected=this.first(await this.db.serviceRest<AccountRow[]>(`/rest/v1/social_accounts?tenant_id=eq.${q(tenantId)}&id=eq.${q(accountId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({is_selected:true,updated_at:now()})}));
    await this.audit(tenantId,auth.userId,String(account.platform),'account_select','success',{connectionId,accountId,platform:account.platform});
    return this.mapAccount(selected);
  }

  async reconnect(token:string,tenantId:string,connectionId:string){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin']);
    const connection=this.first(await this.db.userRest<ConnectionRow[]>(token,`/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(connectionId)}&limit=1`),'provider_connection_not_found');
    const provider=String(connection.metadata.auth_provider??connection.platform);
    const scopes=this.scopesFor(provider);const expiresAt=new Date(Date.now()+60*24*60*60_000).toISOString();
    const updated=this.first(await this.db.serviceRest<ConnectionRow[]>(`/rest/v1/social_connections?tenant_id=eq.${q(tenantId)}&id=eq.${q(connectionId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({connection_status:'connected',granted_scopes:scopes,token_expires_at:expiresAt,last_checked_at:now(),last_error_code:null,last_error_message:null,recommended_action:null,reconnect_count:(connection.reconnect_count??0)+1,updated_at:now()})}));
    this.vault.rotate(connectionId,{accessToken:`mock-access-${connectionId}-r${updated.reconnect_count}`,refreshToken:`mock-refresh-${connectionId}`,expiresAt,scopes});
    await this.persistFixtureAccounts(tenantId,connectionId,provider,expiresAt);
    await this.audit(tenantId,auth.userId,provider,'reconnect','success',{connectionId,reconnectCount:updated.reconnect_count});
    return{connectionId,status:'CONNECTED',reconnectCount:updated.reconnect_count};
  }

  async revoke(token:string,tenantId:string,connectionId:string){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin']);
    const connection=this.first(await this.db.userRest<ConnectionRow[]>(token,`/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(connectionId)}&limit=1`),'provider_connection_not_found');
    this.vault.delete(connectionId);
    await this.db.serviceRest(`/rest/v1/social_connections?tenant_id=eq.${q(tenantId)}&id=eq.${q(connectionId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({connection_status:'disconnected',revoked_at:now(),disconnected_at:now(),last_checked_at:now(),recommended_action:'Ricollega il provider per ripristinare le funzioni.',updated_at:now()})});
    await this.db.serviceRest(`/rest/v1/social_accounts?tenant_id=eq.${q(tenantId)}&connection_id=eq.${q(connectionId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({health_status:'disconnected',updated_at:now()})});
    await this.audit(tenantId,auth.userId,String(connection.metadata.auth_provider??connection.platform),'revoke','success',{connectionId,preservedHistory:true});
    return{connectionId,status:'DISCONNECTED',historyPreserved:true};
  }

  async connectionHealth(token:string,tenantId:string,connectionId:string){
    await this.db.requireTenantRole(token,tenantId);
    const connection=this.first(await this.db.userRest<ConnectionRow[]>(token,`/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(connectionId)}&limit=1`),'provider_connection_not_found');
    const accounts=await this.db.userRest<AccountRow[]>(token,`/rest/v1/social_accounts?select=*&tenant_id=eq.${q(tenantId)}&connection_id=eq.${q(connectionId)}`);
    return{connectionId,provider:String(connection.metadata.auth_provider??connection.platform),status:this.connectionHealth(connection,accounts),lastCheckedAt:connection.last_checked_at,expiresAt:connection.token_expires_at,lastPublishAt:connection.last_publish_at,lastError:connection.last_error_message,recommendedAction:connection.recommended_action,accounts:accounts.map((item)=>this.mapAccount(item))};
  }

  async simulate(token:string,tenantId:string,connectionId:string,scenario:FixtureScenario){
    await this.db.requireTenantRole(token,tenantId,['owner','admin']);
    const connection=this.first(await this.db.userRest<ConnectionRow[]>(token,`/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(connectionId)}&limit=1`),'provider_connection_not_found');
    const status=scenario==='expired'?'reauth_required':scenario==='permission_missing'?'permission_missing':scenario==='rate_limit'?'rate_limited':scenario==='provider_error'||scenario==='rejected'?'provider_error':'connected';
    await this.db.serviceRest(`/rest/v1/social_connections?tenant_id=eq.${q(tenantId)}&id=eq.${q(connectionId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({connection_status:status,last_checked_at:now(),token_expires_at:scenario==='expired'?new Date(Date.now()-1000).toISOString():connection.token_expires_at,last_error_code:scenario==='success'?null:`FIXTURE_${scenario.toUpperCase()}`,last_error_message:scenario==='success'?null:`Fixture ${scenario}`,recommended_action:scenario==='expired'?'Ricollega il provider.':scenario==='permission_missing'?'Aggiorna le autorizzazioni.':null,updated_at:now()})});
    for(const account of await this.db.serviceRest<AccountRow[]>(`/rest/v1/social_accounts?select=*&tenant_id=eq.${q(tenantId)}&connection_id=eq.${q(connectionId)}`))this.fixtureFor(providerForAccount(account.platform),connectionId).setScenario(scenario);
    return{connectionId,scenario};
  }

  async validate(token:string,tenantId:string,accountId:string,payload:NormalizedPublishPayload){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const accountRow=this.first(await this.db.userRest<AccountRow[]>(token,`/rest/v1/social_accounts?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(accountId)}&limit=1`),'provider_account_not_found');
    await this.assertPlatformEntitlement(token,tenantId,accountRow.platform);
    const result=await this.fixtureFor(accountRow.platform,accountRow.connection_id).validateContent(this.mapAccount(accountRow),payload);
    await this.audit(tenantId,auth.userId,String(accountRow.platform),'validate_content',result.valid?'success':'blocked',{accountId,issueCodes:result.issues.map((item)=>item.code)});
    return result;
  }

  async dryRun(token:string,tenantId:string,accountId:string,payload:NormalizedPublishPayload){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const accountRow=this.first(await this.db.userRest<AccountRow[]>(token,`/rest/v1/social_accounts?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(accountId)}&limit=1`),'provider_account_not_found');
    await this.assertPlatformEntitlement(token,tenantId,accountRow.platform);
    const result=await this.fixtureFor(accountRow.platform,accountRow.connection_id).dryRun(this.mapAccount(accountRow),payload);
    await this.audit(tenantId,auth.userId,String(accountRow.platform),'publish_dry_run','dry_run',{accountId,wouldPublish:result.wouldPublish,format:payload.format,mediaCount:payload.media.length});
    return result;
  }

  async mockPublish(token:string,tenantId:string,accountId:string,payload:NormalizedPublishPayload){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const accountRow=this.first(await this.db.userRest<AccountRow[]>(token,`/rest/v1/social_accounts?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(accountId)}&limit=1`),'provider_account_not_found');
    await this.assertPlatformEntitlement(token,tenantId,accountRow.platform);
    try{
      const result=await this.fixtureFor(accountRow.platform,accountRow.connection_id).publish(this.mapAccount(accountRow),payload);
      await this.db.serviceRest(`/rest/v1/social_accounts?tenant_id=eq.${q(tenantId)}&id=eq.${q(accountId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({last_publish_at:result.publishedAt,health_status:'connected',last_error_code:null,last_error_message:null,updated_at:now()})});
      await this.db.serviceRest(`/rest/v1/social_connections?tenant_id=eq.${q(tenantId)}&id=eq.${q(accountRow.connection_id)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({last_publish_at:result.publishedAt,connection_status:'connected',last_error_code:null,last_error_message:null,updated_at:now()})});
      await this.audit(tenantId,auth.userId,String(accountRow.platform),'publish_mock','success',{accountId,externalPostId:result.externalPostId,idempotentReplay:result.idempotentReplay});
      return result;
    }catch(error){
      const code=error instanceof Error?error.message:'PROVIDER_ERROR';
      await this.audit(tenantId,auth.userId,String(accountRow.platform),'publish_mock','failure',{accountId,errorCode:code});
      throw error;
    }
  }

  async analytics(token:string,tenantId:string,accountId:string,externalPostId:string){
    await this.db.requireTenantRole(token,tenantId);
    const accountRow=this.first(await this.db.userRest<AccountRow[]>(token,`/rest/v1/social_accounts?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(accountId)}&limit=1`),'provider_account_not_found');
    return this.fixtureFor(accountRow.platform,accountRow.connection_id).analytics({connectionId:accountRow.connection_id,accountId,externalPostId});
  }

  async auditLog(token:string,tenantId:string){await this.db.requireTenantRole(token,tenantId,['owner','admin']);return this.db.userRest(token,`/rest/v1/provider_audit_events?select=*&tenant_id=eq.${q(tenantId)}&order=created_at.desc&limit=100`);}

  readiness(){
    const base={ARCHITECTURE:true,CONTRACTS:true,FIXTURES:true,TESTS:true,UI:true,SECURITY:true,DOCUMENTATION:true,LIVE_CREDENTIALS:false,REMOTE_CALLBACKS:false};
    return[
      readinessRow('OpenAI',base),readinessRow('Meta/Facebook',base),readinessRow('Instagram',base),readinessRow('LinkedIn',base),readinessRow('Google Business Profile',base),readinessRow('Telegram',base),readinessRow('Stripe',base),
    ];
  }

  private async persistConnection(tenantId:string,userId:string,provider:string,scopes:string[],subject:string,expiresAt?:string){
    const platform=platformForConnection(provider);const existing=await this.db.serviceRest<ConnectionRow[]>(`/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&platform=eq.${q(platform)}&provider_subject_id=eq.${q(subject)}&limit=1`);
    if(existing[0])return this.first(await this.db.serviceRest<ConnectionRow[]>(`/rest/v1/social_connections?tenant_id=eq.${q(tenantId)}&id=eq.${q(existing[0].id)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({connection_status:'connected',granted_scopes:scopes,token_expires_at:expiresAt??null,last_checked_at:now(),connected_at:existing[0].connected_at??now(),metadata:{...existing[0].metadata,auth_provider:provider,mock:true},updated_at:now()})}));
    return this.first(await this.db.serviceRest<ConnectionRow[]>('/rest/v1/social_connections',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,platform,connection_status:'connected',approval_mode:'manual',granted_scopes:scopes,token_expires_at:expiresAt??null,connected_at:now(),last_checked_at:now(),provider_subject_id:subject,provider_connection_key:`mock:${provider}`,metadata:{auth_provider:provider,mock:true,connected_by:userId}})}));
  }

  private async persistFixtureAccounts(tenantId:string,connectionId:string,provider:string,expiresAt?:string){
    const accounts=provider==='meta'?[...buildFixtureAccounts('facebook',connectionId),...buildFixtureAccounts('instagram',connectionId)]:buildFixtureAccounts(platformForConnection(provider),connectionId);
    const rows=[] as AccountRow[];
    for(const item of accounts){
      const body={tenant_id:tenantId,connection_id:connectionId,platform:item.provider==='instagram'?'instagram':platformForConnection(provider)==='facebook'&&item.provider==='facebook'?'facebook':platformForConnection(provider),external_account_id:item.externalAccountId,account_type:item.accountType,display_name:item.displayName,username:item.username??null,location_id:item.locationId??null,is_selected:item.selected,metadata:{...item.metadata,mock:true},health_status:'connected',granted_scopes:item.grantedScopes,capabilities:item.capabilities,missing_permissions:item.missingPermissions,token_expires_at:expiresAt??null,last_checked_at:now(),updated_at:now()};
      const inserted=await this.db.serviceRest<AccountRow[]>(`/rest/v1/social_accounts?on_conflict=connection_id,external_account_id`,{method:'POST',headers:{...jsonHeaders,prefer:'resolution=merge-duplicates,return=representation'},body:jsonBody(body)});rows.push(...inserted);
    }
    return rows;
  }

  private fixtureFor(platform:ProviderSocialPlatform,connectionId:string){const key=`${platform}:${connectionId}`;let fixture=this.fixtureProviders.get(key);if(!fixture){fixture=createFixtureProvider(platform,connectionId);this.fixtureProviders.set(key,fixture);}return fixture;}

  private mapAccount(row:AccountRow):ProviderAccount{return{id:row.id,connectionId:row.connection_id,provider:row.platform,externalAccountId:row.external_account_id,accountType:row.account_type??'unknown',displayName:row.display_name??row.external_account_id,...(row.username?{username:row.username}:{}),...(row.location_id?{locationId:row.location_id}:{}),selected:row.is_selected,capabilities:row.capabilities as ProviderAccount['capabilities'],grantedScopes:row.granted_scopes??[],missingPermissions:row.missing_permissions??[],health:mapHealth(row.health_status),...(row.token_expires_at?{tokenExpiresAt:row.token_expires_at}:{}),...(row.last_checked_at?{lastCheckedAt:row.last_checked_at}:{}),...(row.last_publish_at?{lastPublishAt:row.last_publish_at}:{}),...(row.last_error_code?{lastErrorCode:row.last_error_code}:{}),...(row.last_error_message?{lastErrorMessage:row.last_error_message}:{}),metadata:row.metadata??{}};}

  private connectionHealth(connection:ConnectionRow,accounts:AccountRow[]){
    const missing=[...new Set(accounts.flatMap((item)=>item.missing_permissions??[]))];
    return this.lifecycle.status({nowMs:Date.now(),...(connection.token_expires_at?{expiresAtMs:new Date(connection.token_expires_at).getTime()}:{}),missingPermissions:missing,rateLimited:connection.connection_status==='rate_limited',providerError:connection.connection_status==='provider_error',connected:!['disconnected','disabled'].includes(connection.connection_status)});
  }

  private scopesFor(provider:string){
    const platforms=provider==='meta'?['facebook','instagram'] as const:[platformForConnection(provider)];
    return[...new Set(platforms.flatMap((platform)=>providerFixtureConfigs[platform].permissions.flatMap((item)=>item.requiredScopes)))];
  }
  private providerKey(provider:string):ProviderKey{if(provider==='meta')return'meta';if(['facebook','instagram','linkedin','google_business_profile'].includes(provider))return provider as ProviderKey;throw new Error('provider_not_supported');}
  private async assertPlatformEntitlement(token:string,tenantId:string,platform:string){const e=await this.db.rpc<Entitlements>(token,'get_tenant_entitlements',{p_tenant_id:tenantId});this.entitlementGuard.assertPlatform({platforms:e.platforms??[],postsPerWeek:e.posts_per_week??0,monthlyPostLimit:e.monthly_post_limit??null,autoPublishAllowed:e.auto_publish_allowed??false,imageGenerationAllowed:e.image_generation_allowed??false,analyticsLevel:e.analytics_level??'basic',premiumChatAllowed:e.premium_chat_allowed??false},platform);}
  private async audit(tenantId:string,userId:string,provider:string,action:string,outcome:'success'|'failure'|'blocked'|'dry_run',metadata:Record<string,unknown>){const safe=JSON.parse(JSON.stringify(metadata,(key,value)=>/token|secret|credential/i.test(key)?'[REDACTED]':value)) as Record<string,unknown>;await this.db.serviceRest('/rest/v1/provider_audit_events',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,actor_user_id:userId,provider,action,outcome,correlation_id:randomUUID(),metadata:safe})});}
  private first<T>(rows:T[],message='row_not_found'){const row=rows[0];if(!row)throw new Error(message);return row;}
}
