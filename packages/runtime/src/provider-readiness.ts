import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  BillingProvider, ConnectionHealthStatus, NormalizedPublishPayload, OAuthAuthorization, OAuthCallback, OAuthExchangeResult, OAuthStart,
  PermissionRequirement, ProviderAccount, ProviderCapability, ProviderKey, ProviderPublishResult, ProviderSocialPlatform,
  ProviderValidationIssue, ProviderValidationResult, PublishDryRun, SocialProviderV2, WebhookSignatureVerifier,
} from '@socialpilot/contracts';

const iso=(ms=Date.now())=>new Date(ms).toISOString();
const b64url=(value:Buffer)=>value.toString('base64url');
const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const safeEqual=(left:string,right:string)=>{const a=Buffer.from(left);const b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b)};

export type AppEnvironment='LOCAL'|'STAGING'|'PRODUCTION';
export const providerFeatureFlagNames=['OPENAI_LIVE','META_LIVE','LINKEDIN_LIVE','GBP_LIVE','TELEGRAM_LIVE','STRIPE_LIVE','AUTO_PUBLISH','REAL_ANALYTICS','IMAGE_GENERATION_LIVE'] as const;
export type ProviderFeatureFlagName=typeof providerFeatureFlagNames[number];
export interface EnvironmentConfig { mode:AppEnvironment; flags:Record<ProviderFeatureFlagName,boolean>; appBaseUrl:string; publishingMode:'MOCK'|'DRY_RUN'|'LIVE'; }
export const loadEnvironmentConfig=(env:Record<string,string|undefined>):EnvironmentConfig=>{
  const raw=env.APP_ENV??'LOCAL';
  if(!['LOCAL','STAGING','PRODUCTION'].includes(raw))throw new Error(`APP_ENV_INVALID:${raw}`);
  const mode=raw as AppEnvironment;
  const flags=Object.fromEntries(providerFeatureFlagNames.map((key)=>[key,env[key]==='true'])) as Record<ProviderFeatureFlagName,boolean>;
  const appBaseUrl=(env.APP_BASE_URL??'http://127.0.0.1:5173').replace(/\/$/,'');
  const publishingMode:EnvironmentConfig['publishingMode']=mode==='LOCAL'?'MOCK':flags.AUTO_PUBLISH?'LIVE':'DRY_RUN';
  return{mode,flags,appBaseUrl,publishingMode};
};

export interface ProviderFixtureConfig {
  provider:ProviderKey; platform:ProviderSocialPlatform; apiLabel:string; sourceRef:string; accountTypes:string[];
  capabilities:ProviderCapability[]; formats:Record<string,{required:ProviderCapability[];minMedia?:number;maxMedia?:number;allowedMimes?:string[];allowedCtas?:string[]}>;
  permissions:PermissionRequirement[];
}

