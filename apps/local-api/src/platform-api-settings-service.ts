import { createHash } from 'node:crypto';
import { CredentialVault } from './credential-vault.js';
import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);
const providers=['openai','meta','linkedin','google_business_profile','telegram'] as const;
export type PlatformProvider=typeof providers[number];
const providerSet=new Set<string>(providers);
const allowedFields:Record<PlatformProvider,string[]>={
  openai:['apiKey','pricingJson','economyModel','standardModel','premiumModel','imageModel'],
  meta:['appId','appSecret'],
  linkedin:['clientId','clientSecret'],
  google_business_profile:['clientId','clientSecret'],
  telegram:['botToken','webhookSecret'],
};
const requiredFields:Partial<Record<PlatformProvider,string[]>>={openai:['apiKey','pricingJson']};
const pgBytea=(value:Buffer)=>`\\x${value.toString('hex')}`;
const fromBytea=(value:unknown):Buffer=>{
  if(Buffer.isBuffer(value))return Buffer.from(value);
  if(typeof value==='string'&&value.startsWith('\\x'))return Buffer.from(value.slice(2),'hex');
  if(value&&typeof value==='object'&&'data'in value&&Array.isArray((value as {data?:unknown}).data))return Buffer.from((value as {data:number[]}).data);
  throw new Error('platform_secret_ciphertext_invalid');
};
const masked=(value:string)=>value.length<=4?'••••':`••••••${value.slice(-4)}`;
const now=()=>new Date().toISOString();

interface SettingRow{
  provider:PlatformProvider;
  secret_ciphertext:unknown;
  key_version:number;
  cipher_algorithm:string;
  configured_fields:string[];
  public_config:Record<string,unknown>;
  updated_at:string;
}

function vaultFromRuntime(){
  const explicit=process.env.ENCRYPTION_KEY_CURRENT?.trim();
  if(explicit)return CredentialVault.fromEnv();
  const stagingSecret=process.env.ASSET_SIGNING_SECRET?.trim();
  if((process.env.APP_ENV??'').toUpperCase()==='STAGING'&&stagingSecret){
    return new CredentialVault({key:createHash('sha256').update(stagingSecret).digest('base64'),keyVersion:1});
  }
  throw new Error('PLATFORM_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED');
}

export class PlatformApiSettingsService{
  constructor(private readonly db=new LocalSupabaseClient()){}

  private async requireAdmin(token:string){
    const user=await this.db.getUser(token);
    const rows=await this.db.serviceRest<Array<{user_id:string}>>(`/rest/v1/platform_admins?select=user_id&user_id=eq.${q(user.id)}&limit=1`,{headers:{'accept-profile':'app_private'}});
    if(!rows.some((row)=>row.user_id===user.id))throw new Error('platform_admin_required');
    return user;
  }

  async status(token:string){
    await this.requireAdmin(token);
    const rows=await this.db.serviceRest<SettingRow[]>('/rest/v1/platform_api_settings?select=provider,secret_ciphertext,key_version,cipher_algorithm,configured_fields,public_config,updated_at',{headers:{'accept-profile':'app_private'}}).catch(()=>[]);
    const byProvider=new Map(rows.map((row)=>[row.provider,row]));
    return providers.map((provider)=>{
      const row=byProvider.get(provider);
      return{
        provider,
        configured:Boolean(row),
        configuredFields:Array.isArray(row?.configured_fields)?row?.configured_fields:[],
        publicConfig:row?.public_config??{},
        updatedAt:row?.updated_at??null,
        runtimeAdapter:provider==='openai'?'real':'not_yet_live',
        liveCapable:provider==='openai',
      };
    });
  }

