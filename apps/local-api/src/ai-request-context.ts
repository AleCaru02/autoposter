import { AsyncLocalStorage } from 'node:async_hooks';

interface AiRequestStore { tenantId:string; }
const storage=new AsyncLocalStorage<AiRequestStore>();

export function runAiRequestContext<T>(tenantId:string,fn:()=>T):T{
  if(!/^[0-9a-f-]{36}$/i.test(tenantId))return fn();
  return storage.run({tenantId},fn);
}

export function currentAiTenantId():string|null{
  return storage.getStore()?.tenantId??null;
}