const commonImageMimes=['image/jpeg','image/png','image/webp'];
export const providerFixtureConfigs:Record<ProviderSocialPlatform,ProviderFixtureConfig>={
  facebook:{provider:'facebook',platform:'facebook',apiLabel:'Meta Graph API fixture',sourceRef:'https://developers.facebook.com/docs/pages-api',accountTypes:['page'],capabilities:['TEXT_POST','IMAGE_POST','MULTI_IMAGE','ANALYTICS','DELETE','WEBHOOKS'],formats:{text:{required:['TEXT_POST']},image:{required:['IMAGE_POST'],minMedia:1,maxMedia:1,allowedMimes:commonImageMimes},multi_image:{required:['MULTI_IMAGE'],minMedia:2,maxMedia:10,allowedMimes:commonImageMimes}},permissions:[{provider:'facebook',feature:'read_account',requiredScopes:['pages_show_list'],optionalScopes:[],accountTypes:['page'],message:'Autorizzazione necessaria per leggere le Pagine gestite.'},{provider:'facebook',feature:'publish_post',requiredScopes:['pages_manage_posts'],optionalScopes:[],accountTypes:['page'],message:'Autorizzazione necessaria per pubblicare sulla Pagina.'},{provider:'facebook',feature:'analytics',requiredScopes:['read_insights','pages_read_engagement'],optionalScopes:[],accountTypes:['page'],message:'Autorizzazione necessaria per leggere le statistiche della Pagina.'}]},
  instagram:{provider:'instagram',platform:'instagram',apiLabel:'Instagram Graph API fixture',sourceRef:'https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00',accountTypes:['business','creator'],capabilities:['IMAGE_POST','CAROUSEL','REEL','ANALYTICS','WEBHOOKS'],formats:{image:{required:['IMAGE_POST'],minMedia:1,maxMedia:1,allowedMimes:commonImageMimes},carousel:{required:['CAROUSEL'],minMedia:2,maxMedia:10,allowedMimes:commonImageMimes},reel:{required:['REEL'],minMedia:1,maxMedia:1,allowedMimes:['video/mp4']}},permissions:[{provider:'instagram',feature:'read_account',requiredScopes:['instagram_basic'],optionalScopes:['pages_show_list','pages_read_engagement'],accountTypes:['business','creator'],message:'Autorizzazione necessaria per leggere il profilo Instagram professionale.'},{provider:'instagram',feature:'publish_post',requiredScopes:['instagram_content_publish'],optionalScopes:[],accountTypes:['business','creator'],message:'Autorizzazione necessaria per pubblicare su Instagram.'},{provider:'instagram',feature:'analytics',requiredScopes:['instagram_basic'],optionalScopes:[],accountTypes:['business','creator'],message:'Autorizzazione necessaria per leggere gli insight disponibili.'}]},
  linkedin:{provider:'linkedin',platform:'linkedin',apiLabel:'LinkedIn Posts API fixture (versioned)',sourceRef:'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api',accountTypes:['person','organization'],capabilities:['TEXT_POST','IMAGE_POST','MULTI_IMAGE','VIDEO','DOCUMENT_POST','ANALYTICS','DELETE'],formats:{text:{required:['TEXT_POST']},image:{required:['IMAGE_POST'],minMedia:1,maxMedia:1,allowedMimes:commonImageMimes},multi_image:{required:['MULTI_IMAGE'],minMedia:2,maxMedia:20,allowedMimes:commonImageMimes},document:{required:['DOCUMENT_POST'],minMedia:1,maxMedia:1,allowedMimes:['application/pdf']}},permissions:[{provider:'linkedin',feature:'publish_personal',requiredScopes:['w_member_social'],optionalScopes:[],accountTypes:['person'],message:'Autorizzazione necessaria per pubblicare sul profilo LinkedIn.'},{provider:'linkedin',feature:'publish_post',requiredScopes:['w_organization_social'],optionalScopes:['r_organization_social'],accountTypes:['organization'],message:'Autorizzazione e ruolo Pagina necessari per pubblicare per l’organizzazione.'},{provider:'linkedin',feature:'analytics',requiredScopes:['r_organization_social'],optionalScopes:['r_member_profileAnalytics'],accountTypes:['organization','person'],message:'Autorizzazione necessaria per le analytics LinkedIn disponibili.'}]},
  google_business_profile:{provider:'google_business_profile',platform:'google_business_profile',apiLabel:'Google Business Profile Local Posts v4 fixture',sourceRef:'https://developers.google.com/my-business/content/posts-data',accountTypes:['location'],capabilities:['LOCAL_POST','IMAGE_POST','CTA','ANALYTICS','DELETE'],formats:{local_post:{required:['LOCAL_POST'],maxMedia:1,allowedMimes:commonImageMimes,allowedCtas:['BOOK','ORDER','SHOP','LEARN_MORE','SIGN_UP','CALL']},event:{required:['LOCAL_POST'],maxMedia:1,allowedMimes:commonImageMimes},offer:{required:['LOCAL_POST'],maxMedia:1,allowedMimes:commonImageMimes}},permissions:[{provider:'google_business_profile',feature:'read_account',requiredScopes:['https://www.googleapis.com/auth/business.manage'],optionalScopes:[],accountTypes:['location'],message:'Autorizzazione Business Profile necessaria per accedere alle location.'},{provider:'google_business_profile',feature:'publish_post',requiredScopes:['https://www.googleapis.com/auth/business.manage'],optionalScopes:[],accountTypes:['location'],message:'Autorizzazione Business Profile necessaria per creare Local Posts.'},{provider:'google_business_profile',feature:'analytics',requiredScopes:['https://www.googleapis.com/auth/business.manage'],optionalScopes:[],accountTypes:['location'],message:'Autorizzazione Business Profile necessaria per leggere le metriche disponibili.'}]},
};

