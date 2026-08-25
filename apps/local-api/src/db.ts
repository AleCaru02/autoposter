import { createHash } from 'node:crypto';
import { Pool, type QueryResultRow } from 'pg';

export type DataBackend='supabase'|'neon';
export interface LocalSupabaseConfig {
  backend:DataBackend;
  url:string;
  anonKey:string;
  serviceRoleKey:string;
  neonDataApiUrl?:string;
  neonAuthUrl?:string;
  neonDatabaseUrl?:string;
}
export interface AuthSession { access_token:string;refresh_token?:string;expires_in?:number;token_type?:string;user:{id:string;email?:string|null;user_metadata?:Record<string,unknown>}; }

const trimSlash=(value:string)=>value.replace(/\/$/,'');
export const loadLocalSupabaseConfig=():LocalSupabaseConfig=>{
  const neonDataApiUrl=process.env.NEON_DATA_API_URL?.trim();
  const neonDatabaseUrl=process.env.NEON_DATABASE_URL?.trim();
  const neonAuthUrl=process.env.NEON_AUTH_URL?.trim();
  if(neonDataApiUrl&&neonDatabaseUrl){
    return{backend:'neon',url:trimSlash(neonDataApiUrl),anonKey:'',serviceRoleKey:'',neonDataApiUrl:trimSlash(neonDataApiUrl),neonDatabaseUrl,neonAuthUrl:neonAuthUrl?trimSlash(neonAuthUrl):undefined};
  }
  const url=process.env.SUPABASE_URL??process.env.LOCAL_SUPABASE_URL??process.env.TEST_SUPABASE_URL;
  const anonKey=process.env.SUPABASE_PUBLISHABLE_KEY??process.env.LOCAL_SUPABASE_ANON_KEY??process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey=process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY??process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!anonKey||!serviceRoleKey)throw new Error('database_env_missing');
  return{backend:'supabase',url:trimSlash(url),anonKey,serviceRoleKey};
};

const parseResponse=async<T>(response:Response,prefix='data'):Promise<T>=>{
  const text=await response.text();
  if(!response.ok){
    let detail=text;
    try{const parsed=JSON.parse(text)as{message?:string;error_description?:string;code?:string|number;error?:string};detail=String(parsed.message??parsed.error_description??parsed.error??parsed.code??text)}catch{}
    throw new Error(`${prefix}_${response.status}:${detail}`);
  }
  if(!text)return undefined as T;
  return JSON.parse(text)as T;
};
const wait=(ms:number)=>new Promise<void>((resolve)=>setTimeout(resolve,ms));
const safeIdentifier=(value:string):string=>{if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))throw new Error(`unsafe_sql_identifier:${value}`);return `"${value}"`;};
const parseJsonBody=(body:BodyInit|null|undefined):unknown=>{
  if(body===undefined||body===null)return undefined;
  if(typeof body==='string')return JSON.parse(body) as unknown;
  throw new Error('service_rest_json_body_required');
};
const decodedJwtPayload=(token:string):Record<string,unknown>=>{
  const part=token.split('.')[1];
  if(!part)throw new Error('invalid_access_token');
  try{return JSON.parse(Buffer.from(part,'base64url').toString('utf8')) as Record<string,unknown>}catch{throw new Error('invalid_access_token')}
};

