import { LocalSupabaseClient, jsonBody } from './db.js';
import { CredentialVault } from './credential-vault.js';

const q=(value:string)=>encodeURIComponent(value);
const pgBytea=(value:Buffer)=>`\\x${value.toString('hex')}`;
const fromBytea=(value:unknown):Buffer=>{
  if(Buffer.isBuffer(value))return Buffer.from(value);
  if(typeof value==='string'&&value.startsWith('\\x'))return Buffer.from(value.slice(2),'hex');
  if(value&&typeof value==='object'&&'data'in value&&Array.isArray((value as {data?:unknown}).data))return Buffer.from((value as {data:number[]}).data);
  throw new Error('credential_ciphertext_invalid');
};

interface CredentialRow {
  tenant_id:string;
  connection_id:string;
  token_ciphertext:unknown;
  refresh_token_ciphertext:unknown|null;
  key_version:number;
  expires_at:string|null;
  metadata:Record<string,unknown>;
  credential_version:number;
  cipher_algorithm:string;
  revoked_at:string|null;
}

export interface StoredIntegrationCredential {
  accessToken:string;
  refreshToken?:string;
  expiresAt?:string;
  metadata:Record<string,unknown>;
  credentialVersion:number;
}

export class IntegrationCredentialStore {
  constructor(
    private readonly db=new LocalSupabaseClient(),
    private readonly vault=CredentialVault.fromEnv(),
  ){}

  async store(input:{tenantId:string;connectionId:string;accessToken:string;refreshToken?:string;expiresAt?:string;metadata?:Record<string,unknown>}):Promise<void>{
    const access=this.vault.encrypt(input.accessToken,{tenantId:input.tenantId,connectionId:input.connectionId,kind:'access_token'});
    const refresh=input.refreshToken?this.vault.encrypt(input.refreshToken,{tenantId:input.tenantId,connectionId:input.connectionId,kind:'refresh_token'}):null;
    const payload={
      tenant_id:input.tenantId,
      connection_id:input.connectionId,
      token_ciphertext:pgBytea(access),
      refresh_token_ciphertext:refresh?pgBytea(refresh):null,
      key_version:this.vault.keyVersion,
      expires_at:input.expiresAt??null,
      metadata:input.metadata??{},
      cipher_algorithm:this.vault.algorithm,
      revoked_at:null,
      rotated_at:new Date().toISOString(),
      updated_at:new Date().toISOString(),
    };
    await this.db.serviceRest('/rest/v1/integration_credentials?on_conflict=connection_id',{
      method:'POST',
      headers:{'content-profile':'app_private','accept-profile':'app_private',prefer:'resolution=merge-duplicates,return=minimal'},
      body:jsonBody(payload),
    });
  }

  async get(tenantId:string,connectionId:string):Promise<StoredIntegrationCredential|null>{
    const rows=await this.db.serviceRest<CredentialRow[]>(`/rest/v1/integration_credentials?select=tenant_id,connection_id,token_ciphertext,refresh_token_ciphertext,key_version,expires_at,metadata,credential_version,cipher_algorithm,revoked_at&tenant_id=eq.${q(tenantId)}&connection_id=eq.${q(connectionId)}&revoked_at=is.null&limit=1`,{headers:{'accept-profile':'app_private'}});
    const row=rows[0];if(!row)return null;
    if(row.cipher_algorithm!==this.vault.algorithm)throw new Error(`credential_cipher_algorithm_unsupported:${row.cipher_algorithm}`);
    if(row.key_version!==this.vault.keyVersion)throw new Error(`credential_key_version_mismatch:${row.key_version}`);
    const accessToken=this.vault.decrypt(fromBytea(row.token_ciphertext),{tenantId,connectionId,kind:'access_token'});
    const refreshToken=row.refresh_token_ciphertext?this.vault.decrypt(fromBytea(row.refresh_token_ciphertext),{tenantId,connectionId,kind:'refresh_token'}):undefined;
    return{accessToken,...(refreshToken?{refreshToken}:{}),...(row.expires_at?{expiresAt:row.expires_at}:{}),metadata:row.metadata??{},credentialVersion:row.credential_version};
  }

  async revoke(tenantId:string,connectionId:string):Promise<void>{
    await this.db.serviceRest(`/rest/v1/integration_credentials?tenant_id=eq.${q(tenantId)}&connection_id=eq.${q(connectionId)}&revoked_at=is.null`,{
      method:'PATCH',headers:{'content-profile':'app_private',prefer:'return=minimal'},body:jsonBody({revoked_at:new Date().toISOString(),token_ciphertext:'\\x00',refresh_token_ciphertext:null,updated_at:new Date().toISOString()}),
    });
  }
}