export class PermissionMatrix {
  constructor(private readonly configs:Record<ProviderSocialPlatform,ProviderFixtureConfig>=providerFixtureConfigs){}
  requirements(platform:ProviderSocialPlatform,feature:string,accountType?:string):PermissionRequirement[]{return this.configs[platform].permissions.filter((item)=>item.feature===feature&&(!accountType||item.accountTypes.length===0||item.accountTypes.includes(accountType)));}
  missing(platform:ProviderSocialPlatform,feature:string,account:ProviderAccount):string[]{return this.requirements(platform,feature,account.accountType).flatMap((item)=>item.requiredScopes.filter((scope)=>!account.grantedScopes.includes(scope)));}
}

export class PlatformContentValidator {
  validate(config:ProviderFixtureConfig,account:ProviderAccount,payload:NormalizedPublishPayload):ProviderValidationResult{
    const issues:ProviderValidationIssue[]=[];
    const format=config.formats[payload.format];
    if(!config.accountTypes.includes(account.accountType))issues.push({code:'ACCOUNT_TYPE_UNSUPPORTED',severity:'blocker',field:'account',message:`Tipo account ${account.accountType} non supportato.`});
    if(!format)issues.push({code:'FORMAT_UNSUPPORTED',severity:'blocker',field:'format',message:`Formato ${payload.format} non supportato dal provider.`});
    const required=format?.required??[];
    for(const capability of required)if(!account.capabilities.includes(capability))issues.push({code:'CAPABILITY_MISSING',severity:'blocker',field:'format',message:`Capability ${capability} non disponibile per questo account.`});
    if(format?.minMedia!==undefined&&payload.media.length<format.minMedia)issues.push({code:'MEDIA_TOO_FEW',severity:'blocker',field:'media',message:`Servono almeno ${format.minMedia} media.`});
    if(format?.maxMedia!==undefined&&payload.media.length>format.maxMedia)issues.push({code:'MEDIA_TOO_MANY',severity:'blocker',field:'media',message:`Il fixture provider accetta al massimo ${format.maxMedia} media per questo formato.`});
    if(format?.allowedMimes)for(const media of payload.media)if(!format.allowedMimes.includes(media.mimeType))issues.push({code:'MIME_UNSUPPORTED',severity:'blocker',field:'media',message:`MIME ${media.mimeType} non supportato per ${payload.format}.`});
    if(payload.cta&&format?.allowedCtas&&!format.allowedCtas.includes(payload.cta))issues.push({code:'CTA_UNSUPPORTED',severity:'blocker',field:'cta',message:`CTA ${payload.cta} non supportata.`});
    if(config.platform==='google_business_profile'&&payload.format==='product')issues.push({code:'GBP_PRODUCT_POST_UNSUPPORTED',severity:'blocker',field:'format',message:'I Product Posts non sono creati tramite Business Profile API.'});
    if(config.platform==='linkedin'&&payload.format==='carousel')issues.push({code:'LINKEDIN_ORGANIC_CAROUSEL_UNSUPPORTED',severity:'blocker',field:'format',message:'Il carousel organico LinkedIn non è supportato; usa multi_image quando appropriato.'});
    if(account.missingPermissions.length)issues.push({code:'PERMISSION_MISSING',severity:'blocker',field:'permissions',message:'Autorizzazione necessaria per pubblicare.',remediation:'Ricollega e aggiorna le autorizzazioni.'});
    return{valid:!issues.some((item)=>item.severity==='blocker'),provider:config.provider,accountId:account.id,requiredCapabilities:required,supportedCapabilities:[...account.capabilities],issues};
  }
}

