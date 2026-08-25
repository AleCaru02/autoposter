import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

export type ApiPlatform = 'facebook' | 'instagram' | 'linkedin' | 'google_business_profile';
export type ApprovalMode = 'auto' | 'manual';
export type LocalRequestInit = Omit<RequestInit, 'body'> & { body?: BodyInit | null | undefined };

export interface ProductHealth {
  ok: boolean;
  environment?: string;
  approval?: string;
  testFixtures?: boolean;
  capabilities?: {
    database?: boolean;
    databaseProvider?: string;
    auth?: boolean;
    openai?: boolean;
    openaiTextModel?: string;
    openaiImages2?: boolean;
    openaiImageModel?: string;
    telegram?: boolean;
    instagram?: boolean;
    facebook?: boolean;
    linkedin?: boolean;
    googleBusinessProfile?: boolean;
  };
}

export interface TenantSummary { id:string;name:string;slug?:string;onboarding_status?:string;created_at?:string; }
export interface LocalWorkspace {
  tenant:Record<string,unknown>|null;onboarding:Record<string,any>|null;brand:Record<string,any>|null;brandVersions:Array<Record<string,any>>;locks:Array<Record<string,any>>;strategy:Record<string,any>|null;pillars:Array<Record<string,any>>;posts:Array<Record<string,any>&{variants:Array<Record<string,any>>}>;connections:Array<Record<string,any>>;jobs:Array<Record<string,any>>;published:Array<Record<string,any>>;analytics:Array<Record<string,any>>;insights:Array<Record<string,any>>;usage:Array<Record<string,any>>;aiUsage:Array<Record<string,any>>;members:Array<Record<string,any>>;
}
interface LocalE2EContextValue {
  enabled:boolean;health:ProductHealth|null;token:string|null;tenantId:string|null;tenants:TenantSummary[];workspace:LocalWorkspace|null;loading:boolean;error:string|null;
  register(input:{name:string;email:string;password:string}):Promise<void>;login(input:{email:string;password:string}):Promise<void>;logout():void;createTenant(input:{name:string;slug:string}):Promise<string>;selectTenant(tenantId:string):Promise<void>;refresh(tenantOverride?:string):Promise<void>;refreshTenants():Promise<void>;refreshHealth():Promise<void>;api<T>(path:string,init?:LocalRequestInit):Promise<T>;
}

interface NeonSessionPayload { access_token?: string; expires_at?: number; }
interface NeonAuthEnvelope { token?:string;session?:NeonSessionPayload|null;user?:Record<string,unknown>|null;data?:{token?:string;session?:NeonSessionPayload|null;user?:Record<string,unknown>|null}|null;error?:{message?:string}|string|null;message?:string; }
interface NeonAuthResult { body:NeonAuthEnvelope;jwt:string|null; }

const Context=createContext<LocalE2EContextValue|null>(null);
const e2eFixtures=import.meta.env.VITE_E2E_FIXTURES==='true';
const productionApiUrl=(import.meta.env.VITE_API_URL as string|undefined)?.trim().replace(/\/$/,'')??'';
const testApiUrl=e2eFixtures?((import.meta.env.VITE_LOCAL_API_URL as string|undefined)?.trim().replace(/\/$/,'')??''):'';
const baseUrl=productionApiUrl||testApiUrl;
const directNeonAuthRoot=!e2eFixtures?((import.meta.env.VITE_NEON_AUTH_URL as string|undefined)?.trim().replace(/\/$/,'')??''):'';
const neonAuthApiBase=!e2eFixtures?(productionApiUrl?`${baseUrl}/auth/neon`:directNeonAuthRoot?`${directNeonAuthRoot}/auth`:''):'';
const neonEnabled=Boolean(neonAuthApiBase);
const TOKEN_KEY='post-automatici.session.token';const TENANT_KEY='post-automatici.active-tenant';const LEGACY_TOKEN_KEY='socialpilot.local.token';const LEGACY_TENANT_KEY='socialpilot.local.tenant';