interface SqlFilter { sql:string; values:unknown[]; }
function parseScalar(value:string):unknown{
  if(value==='null')return null;
  if(value==='true')return true;
  if(value==='false')return false;
  if(/^-?\d+(?:\.\d+)?$/.test(value))return Number(value);
  return value;
}
function buildFilters(params:URLSearchParams,startIndex=1):SqlFilter{
  const clauses:string[]=[];const values:unknown[]=[];
  const reserved=new Set(['select','order','limit','offset','on_conflict','columns']);
  for(const [column,raw] of params.entries()){
    if(reserved.has(column))continue;
    if(column==='or'||column==='and')throw new Error('service_rest_complex_filter_not_supported');
    const col=safeIdentifier(column);
    const add=(value:unknown)=>{values.push(value);return `$${startIndex+values.length-1}`;};
    if(raw.startsWith('eq.'))clauses.push(`${col} = ${add(parseScalar(raw.slice(3)))}`);
    else if(raw.startsWith('neq.'))clauses.push(`${col} <> ${add(parseScalar(raw.slice(4)))}`);
    else if(raw.startsWith('gt.'))clauses.push(`${col} > ${add(parseScalar(raw.slice(3)))}`);
    else if(raw.startsWith('gte.'))clauses.push(`${col} >= ${add(parseScalar(raw.slice(4)))}`);
    else if(raw.startsWith('lt.'))clauses.push(`${col} < ${add(parseScalar(raw.slice(3)))}`);
    else if(raw.startsWith('lte.'))clauses.push(`${col} <= ${add(parseScalar(raw.slice(4)))}`);
    else if(raw.startsWith('is.')){
      const target=raw.slice(3);
      if(target==='null')clauses.push(`${col} is null`);else if(target==='true')clauses.push(`${col} is true`);else if(target==='false')clauses.push(`${col} is false`);else throw new Error(`service_rest_is_filter:${raw}`);
    }else if(raw.startsWith('not.is.')){
      const target=raw.slice(7);if(target==='null')clauses.push(`${col} is not null`);else throw new Error(`service_rest_not_filter:${raw}`);
    }else if(raw.startsWith('in.(')&&raw.endsWith(')')){
      const items=raw.slice(4,-1).split(',').map((item)=>parseScalar(item.replace(/^"|"$/g,'')));
      if(items.length===0)clauses.push('false');else clauses.push(`${col} in (${items.map((item)=>add(item)).join(',')})`);
    }else if(raw.startsWith('like.'))clauses.push(`${col} like ${add(raw.slice(5))}`);
    else if(raw.startsWith('ilike.'))clauses.push(`${col} ilike ${add(raw.slice(6))}`);
    else throw new Error(`service_rest_filter_not_supported:${column}=${raw}`);
  }
  return{sql:clauses.length?` where ${clauses.join(' and ')}`:'',values};
}
function selectClause(value:string|null):string{
  if(!value||value==='*')return '*';
  const fields=value.split(',').map((item)=>item.trim()).filter(Boolean);
  if(fields.some((field)=>!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)))return '*';
  return fields.map(safeIdentifier).join(',');
}
function orderClause(value:string|null):string{
  if(!value)return'';
  const parts=value.split(',').map((piece)=>{
    const bits=piece.trim().split('.');const column=bits[0];if(!column)return null;
    const direction=bits.includes('desc')?'desc':'asc';const nulls=bits.includes('nullslast')?' nulls last':bits.includes('nullsfirst')?' nulls first':'';
    return `${safeIdentifier(column)} ${direction}${nulls}`;
  }).filter((value):value is string=>Boolean(value));
  return parts.length?` order by ${parts.join(',')}`:'';
}

export class LocalSupabaseClient{
  private readonly pool:Pool|null;
  constructor(readonly config:LocalSupabaseConfig=loadLocalSupabaseConfig()){
    this.pool=config.backend==='neon'&&config.neonDatabaseUrl?new Pool({connectionString:config.neonDatabaseUrl,max:3,idleTimeoutMillis:10_000,connectionTimeoutMillis:10_000}):null;
  }