export type FixtureScenario='success'|'timeout'|'rate_limit'|'expired'|'permission_missing'|'rejected'|'provider_error';
export class FixtureSocialProvider implements SocialProviderV2 {
  readonly provider:ProviderKey; readonly platform:ProviderSocialPlatform;
  private scenario:FixtureScenario='success'; private readonly posts=new Map<string,ProviderPublishResult>();
  constructor(readonly config:ProviderFixtureConfig,private readonly accounts:ProviderAccount[],private readonly matrix=new PermissionMatrix(),private readonly validator=new PlatformContentValidator()){this.provider=config.provider;this.platform=config.platform;}
  setScenario(value:FixtureScenario){this.scenario=value;}
  async capabilities(account:ProviderAccount){return[...account.capabilities];}
  permissionRequirements(feature:string,accountType?:string){return this.matrix.requirements(this.platform,feature,accountType);}
  async listAccounts(connectionId:string){return this.accounts.filter((item)=>item.connectionId===connectionId).map((item)=>({...item,capabilities:[...item.capabilities],grantedScopes:[...item.grantedScopes],missingPermissions:[...item.missingPermissions],metadata:{...item.metadata}}));}
  async validateConnection(connectionId:string){
    const account=this.accounts.find((item)=>item.connectionId===connectionId);
    if(!account)return{status:'DISCONNECTED' as const,missingPermissions:[],recommendedAction:'Connetti il provider.'};
    if(this.scenario==='expired')return{status:'REAUTH_REQUIRED' as const,missingPermissions:[],recommendedAction:'Ricollega il provider.'};
    if(this.scenario==='permission_missing'||account.missingPermissions.length)return{status:'PERMISSION_MISSING' as const,missingPermissions:account.missingPermissions.length?[...account.missingPermissions]:['fixture.missing'],recommendedAction:'Aggiorna le autorizzazioni.'};
    if(this.scenario==='rate_limit')return{status:'RATE_LIMITED' as const,missingPermissions:[],recommendedAction:'Attendi il reset del limite provider.'};
    if(this.scenario==='provider_error')return{status:'PROVIDER_ERROR' as const,missingPermissions:[],recommendedAction:'Riprova più tardi.'};
    return{status:'CONNECTED' as const,missingPermissions:[]};
  }
  async validateContent(account:ProviderAccount,payload:NormalizedPublishPayload){return this.validator.validate(this.config,account,payload);}
  async dryRun(account:ProviderAccount,payload:NormalizedPublishPayload):Promise<PublishDryRun>{const validation=await this.validateContent(account,payload);return{mode:'DRY_RUN',provider:this.provider,account,payload,validation,wouldPublish:validation.valid,note:validation.valid?`Questo post sarebbe inviato a ${account.displayName}.`:'Il post non verrebbe inviato finché gli errori non sono risolti.'};}
  async publish(account:ProviderAccount,payload:NormalizedPublishPayload):Promise<ProviderPublishResult>{
    const validation=await this.validateContent(account,payload);if(!validation.valid)throw new Error('PROVIDER_VALIDATION_FAILED');
    const existing=this.posts.get(payload.idempotencyKey);if(existing)return{...existing,idempotentReplay:true};
    if(this.scenario==='timeout')throw new Error('PROVIDER_TIMEOUT');if(this.scenario==='rate_limit')throw new Error('PROVIDER_RATE_LIMIT');if(this.scenario==='expired')throw new Error('PROVIDER_AUTH_EXPIRED');if(this.scenario==='permission_missing')throw new Error('PROVIDER_PERMISSION_MISSING');if(this.scenario==='rejected')throw new Error('PROVIDER_REJECTED');if(this.scenario==='provider_error')throw new Error('PROVIDER_UNAVAILABLE');
    const result:ProviderPublishResult={externalPostId:`${this.platform}-mock-${sha256(payload.idempotencyKey).slice(0,16)}`,externalUrl:`https://fixture.invalid/${this.platform}/${account.externalAccountId}`,providerRequestId:`req-${sha256(payload.correlationId).slice(0,12)}`,publishedAt:iso(),idempotentReplay:false};
    this.posts.set(payload.idempotencyKey,result);return result;
  }
  async reconcile(input:{connectionId:string;accountId:string;idempotencyKey:string;externalPostId?:string}){const existing=this.posts.get(input.idempotencyKey);return existing?{...existing,idempotentReplay:true}:null;}
  async analytics(input:{connectionId:string;accountId:string;externalPostId:string}){const seed=parseInt(sha256(input.externalPostId).slice(0,6),16);return{capturedAt:iso(),metrics:{impressions:100+(seed%900),engagements:10+(seed%90),clicks:seed%50},availableMetricKeys:['impressions','engagements','clicks']};}
  async disconnect(_connectionId:string){this.scenario='expired';}
}