const readStored=(primary:string,legacy:string):string|null=>{const value=localStorage.getItem(primary)??localStorage.getItem(legacy);if(value&&!localStorage.getItem(primary))localStorage.setItem(primary,value);return value;};
const request=async<T,>(path:string,init:LocalRequestInit={},token?:string|null):Promise<T>=>{
  if(!baseUrl)throw new Error('Backend API non configurato');const{body:requestBody,...rest}=init;const headers=new Headers(init.headers);if(requestBody&&!headers.has('content-type'))headers.set('content-type','application/json');if(token)headers.set('authorization',`Bearer ${token}`);const fetchInit:RequestInit=requestBody===undefined?{...rest,headers}:{...rest,headers,body:requestBody};const response=await fetch(`${baseUrl}${path}`,fetchInit);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(String(body.error??body.message??`HTTP ${response.status}`));return body as T;
};
const neonAuthRequest=async(path:string,init:RequestInit={}):Promise<NeonAuthResult>=>{
  if(!neonAuthApiBase)throw new Error('Neon Auth non configurato');
  const headers=new Headers(init.headers);if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json');
  const response=await fetch(`${neonAuthApiBase}/${path}`,{...init,headers,credentials:'include'});
  const body=await response.json().catch(()=>({})) as NeonAuthEnvelope;
  if(!response.ok){const nested=body.error;const message=typeof nested==='string'?nested:nested?.message??body.message??`Neon Auth HTTP ${response.status}`;throw new Error(message);}
  return{body,jwt:response.headers.get('set-auth-jwt')};
};
const freshNeonToken=async():Promise<string|null>=>{
  if(!neonEnabled)return null;
  try{
    const tokenResult=await neonAuthRequest('token',{method:'GET'});
    const direct=tokenResult.body.token??tokenResult.body.data?.token??tokenResult.jwt;
    if(typeof direct==='string'&&direct)return direct;
  }catch{}
  const result=await neonAuthRequest('get-session',{method:'GET'});
  const session=result.body.session??result.body.data?.session??null;
  const legacy=typeof session?.access_token==='string'&&session.access_token?session.access_token:null;
  return result.jwt??legacy;
};

