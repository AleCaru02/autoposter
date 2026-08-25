import { AsyncLocalStorage } from 'node:async_hooks';

export interface AiRequestStore { tenantId:string;postId?:string;postVariantId?:string; }
const storage=new AsyncLocalStorage<AiRequestStore>();
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value)?value:undefined;

export function runAiRequestContext<T>(context:string|AiRequestStore,fn:()=>T):T{
  const input=typeof context==='string'?{tenantId:context}:context;
  const tenantId=uuid(input.tenantId);if(!tenantId)return fn();
  const store:AiRequestStore={tenantId,...(uuid(input.postId)?{postId:input.postId}:{}),...(uuid(input.postVariantId)?{postVariantId:input.postVariantId}:{})};
  return storage.run(store,fn);
}

export function currentAiRequestContext():AiRequestStore|null{return storage.getStore()??null;}
export function currentAiTenantId():string|null{return storage.getStore()?.tenantId??null;}