const account=(input:Omit<ProviderAccount,'health'|'selected'|'metadata'>&{selected?:boolean;metadata?:Record<string,unknown>}):ProviderAccount=>({...input,selected:input.selected??false,health:'CONNECTED',metadata:input.metadata??{}});
export const buildFixtureAccounts=(provider:ProviderSocialPlatform,connectionId:string):ProviderAccount[]=>{
  if(provider==='facebook')return[
    account({id:`${connectionId}-fb-1`,connectionId,provider:'facebook',externalAccountId:'page-1001',accountType:'page',displayName:'Forno Vesuvio Milano',capabilities:[...providerFixtureConfigs.facebook.capabilities],grantedScopes:['pages_show_list','pages_manage_posts','pages_read_engagement','read_insights'],missingPermissions:[],selected:true}),
    account({id:`${connectionId}-fb-2`,connectionId,provider:'facebook',externalAccountId:'page-1002',accountType:'page',displayName:'Vesuvio Catering',capabilities:[...providerFixtureConfigs.facebook.capabilities],grantedScopes:['pages_show_list','pages_manage_posts'],missingPermissions:['read_insights']})];
  if(provider==='instagram')return[account({id:`${connectionId}-ig-1`,connectionId,provider:'instagram',externalAccountId:'ig-2001',accountType:'business',displayName:'@fornovesuviomilano',username:'fornovesuviomilano',capabilities:[...providerFixtureConfigs.instagram.capabilities],grantedScopes:['instagram_basic','instagram_content_publish','pages_show_list','pages_read_engagement'],missingPermissions:[],selected:true})];
  if(provider==='linkedin')return[
    account({id:`${connectionId}-li-person`,connectionId,provider:'linkedin',externalAccountId:'urn:li:person:mock-1',accountType:'person',displayName:'Alessandro Demo',capabilities:['TEXT_POST','IMAGE_POST','MULTI_IMAGE','VIDEO','DOCUMENT_POST'],grantedScopes:['w_member_social'],missingPermissions:[]}),
    account({id:`${connectionId}-li-org`,connectionId,provider:'linkedin',externalAccountId:'urn:li:organization:5515715',accountType:'organization',displayName:'SocialPilot Demo Company',capabilities:[...providerFixtureConfigs.linkedin.capabilities],grantedScopes:['w_organization_social','r_organization_social'],missingPermissions:[],selected:true,metadata:{organizationAuthorization:'AUTHORIZED'}})];
  return[
    account({id:`${connectionId}-gbp-1`,connectionId,provider:'google_business_profile',externalAccountId:'accounts/100/locations/200',accountType:'location',displayName:'Forno Vesuvio · Milano Centro',locationId:'locations/200',capabilities:[...providerFixtureConfigs.google_business_profile.capabilities],grantedScopes:['https://www.googleapis.com/auth/business.manage'],missingPermissions:[],selected:true}),
    account({id:`${connectionId}-gbp-2`,connectionId,provider:'google_business_profile',externalAccountId:'accounts/100/locations/201',accountType:'location',displayName:'Forno Vesuvio · Monza',locationId:'locations/201',capabilities:[...providerFixtureConfigs.google_business_profile.capabilities],grantedScopes:['https://www.googleapis.com/auth/business.manage'],missingPermissions:[]})];
};
export const createFixtureProvider=(platform:ProviderSocialPlatform,connectionId=`fixture-${platform}`)=>new FixtureSocialProvider(providerFixtureConfigs[platform],buildFixtureAccounts(platform,connectionId));

