import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION=1;
const IV_BYTES=12;
const TAG_BYTES=16;
const KEY_BYTES=32;

function parseKey(raw:string):Buffer{
  const value=raw.trim();
  if(/^[0-9a-fA-F]{64}$/.test(value))return Buffer.from(value,'hex');
  try{const decoded=Buffer.from(value,'base64');if(decoded.length===KEY_BYTES)return decoded;}catch{}
  throw new Error('ENCRYPTION_KEY_CURRENT must be exactly 32 bytes encoded as base64 or 64 hex characters');
}

export interface CredentialAad {
  tenantId:string;
  connectionId:string;
  kind:'access_token'|'refresh_token'|'pkce_verifier'|'provider_secret';
}

const aadBytes=(aad:CredentialAad)=>Buffer.from(`post-automatici\u0000${aad.tenantId}\u0000${aad.connectionId}\u0000${aad.kind}`,'utf8');

export class CredentialVault {
  private readonly key:Buffer;
  readonly keyVersion:number;
  readonly algorithm='aes-256-gcm';

  constructor(input:{key:string;keyVersion?:number}){
    this.key=parseKey(input.key);
    this.keyVersion=Math.max(1,Math.floor(input.keyVersion??1));
  }

  static fromEnv():CredentialVault{
    const key=process.env.ENCRYPTION_KEY_CURRENT?.trim();
    if(!key)throw new Error('ENCRYPTION_KEY_CURRENT_NOT_CONFIGURED');
    const keyVersion=Number(process.env.ENCRYPTION_KEY_VERSION??1);
    if(!Number.isInteger(keyVersion)||keyVersion<1)throw new Error('ENCRYPTION_KEY_VERSION_INVALID');
    return new CredentialVault({key,keyVersion});
  }

  encrypt(value:string,aad:CredentialAad):Buffer{
    if(!value)throw new Error('credential_empty');
    const iv=randomBytes(IV_BYTES);
    const cipher=createCipheriv('aes-256-gcm',this.key,iv,{authTagLength:TAG_BYTES});
    cipher.setAAD(aadBytes(aad));
    const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    const tag=cipher.getAuthTag();
    const header=Buffer.allocUnsafe(5);
    header.writeUInt8(VERSION,0);
    header.writeUInt32BE(this.keyVersion,1);
    return Buffer.concat([header,iv,tag,ciphertext]);
  }

  decrypt(envelope:Buffer,aad:CredentialAad):string{
    if(envelope.length<5+IV_BYTES+TAG_BYTES)throw new Error('credential_envelope_invalid');
    const version=envelope.readUInt8(0);
    if(version!==VERSION)throw new Error(`credential_envelope_version_unsupported:${version}`);
    const storedKeyVersion=envelope.readUInt32BE(1);
    if(storedKeyVersion!==this.keyVersion)throw new Error(`credential_key_version_mismatch:${storedKeyVersion}`);
    const iv=envelope.subarray(5,5+IV_BYTES);
    const tag=envelope.subarray(5+IV_BYTES,5+IV_BYTES+TAG_BYTES);
    const ciphertext=envelope.subarray(5+IV_BYTES+TAG_BYTES);
    const decipher=createDecipheriv('aes-256-gcm',this.key,iv,{authTagLength:TAG_BYTES});
    decipher.setAAD(aadBytes(aad));
    decipher.setAuthTag(tag);
    try{return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');}
    catch{throw new Error('credential_authentication_failed');}
  }
}