  async save(token:string,providerRaw:string,input:Record<string,unknown>){
    const admin=await this.requireAdmin(token);
    if(!providerSet.has(providerRaw))throw new Error('invalid_platform_provider');
    const provider=providerRaw as PlatformProvider;
    const vault=vaultFromRuntime();
    const existing=await this.readSecrets(provider).catch(()=>({} as Record<string,string>));
    const merged:Record<string,string>={...existing};
    for(const field of allowedFields[provider]){
      const value=input[field];
      if(typeof value==='string'&&value.trim())merged[field]=value.trim();
      if(value===null)delete merged[field];
    }
    const missing=(requiredFields[provider]??[]).filter((field)=>!merged[field]);
    if(missing.length)throw new Error(`missing_required_fields:${missing.join(',')}`);
    if(provider==='openai'){
      if(merged.imageModel&&merged.imageModel!=='gpt-image-2')throw new Error('OPENAI_IMAGES_MODEL_INVALID');
      try{JSON.parse(merged.pricingJson??'');}catch{throw new Error('AI_PRICING_JSON_INVALID');}
    }
    const envelope=vault.encrypt(JSON.stringify(merged),{tenantId:'platform',connectionId:provider,kind:'provider_secret'});
    const publicConfig:Record<string,unknown>={};
    if(provider==='openai'){
      publicConfig.economyModel=merged.economyModel??'gpt-5.6-luna';
      publicConfig.standardModel=merged.standardModel??'gpt-5.6-terra';
      publicConfig.premiumModel=merged.premiumModel??'gpt-5.6-sol';
      publicConfig.imageModel=merged.imageModel??'gpt-image-2';
      publicConfig.apiKeyMasked=merged.apiKey?masked(merged.apiKey):null;
    }else{
      for(const field of allowedFields[provider])if(merged[field])publicConfig[`${field}Masked`]=masked(merged[field]);
    }
    await this.db.serviceRest('/rest/v1/platform_api_settings?on_conflict=provider',{
      method:'POST',
      headers:{'content-profile':'app_private','accept-profile':'app_private',prefer:'resolution=merge-duplicates,return=minimal'},
      body:jsonBody({provider,secret_ciphertext:pgBytea(envelope),key_version:vault.keyVersion,cipher_algorithm:vault.algorithm,configured_fields:Object.keys(merged),public_config:publicConfig,updated_by:admin.id,updated_at:now()}),
    });
    await this.hydrateRuntime();
    return{provider,configured:true,configuredFields:Object.keys(merged),publicConfig};
  }

  async remove(token:string,providerRaw:string){
    await this.requireAdmin(token);
    if(!providerSet.has(providerRaw))throw new Error('invalid_platform_provider');
    await this.db.serviceRest(`/rest/v1/platform_api_settings?provider=eq.${q(providerRaw)}`,{method:'DELETE',headers:{'content-profile':'app_private',prefer:'return=minimal'}});
    if(providerRaw==='openai'){
      delete process.env.OPENAI_API_KEY;delete process.env.OPENAI_PRICING_JSON;process.env.OPENAI_LIVE='false';
    }
    return{provider:providerRaw,configured:false};
  }

  async hydrateRuntime(){
    const config=await this.readSecrets('openai').catch(()=>null);
    if(!config)return false;
    process.env.OPENAI_API_KEY=config.apiKey??'';
    process.env.OPENAI_PRICING_JSON=config.pricingJson??'';
    process.env.AI_MODEL_TEXT_ECONOMY=config.economyModel??'gpt-5.6-luna';
    process.env.AI_MODEL_TEXT_STANDARD=config.standardModel??'gpt-5.6-terra';
    process.env.AI_MODEL_TEXT_PREMIUM=config.premiumModel??'gpt-5.6-sol';
    process.env.AI_MODEL_IMAGE_GENERATION=config.imageModel??'gpt-image-2';
    process.env.OPENAI_LIVE=config.apiKey&&config.pricingJson?'true':'false';
    return process.env.OPENAI_LIVE==='true';
  }

  private async readSecrets(provider:PlatformProvider):Promise<Record<string,string>>{
    const rows=await this.db.serviceRest<SettingRow[]>(`/rest/v1/platform_api_settings?select=provider,secret_ciphertext,key_version,cipher_algorithm,configured_fields,public_config,updated_at&provider=eq.${q(provider)}&limit=1`,{headers:{'accept-profile':'app_private'}});
    const row=rows[0];if(!row)return{};
    const vault=vaultFromRuntime();
    if(row.cipher_algorithm!==vault.algorithm)throw new Error('platform_secret_cipher_algorithm_unsupported');
    const plain=vault.decrypt(fromBytea(row.secret_ciphertext),{tenantId:'platform',connectionId:provider,kind:'provider_secret'});
    const parsed=JSON.parse(plain) as Record<string,unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([,value])=>typeof value==='string').map(([key,value])=>[key,String(value)]));
  }
}