interface OAuthStateRecord {hash:string;tenantId:string;userId:string;provider:ProviderKey;redirectUri:string;scopes:string[];codeVerifier?:string;expiresAtMs:number;consumed:boolean;}
export class OAuthStateManager {
  private readonly states=new Map<string,OAuthStateRecord>();
  constructor(private readonly allowedRedirectUris:string[],private readonly ttlMs=10*60_000){}
  start(input:OAuthStart,nowMs=Date.now()):OAuthAuthorization{
    if(!this.allowedRedirectUris.includes(input.redirectUri))throw new Error('OAUTH_REDIRECT_NOT_ALLOWED');
    const state=b64url(randomBytes(32));const hash=sha256(state);let codeVerifier:string|undefined;let codeChallenge:string|undefined;
    if(input.usePkce){codeVerifier=b64url(randomBytes(48));codeChallenge=b64url(createHash('sha256').update(codeVerifier).digest());}
    const record:OAuthStateRecord={hash,tenantId:input.tenantId,userId:input.userId,provider:input.provider,redirectUri:input.redirectUri,scopes:[...input.scopes],expiresAtMs:nowMs+this.ttlMs,consumed:false};if(codeVerifier)record.codeVerifier=codeVerifier;this.states.set(hash,record);
    const query=new URLSearchParams({response_type:'code',state,redirect_uri:input.redirectUri,scope:input.scopes.join(' ')});if(codeChallenge){query.set('code_challenge',codeChallenge);query.set('code_challenge_method','S256');}
    const result:OAuthAuthorization={authorizationUrl:`https://fixture-oauth.invalid/${input.provider}/authorize?${query.toString()}`,state,expiresAt:iso(nowMs+this.ttlMs)};if(codeChallenge){result.codeChallenge=codeChallenge;result.codeChallengeMethod='S256';}return result;
  }
  consume(input:Omit<OAuthCallback,'code'>,nowMs=Date.now()):{codeVerifier?:string;scopes:string[]}{
    const record=this.states.get(sha256(input.state));if(!record)throw new Error('OAUTH_STATE_INVALID');if(record.consumed)throw new Error('OAUTH_STATE_REPLAY');if(nowMs>record.expiresAtMs)throw new Error('OAUTH_STATE_EXPIRED');
    if(record.tenantId!==input.tenantId)throw new Error('OAUTH_STATE_WRONG_TENANT');if(record.userId!==input.userId)throw new Error('OAUTH_STATE_WRONG_USER');if(record.provider!==input.provider)throw new Error('OAUTH_STATE_WRONG_PROVIDER');if(record.redirectUri!==input.redirectUri)throw new Error('OAUTH_REDIRECT_MISMATCH');record.consumed=true;
    const result:{codeVerifier?:string;scopes:string[]}={scopes:[...record.scopes]};if(record.codeVerifier)result.codeVerifier=record.codeVerifier;return result;
  }
  pendingCount(){return[...this.states.values()].filter((item)=>!item.consumed).length;}
}

export class MockOAuthProvider {
  constructor(readonly provider:ProviderSocialPlatform){}
  exchange(callback:OAuthCallback,scopes:string[]):OAuthExchangeResult{
    const connectionId=`fixture-${this.provider}-${sha256(callback.userId).slice(0,8)}`;const accounts=buildFixtureAccounts(this.provider,connectionId);
    return{providerSubjectId:`subject-${sha256(`${callback.userId}:${this.provider}`).slice(0,12)}`,grantedScopes:[...scopes],expiresAt:iso(Date.now()+60*24*60*60_000),hasRefreshCredential:this.provider!=='linkedin',accounts};
  }
}

