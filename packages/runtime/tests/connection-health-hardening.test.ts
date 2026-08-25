import { describe,expect,it } from 'vitest';
import { ProviderConnectionHealthMachine } from '../src/connection-health.js';

describe('provider connection health hardening',()=>{
  const now=1_700_000_000_000;const machine=new ProviderConnectionHealthMachine();
  it('covers connected -> degraded/expiring -> expired -> reauth -> connected',()=>{expect(machine.status({nowMs:now,connected:true,expiresAtMs:now+30*86400_000})).toBe('CONNECTED');expect(machine.status({nowMs:now,connected:true,degraded:true,expiresAtMs:now+30*86400_000})).toBe('DEGRADED');expect(machine.status({nowMs:now,connected:true,expiresAtMs:now+2*86400_000})).toBe('EXPIRING');expect(machine.status({nowMs:now,connected:true,expiresAtMs:now-1})).toBe('EXPIRED');expect(machine.status({nowMs:now,connected:true,reauthRequired:true,expiresAtMs:now-1})).toBe('REAUTH_REQUIRED');expect(machine.status({nowMs:now,connected:true,expiresAtMs:now+60*86400_000})).toBe('CONNECTED');});
  it('covers permission loss and refresh recovery with actionable UI text',()=>{const missing=machine.snapshot({nowMs:now,connected:true,missingPermissions:['publish']});expect(missing.status).toBe('PERMISSION_MISSING');expect(missing.recommendedAction).toContain('autorizzazioni');expect(machine.status({nowMs:now,connected:true})).toBe('CONNECTED');});
  it('covers rate limit and recovery with actionable UI text',()=>{const limited=machine.snapshot({nowMs:now,connected:true,rateLimited:true});expect(limited.status).toBe('RATE_LIMITED');expect(limited.recommendedAction).toContain('reset');expect(machine.status({nowMs:now,connected:true})).toBe('CONNECTED');});
});