  async signUp(input:{email:string;password:string;name:string}):Promise<AuthSession>{
    if(this.config.backend==='neon')throw new Error('NEON_AUTH_CLIENT_REQUIRED');
    let lastResponse:Response|undefined;
    for(let attempt=0;attempt<3;attempt+=1){
      const response=await fetch(`${this.config.url}/auth/v1/signup`,{method:'POST',headers:{apikey:this.config.anonKey,'content-type':'application/json'},body:JSON.stringify({email:input.email,password:input.password,data:{name:input.name}})});
      lastResponse=response;
      if(response.ok){const body=await parseResponse<AuthSession|{user:AuthSession['user'];session:AuthSession|null}>(response,'supabase');if('access_token'in body)return body;if('session'in body&&body.session)return body.session;throw new Error('local_signup_no_session')}
      if(response.status!==400||attempt===2)return parseResponse<AuthSession>(response,'supabase');
      await wait(250*(attempt+1));
    }
    if(lastResponse)return parseResponse<AuthSession>(lastResponse,'supabase');throw new Error('local_signup_failed');
  }
  async signIn(input:{email:string;password:string}):Promise<AuthSession>{
    if(this.config.backend==='neon')throw new Error('NEON_AUTH_CLIENT_REQUIRED');
    const response=await fetch(`${this.config.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:this.config.anonKey,'content-type':'application/json'},body:JSON.stringify(input)});return parseResponse<AuthSession>(response,'supabase');
  }
  async getUser(accessToken:string):Promise<AuthSession['user']>{
    if(this.config.backend==='supabase'){
      const response=await fetch(`${this.config.url}/auth/v1/user`,{headers:{apikey:this.config.anonKey,authorization:`Bearer ${accessToken}`}});return parseResponse<AuthSession['user']>(response,'supabase');
    }
    await this.userRest<unknown[]>(accessToken,'/rest/v1/tenants?select=id&limit=0');
    const payload=decodedJwtPayload(accessToken);const id=String(payload.sub??'');if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('invalid_access_token_subject');
    return{id,email:typeof payload.email==='string'?payload.email:null,user_metadata:{name:typeof payload.name==='string'?payload.name:undefined}};
  }
  async userRest<T>(accessToken:string,path:string,init:RequestInit={}):Promise<T>{
    if(this.config.backend==='supabase')return this.supabaseRest<T>(path,accessToken,this.config.anonKey,init);
    const base=this.config.neonDataApiUrl;if(!base)throw new Error('neon_data_api_missing');
    const relative=path.startsWith('/rest/v1')?path.slice('/rest/v1'.length):path;
    const headers=new Headers(init.headers);headers.set('authorization',`Bearer ${accessToken}`);if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json');
    if(init.method&&['POST','PATCH','PUT','DELETE'].includes(init.method.toUpperCase())&&!headers.has('prefer'))headers.set('prefer','return=representation');
    return parseResponse<T>(await fetch(`${base}${relative}`,{...init,headers}),'neon_data');
  }
  async serviceRest<T>(path:string,init:RequestInit={}):Promise<T>{
    if(this.config.backend==='supabase')return this.supabaseRest<T>(path,this.config.serviceRoleKey,this.config.serviceRoleKey,init);
    return this.neonServiceRest<T>(path,init);
  }
  async serviceAuth<T>(path:string,init:RequestInit={}):Promise<T>{
    if(this.config.backend==='neon')throw new Error('NEON_AUTH_ADMIN_NOT_ENABLED_FOR_PERSONAL_PRODUCT');
    return this.serviceRequest<T>(`/auth/v1${path}`,init);
  }
  async serviceStorage<T>(path:string,init:RequestInit={}):Promise<T>{
    if(this.config.backend==='neon')throw new Error('NEON_BINARY_STORAGE_USE_OBJECT_METHODS');
    return this.serviceRequest<T>(`/storage/v1${path}`,init);
  }
  async serviceRequest<T>(path:string,init:RequestInit={}):Promise<T>{
    if(this.config.backend==='neon')throw new Error('NEON_GENERIC_SERVICE_REQUEST_NOT_SUPPORTED');
    const headers=new Headers(init.headers);headers.set('apikey',this.config.serviceRoleKey);headers.set('authorization',`Bearer ${this.config.serviceRoleKey}`);if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json');return parseResponse<T>(await fetch(`${this.config.url}${path}`,{...init,headers}),'supabase');
  }
  async rpc<T>(accessToken:string,name:string,body:Record<string,unknown>):Promise<T>{return this.userRest<T>(accessToken,`/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}
  async requireTenantRole(accessToken:string,tenantId:string,roles:string[]=['owner','admin','editor','viewer']):Promise<{userId:string;role:string}>{
    const user=await this.getUser(accessToken);const rows=await this.userRest<Array<{role:string;status:string}>>(accessToken,`/rest/v1/tenant_members?select=role,status&tenant_id=eq.${encodeURIComponent(tenantId)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);const membership=rows[0];if(!membership||membership.status!=='active'||!roles.includes(membership.role))throw new Error('tenant_access_denied');return{userId:user.id,role:membership.role};
  }

  async putBinaryObject(input:{tenantId:string;bucket:string;path:string;bytes:Buffer;mimeType:string;upsert?:boolean}):Promise<void>{
    if(this.config.backend==='supabase'){
      const response=await fetch(`${this.config.url}/storage/v1/object/${encodeURIComponent(input.bucket)}/${input.path.split('/').map(encodeURIComponent).join('/')}`,{method:'POST',headers:{apikey:this.config.serviceRoleKey,authorization:`Bearer ${this.config.serviceRoleKey}`,'content-type':input.mimeType,'x-upsert':String(Boolean(input.upsert))},body:new Blob([new Uint8Array(input.bytes)],{type:input.mimeType})});
      if(!response.ok)throw new Error(`storage_upload_${response.status}:${await response.text()}`);return;
    }
    const digest=createHash('sha256').update(input.bytes).digest('hex');
    const sql=input.upsert
      ? `insert into app_private.binary_objects(tenant_id,bucket,object_path,mime_type,object_bytes,byte_size,content_hash) values($1,$2,$3,$4,$5,$6,$7) on conflict(bucket,object_path) do update set tenant_id=excluded.tenant_id,mime_type=excluded.mime_type,object_bytes=excluded.object_bytes,byte_size=excluded.byte_size,content_hash=excluded.content_hash,updated_at=now()`
      : `insert into app_private.binary_objects(tenant_id,bucket,object_path,mime_type,object_bytes,byte_size,content_hash) values($1,$2,$3,$4,$5,$6,$7)`;
    await this.query(sql,[input.tenantId,input.bucket,input.path,input.mimeType,input.bytes,input.bytes.length,digest]);
  }
  async deleteBinaryObject(bucket:string,path:string):Promise<void>{
    if(this.config.backend==='supabase'){
      const response=await fetch(`${this.config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`,{method:'DELETE',headers:{apikey:this.config.serviceRoleKey,authorization:`Bearer ${this.config.serviceRoleKey}`}});if(!response.ok&&response.status!==404)throw new Error(`storage_delete_${response.status}`);return;
    }
    await this.query('delete from app_private.binary_objects where bucket=$1 and object_path=$2',[bucket,path]);
  }
  async getBinaryObject(bucket:string,path:string):Promise<{tenantId:string;mimeType:string;bytes:Buffer}|null>{
    if(this.config.backend==='supabase')throw new Error('SUPABASE_BINARY_READ_USE_SIGNED_URL');
    const result=await this.query<{tenant_id:string;mime_type:string;object_bytes:Buffer}>('select tenant_id,mime_type,object_bytes from app_private.binary_objects where bucket=$1 and object_path=$2 limit 1',[bucket,path]);
    const row=result[0];return row?{tenantId:row.tenant_id,mimeType:row.mime_type,bytes:Buffer.from(row.object_bytes)}:null;
  }

  private async query<T extends QueryResultRow=QueryResultRow>(sql:string,values:unknown[]=[]):Promise<T[]>{if(!this.pool)throw new Error('neon_database_pool_missing');const result=await this.pool.query<T>(sql,values);return result.rows;}
  private async neonServiceRest<T>(path:string,init:RequestInit):Promise<T>{
    const url=new URL(path,'https://post-automatici.invalid');
    const relation=url.pathname.replace(/^\/rest\/v1\//,'');
    if(relation.startsWith('rpc/'))throw new Error('neon_service_rpc_not_supported');
    const schemaHeader=new Headers(init.headers).get('content-profile')??new Headers(init.headers).get('accept-profile')??'public';
    const schema=safeIdentifier(schemaHeader);const table=safeIdentifier(relation);const method=(init.method??'GET').toUpperCase();const prefer=new Headers(init.headers).get('prefer')??'';
    if(method==='GET'){
      const filters=buildFilters(url.searchParams);const limitRaw=url.searchParams.get('limit');const offsetRaw=url.searchParams.get('offset');
      const limit=limitRaw?` limit ${Math.max(0,Math.min(10000,Number(limitRaw)||0))}`:'';const offset=offsetRaw?` offset ${Math.max(0,Number(offsetRaw)||0)}`:'';
      const rows=await this.query(`select ${selectClause(url.searchParams.get('select'))} from ${schema}.${table}${filters.sql}${orderClause(url.searchParams.get('order'))}${limit}${offset}`,filters.values);return rows as T;
    }
    if(method==='POST'){
      const raw=parseJsonBody(init.body);const list=Array.isArray(raw)?raw:[raw];if(list.length===0)return [] as T;if(!list.every((row)=>row&&typeof row==='object'&&!Array.isArray(row)))throw new Error('service_rest_insert_object_required');
      const rows=list as Array<Record<string,unknown>>;const columns=[...new Set(rows.flatMap((row)=>Object.keys(row)))];if(columns.length===0)throw new Error('service_rest_insert_empty');columns.forEach(safeIdentifier);
      const values:unknown[]=[];const tuples=rows.map((row)=>`(${columns.map((column)=>{values.push(row[column]??null);return `$${values.length}`;}).join(',')})`);
      const conflictRaw=url.searchParams.get('on_conflict');const conflictCols=conflictRaw?.split(',').map((item)=>item.trim()).filter(Boolean)??[];conflictCols.forEach(safeIdentifier);
      let conflict='';
      if(prefer.includes('resolution=ignore-duplicates'))conflict=conflictCols.length?` on conflict (${conflictCols.map(safeIdentifier).join(',')}) do nothing`:' on conflict do nothing';
      else if(prefer.includes('resolution=merge-duplicates')){
        if(conflictCols.length===0)throw new Error('service_rest_merge_requires_on_conflict');const updates=columns.filter((column)=>!conflictCols.includes(column));
        conflict=` on conflict (${conflictCols.map(safeIdentifier).join(',')}) do update set ${updates.length?updates.map((column)=>`${safeIdentifier(column)}=excluded.${safeIdentifier(column)}`).join(','):`${safeIdentifier(conflictCols[0]??'id')}=excluded.${safeIdentifier(conflictCols[0]??'id')}`}`;
      }
      const returning=prefer.includes('return=minimal')?'':' returning *';const result=await this.query(`insert into ${schema}.${table} (${columns.map(safeIdentifier).join(',')}) values ${tuples.join(',')}${conflict}${returning}`,values);return(prefer.includes('return=minimal')?undefined:result) as T;
    }
    if(method==='PATCH'){
      const raw=parseJsonBody(init.body);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('service_rest_patch_object_required');const patch=raw as Record<string,unknown>;const columns=Object.keys(patch);if(columns.length===0)return [] as T;
      const values:unknown[]=[];const sets=columns.map((column)=>{safeIdentifier(column);values.push(patch[column]);return `${safeIdentifier(column)}=$${values.length}`;});const filters=buildFilters(url.searchParams,values.length+1);values.push(...filters.values);
      const returning=prefer.includes('return=minimal')?'':' returning *';const result=await this.query(`update ${schema}.${table} set ${sets.join(',')}${filters.sql}${returning}`,values);return(prefer.includes('return=minimal')?undefined:result) as T;
    }
    if(method==='DELETE'){
      const filters=buildFilters(url.searchParams);const returning=prefer.includes('return=minimal')?'':' returning *';const result=await this.query(`delete from ${schema}.${table}${filters.sql}${returning}`,filters.values);return(prefer.includes('return=minimal')?undefined:result) as T;
    }
    throw new Error(`service_rest_method_not_supported:${method}`);
  }
  private async supabaseRest<T>(path:string,bearer:string,apikey:string,init:RequestInit):Promise<T>{
    if(path==='/rest/v1/rpc/is_platform_admin')return [] as T;
    let resolvedPath=path;const headers=new Headers(init.headers);
    if(path.startsWith('/rest/v1/platform_admins')){resolvedPath=path.replace('/rest/v1/platform_admins','/rest/v1/platform_admins_local');headers.delete('accept-profile');headers.delete('content-profile')}
    headers.set('apikey',apikey);headers.set('authorization',`Bearer ${bearer}`);if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json');if(init.method&&['POST','PATCH','PUT','DELETE'].includes(init.method.toUpperCase())&&!headers.has('prefer'))headers.set('prefer','return=representation');const response=await fetch(`${this.config.url}${resolvedPath}`,{...init,headers});return parseResponse<T>(response,'supabase');
  }
}
export const jsonBody=(value:unknown):string=>JSON.stringify(value);