export interface CredentialSecret {accessToken:string;refreshToken?:string;expiresAt?:string;scopes:string[];}
interface VaultRecord {version:number;iv:Buffer;ciphertext:Buffer;tag:Buffer;deleted:boolean;}
export class EnvelopeCredentialVault {
  private readonly records=new Map<string,VaultRecord>();private readonly key:Buffer;
  constructor(key:Buffer=Buffer.alloc(32,7)){if(key.length!==32)throw new Error('CREDENTIAL_KEY_LENGTH');this.key=Buffer.from(key);}
  store(id:string,secret:CredentialSecret){this.records.set(id,this.encrypt(secret,1));return{credentialId:id,version:1};}
  rotate(id:string,secret:CredentialSecret){const current=this.records.get(id);const next=(current?.version??0)+1;this.records.set(id,this.encrypt(secret,next));return{credentialId:id,version:next};}
  get(id:string):CredentialSecret{const record=this.records.get(id);if(!record||record.deleted)throw new Error('CREDENTIAL_NOT_FOUND');const decipher=createDecipheriv('aes-256-gcm',this.key,record.iv);decipher.setAuthTag(record.tag);const clear=Buffer.concat([decipher.update(record.ciphertext),decipher.final()]).toString('utf8');return JSON.parse(clear) as CredentialSecret;}
  delete(id:string){const current=this.records.get(id);if(!current)return false;current.ciphertext=Buffer.alloc(1);current.deleted=true;return true;}
  private encrypt(secret:CredentialSecret,version:number):VaultRecord{const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',this.key,iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(secret),'utf8'),cipher.final()]);return{version,iv,ciphertext,tag:cipher.getAuthTag(),deleted:false};}
}

export class HmacWebhookVerifier implements WebhookSignatureVerifier {
  readonly provider:ProviderKey;
  constructor(provider:ProviderKey,private readonly secret:string,private readonly maxAgeMs=5*60_000){this.provider=provider;}
  sign(rawBody:string,timestampMs:number){return`sha256=${createHmac('sha256',this.secret).update(`${timestampMs}.${rawBody}`).digest('hex')}`;}
  verify(input:{rawBody:string;headers:Record<string,string|undefined>;nowMs:number}){const ts=Number(input.headers['x-provider-timestamp']??'');const signature=input.headers['x-provider-signature']??'';if(!Number.isFinite(ts))return{valid:false,reason:'timestamp_missing'};if(Math.abs(input.nowMs-ts)>this.maxAgeMs)return{valid:false,timestampMs:ts,reason:'timestamp_stale'};const expected=this.sign(input.rawBody,ts);return safeEqual(signature,expected)?{valid:true,timestampMs:ts}:{valid:false,timestampMs:ts,reason:'signature_invalid'};}
}

export interface ProcessedWebhook {status:'PROCESSED'|'IGNORED_DUPLICATE';eventKey:string;payloadHash:string;}
export class WebhookCore {
  private readonly seen=new Set<string>();
  process(input:{provider:ProviderKey;eventType:string;externalId?:string;rawBody:string;headers:Record<string,string|undefined>;nowMs:number;verifier:WebhookSignatureVerifier}):ProcessedWebhook{
    const verified=input.verifier.verify({rawBody:input.rawBody,headers:input.headers,nowMs:input.nowMs});if(!verified.valid)throw new Error(`WEBHOOK_SIGNATURE_INVALID:${verified.reason??'unknown'}`);
    let payload:unknown;try{payload=JSON.parse(input.rawBody);}catch{throw new Error('WEBHOOK_MALFORMED_PAYLOAD');}if(payload===null||typeof payload!=='object')throw new Error('WEBHOOK_MALFORMED_PAYLOAD');
    const payloadHash=sha256(input.rawBody);const eventKey=input.externalId?`${input.provider}:${input.externalId}`:`${input.provider}:${input.eventType}:${payloadHash}`;if(this.seen.has(eventKey))return{status:'IGNORED_DUPLICATE',eventKey,payloadHash};this.seen.add(eventKey);return{status:'PROCESSED',eventKey,payloadHash};
  }
}

export class TelegramApprovalCallbacks {
  private readonly consumed=new Set<string>();
  constructor(private readonly secret:string){}
  issue(input:{tenantId:string;chatId:string;postVariantId:string;action:'approve'|'reject'|'open';ttlMs?:number},nowMs=Date.now()){const nonce=b64url(randomBytes(12));const expiresAt=nowMs+(input.ttlMs??10*60_000);const data=JSON.stringify({tenantId:input.tenantId,chatId:input.chatId,postVariantId:input.postVariantId,action:input.action,nonce,expiresAt});const signature=createHmac('sha256',this.secret).update(data).digest('hex');return{data,signature};}
  verify(input:{data:string;signature:string;tenantId:string;chatId:string},nowMs=Date.now()){const expected=createHmac('sha256',this.secret).update(input.data).digest('hex');if(!safeEqual(expected,input.signature))throw new Error('TELEGRAM_CALLBACK_FORGED');const parsed=JSON.parse(input.data) as {tenantId:string;chatId:string;postVariantId:string;action:string;nonce:string;expiresAt:number};if(parsed.tenantId!==input.tenantId)throw new Error('TELEGRAM_TENANT_MISMATCH');if(parsed.chatId!==input.chatId)throw new Error('TELEGRAM_CHAT_UNAUTHORIZED');if(nowMs>parsed.expiresAt)throw new Error('TELEGRAM_CALLBACK_EXPIRED');if(this.consumed.has(parsed.nonce))throw new Error('TELEGRAM_CALLBACK_REPLAY');this.consumed.add(parsed.nonce);return parsed;}
}

export interface TenantEntitlements {platforms:string[];postsPerWeek:number;monthlyPostLimit:number|null;autoPublishAllowed:boolean;imageGenerationAllowed:boolean;analyticsLevel:string;premiumChatAllowed:boolean;}
export class PlanEntitlementGuard {
  assertPlatform(e:TenantEntitlements,platform:string){if(!e.platforms.includes(platform))throw new Error('FEATURE_NOT_ENTITLED:platform');}
  assertAutoPublish(e:TenantEntitlements){if(!e.autoPublishAllowed)throw new Error('FEATURE_NOT_ENTITLED:auto_publish');}
  assertImageGeneration(e:TenantEntitlements){if(!e.imageGenerationAllowed)throw new Error('FEATURE_NOT_ENTITLED:image_generation');}
  assertAdvancedAnalytics(e:TenantEntitlements){if(!['advanced','pro'].includes(e.analyticsLevel))throw new Error('FEATURE_NOT_ENTITLED:advanced_analytics');}
  assertPosts(e:TenantEntitlements,currentWeek:number,currentMonth:number,requested=1){if(currentWeek+requested>e.postsPerWeek)throw new Error('QUOTA_EXCEEDED:posts_week');if(e.monthlyPostLimit!==null&&currentMonth+requested>e.monthlyPostLimit)throw new Error('QUOTA_EXCEEDED:posts_month');}
}

export class ConnectionLifecycle {
  status(input:{nowMs:number;expiresAtMs?:number;missingPermissions?:string[];rateLimited?:boolean;providerError?:boolean;connected:boolean}):ConnectionHealthStatus{
    if(!input.connected)return'DISCONNECTED';if(input.missingPermissions?.length)return'PERMISSION_MISSING';if(input.rateLimited)return'RATE_LIMITED';if(input.providerError)return'PROVIDER_ERROR';if(input.expiresAtMs!==undefined){if(input.expiresAtMs<=input.nowMs)return'REAUTH_REQUIRED';if(input.expiresAtMs-input.nowMs<=7*24*60*60_000)return'EXPIRING';}return'CONNECTED';
  }
}

export class MockStripeProvider implements BillingProvider {
  readonly key='mock-stripe' as const;private readonly replay=new Map<string,unknown>();
  async createCheckout(input:{tenantId:string;planCode:string;successUrl:string;cancelUrl:string;idempotencyKey:string}){const hit=this.replay.get(input.idempotencyKey) as {checkoutId:string;url:string}|undefined;if(hit)return hit;const result={checkoutId:`cs_mock_${sha256(input.idempotencyKey).slice(0,16)}`,url:`https://checkout.fixture.invalid/${input.tenantId}/${input.planCode}`};this.replay.set(input.idempotencyKey,result);return result;}
  async changePlan(input:{subscriptionId:string;planCode:string;idempotencyKey:string}){return{status:`updated:${input.planCode}`};}
  async cancel(input:{subscriptionId:string;atPeriodEnd:boolean;idempotencyKey:string}){return{status:input.atPeriodEnd?'cancel_at_period_end':'canceled'};}
  async syncEntitlements(input:{tenantId:string;subscriptionId:string}){return{tenantId:input.tenantId,subscriptionId:input.subscriptionId,synced:true};}
}

export type ReadinessDimension='ARCHITECTURE'|'CONTRACTS'|'FIXTURES'|'TESTS'|'UI'|'SECURITY'|'DOCUMENTATION'|'LIVE_CREDENTIALS'|'REMOTE_CALLBACKS';
export type ProviderReadinessStatus='READY_FOR_CREDENTIALS'|'PARTIAL'|'NOT_READY'|'LIVE_VALIDATED';
export interface ProviderReadinessRow {provider:string;status:ProviderReadinessStatus;dimensions:Record<ReadinessDimension,boolean>;missing:string[];}
export const readinessRow=(provider:string,input:Partial<Record<ReadinessDimension,boolean>>):ProviderReadinessRow=>{const dimensions:Object=undefined as never;void dimensions;const keys:ReadinessDimension[]=['ARCHITECTURE','CONTRACTS','FIXTURES','TESTS','UI','SECURITY','DOCUMENTATION','LIVE_CREDENTIALS','REMOTE_CALLBACKS'];const resolved=Object.fromEntries(keys.map((key)=>[key,input[key]??false])) as Record<ReadinessDimension,boolean>;const preLive=keys.filter((key)=>!['LIVE_CREDENTIALS','REMOTE_CALLBACKS'].includes(key));const ready=preLive.every((key)=>resolved[key]);const live=ready&&resolved.LIVE_CREDENTIALS&&resolved.REMOTE_CALLBACKS;return{provider,status:live?'LIVE_VALIDATED':ready?'READY_FOR_CREDENTIALS':Object.values(resolved).some(Boolean)?'PARTIAL':'NOT_READY',dimensions:resolved,missing:keys.filter((key)=>!resolved[key])};};