export function LocalE2EProvider({children}:PropsWithChildren){
  const enabled=Boolean(baseUrl);const[health,setHealth]=useState<ProductHealth|null>(null);const[token,setToken]=useState<string|null>(()=>enabled&&!neonEnabled?readStored(TOKEN_KEY,LEGACY_TOKEN_KEY):null);const[tenantId,setTenantId]=useState<string|null>(()=>enabled?readStored(TENANT_KEY,LEGACY_TENANT_KEY):null);const[tenants,setTenants]=useState<TenantSummary[]>([]);const[workspace,setWorkspace]=useState<LocalWorkspace|null>(null);const[loading,setLoading]=useState(false);const[error,setError]=useState<string|null>(null);const refreshSequence=useRef(0);
  const storeSession=useCallback((accessToken:string)=>{if(neonEnabled){localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(LEGACY_TOKEN_KEY);setToken(accessToken);return;}localStorage.setItem(TOKEN_KEY,accessToken);localStorage.removeItem(LEGACY_TOKEN_KEY);setToken(accessToken);},[]);
  const clearSession=useCallback(()=>{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(TENANT_KEY);localStorage.removeItem(LEGACY_TOKEN_KEY);localStorage.removeItem(LEGACY_TENANT_KEY);setToken(null);setTenantId(null);setTenants([]);setWorkspace(null);setError(null);},[]);
  const resolvedToken=useCallback(async()=>{if(neonEnabled){const next=await freshNeonToken();if(next&&next!==token)storeSession(next);return next;}return token;},[token,storeSession]);
  const authedApi=useCallback(async<T,>(path:string,init:LocalRequestInit={}):Promise<T>=>request<T>(path,init,await resolvedToken()),[resolvedToken]);
  const refreshHealth=useCallback(async()=>{if(!enabled){setHealth(null);return;}try{setHealth(await request<ProductHealth>('/health'));}catch{setHealth({ok:false});}},[enabled]);
  const refreshTenants=useCallback(async()=>{
    const accessToken=await resolvedToken();if(!enabled||!accessToken){setTenants([]);return;}
    try{const rows=await request<TenantSummary[]>('/tenants',{},accessToken);setTenants(rows);setError(null);const selectedExists=tenantId?rows.some((tenant)=>tenant.id===tenantId):false;if(!selectedExists&&rows[0]){localStorage.setItem(TENANT_KEY,rows[0].id);setTenantId(rows[0].id);}}
    catch(err){setError(err instanceof Error?err.message:String(err));throw err;}
  },[enabled,resolvedToken,tenantId]);
  const refresh=useCallback(async(tenantOverride?:string)=>{
    const sequence=++refreshSequence.current;const targetTenantId=tenantOverride??tenantId;const accessToken=await resolvedToken();if(!enabled||!accessToken||!targetTenantId){if(sequence===refreshSequence.current)setWorkspace(null);return;}setLoading(true);setError(null);
    try{const nextWorkspace=await request<LocalWorkspace>(`/tenants/${targetTenantId}/workspace`,{},accessToken);if(sequence===refreshSequence.current)setWorkspace(nextWorkspace);}catch(err){if(sequence===refreshSequence.current)setError(err instanceof Error?err.message:String(err));throw err;}finally{if(sequence===refreshSequence.current)setLoading(false);}
  },[enabled,resolvedToken,tenantId]);

  useEffect(()=>{void refreshHealth();},[refreshHealth]);
  useEffect(()=>{if(!neonEnabled)return;void freshNeonToken().then((next)=>{if(next)storeSession(next);else clearSession();}).catch(()=>clearSession());},[storeSession,clearSession]);
  useEffect(()=>{void refreshTenants().catch(()=>undefined);},[refreshTenants]);
  useEffect(()=>{void refresh().catch(()=>undefined);},[refresh]);

  const register=async(input:{name:string;email:string;password:string})=>{
    setLoading(true);setError(null);try{
      if(neonEnabled){await neonAuthRequest('sign-up/email',{method:'POST',body:JSON.stringify({email:input.email,password:input.password,name:input.name})});const accessToken=await freshNeonToken();if(!accessToken)throw new Error('Account creato. Completa l’eventuale verifica email e poi accedi.');storeSession(accessToken);return;}
      const session=await request<{access_token:string}>('/auth/register',{method:'POST',body:JSON.stringify(input)});storeSession(session.access_token);
    }catch(err){setError(err instanceof Error?err.message:String(err));throw err;}finally{setLoading(false);}
  };
  const login=async(input:{email:string;password:string})=>{
    setLoading(true);setError(null);try{
      if(neonEnabled){await neonAuthRequest('sign-in/email',{method:'POST',body:JSON.stringify({email:input.email,password:input.password})});const accessToken=await freshNeonToken();if(!accessToken)throw new Error('Accesso completato ma sessione JWT non disponibile.');storeSession(accessToken);return;}
      const session=await request<{access_token:string}>('/auth/login',{method:'POST',body:JSON.stringify(input)});storeSession(session.access_token);
    }catch(err){setError(err instanceof Error?err.message:String(err));throw err;}finally{setLoading(false);}
  };
  const logout=()=>{refreshSequence.current+=1;if(neonEnabled)void neonAuthRequest('sign-out',{method:'POST'}).catch(()=>undefined);clearSession();};
  const createTenant=async(input:{name:string;slug:string})=>{const accessToken=await resolvedToken();if(!accessToken)throw new Error('Accedi prima di creare il workspace');const result=await request<{tenantId:string}>('/tenants',{method:'POST',body:JSON.stringify(input)},accessToken);localStorage.setItem(TENANT_KEY,result.tenantId);localStorage.removeItem(LEGACY_TENANT_KEY);setTenantId(result.tenantId);const rows=await request<TenantSummary[]>('/tenants',{},accessToken);setTenants(rows);await refresh(result.tenantId);return result.tenantId;};
  const selectTenant=async(id:string)=>{refreshSequence.current+=1;localStorage.setItem(TENANT_KEY,id);localStorage.removeItem(LEGACY_TENANT_KEY);setTenantId(id);await refresh(id);};
  const value=useMemo<LocalE2EContextValue>(()=>({enabled,health,token,tenantId,tenants,workspace,loading,error,register,login,logout,createTenant,selectTenant,refresh,refreshTenants,refreshHealth,api:authedApi}),[enabled,health,token,tenantId,tenants,workspace,loading,error,refresh,refreshTenants,refreshHealth,authedApi]);return<Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLocalE2E():LocalE2EContextValue{const value=useContext(Context);if(!value)throw new Error('Product API provider richiesto');return value;}
export const localE2EEnabled=Boolean(baseUrl);export const internalE2EFixturesEnabled=e2eFixtures;export const productionNeonAuthEnabled=neonEnabled;
