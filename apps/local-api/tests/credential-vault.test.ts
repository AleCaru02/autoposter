import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialVault } from '../src/credential-vault.js';

const key=randomBytes(32).toString('base64');
const aad={tenantId:'11111111-1111-1111-1111-111111111111',connectionId:'22222222-2222-2222-2222-222222222222',kind:'access_token' as const};

describe('CredentialVault',()=>{
  it('round-trips a credential without storing plaintext',()=>{
    const vault=new CredentialVault({key,keyVersion:7});
    const plaintext='provider-secret-token-value';
    const encrypted=vault.encrypt(plaintext,aad);
    expect(encrypted.toString('utf8')).not.toContain(plaintext);
    expect(vault.decrypt(encrypted,aad)).toBe(plaintext);
  });

  it('rejects a credential copied to another tenant or connection',()=>{
    const vault=new CredentialVault({key,keyVersion:1});
    const encrypted=vault.encrypt('token',aad);
    expect(()=>vault.decrypt(encrypted,{...aad,tenantId:'33333333-3333-3333-3333-333333333333'})).toThrow('credential_authentication_failed');
    expect(()=>vault.decrypt(encrypted,{...aad,connectionId:'44444444-4444-4444-4444-444444444444'})).toThrow('credential_authentication_failed');
  });

  it('rejects ciphertext tampering',()=>{
    const vault=new CredentialVault({key,keyVersion:1});
    const encrypted=Buffer.from(vault.encrypt('token',aad));
    encrypted[encrypted.length-1]^=0xff;
    expect(()=>vault.decrypt(encrypted,aad)).toThrow('credential_authentication_failed');
  });

  it('rejects a different key version',()=>{
    const original=new CredentialVault({key,keyVersion:1});
    const rotated=new CredentialVault({key,keyVersion:2});
    expect(()=>rotated.decrypt(original.encrypt('token',aad),aad)).toThrow('credential_key_version_mismatch:1');
  });

  it('requires a real 256-bit key',()=>{
    expect(()=>new CredentialVault({key:'short'})).toThrow('32 bytes');
  });
});
