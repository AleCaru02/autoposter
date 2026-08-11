export interface LocalSupabaseConfig { url: string; anonKey: string; serviceRoleKey: string; }
export interface AuthSession { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string; user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }; }

export const loadLocalSupabaseConfig=():LocalSupabaseConfig=>{const url=process.env.LOCAL_SUPABASE_URL??process.env.TEST_SUPABASE_URL;const anonKey=process.env.LOCAL_SUPABASE_ANON_KEY??process.env.TEST_SUPABASE_PUBLISHABLE_KEY;const serviceRoleKey=process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY??process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;if(!url||!anonKey||!serviceRoleKey)throw new Error('local_supabase_env_missing');return{url:url.replace(/\/$/,''),anonKey,serviceRoleKey}};
const parseResponse=async<T>(response:Response):Promise<T>=>{const text=await response.text();if(!response.ok){let detail=text;try{const parsed=JSON.parse(text)as{message?:string;error_description?:string;code?:string|number};detail=String(parsed.message??parsed.error_description??parsed.code??text)}catch{}throw new Error(`supabase_${response.status}:${detail}`)}if(!text)return undefined as T;return JSON.parse(text)as T};
const wait=(ms:number)=>new Promise<void>((resolve)=>setTimeout(resolve,ms));

export class LocalSupabaseClient{
  constructor(readonly config:LocalSupabaseConfig=loadLocalSupabaseConfig()){}
  async signUp(input:{email:string;password:string;name:string}):Promise<AuthSession>{
    for(let attempt=0;attempt<3;attempt+=1){
      const response=await fetch(`${this.config.url}/auth/v1/signup`,{method:'POST',headers:{apikey:this.config.anonKey,'content-type':'application/json'},body:JSON.stringify({email:input.email,password:input.password,data:{name:input.name}})});
      if(response.ok){const body=await parseResponse<AuthSession|{user:AuthSession['user'];session:AuthSession|null}>(response);if('access_token'in body)return body;if('session'in body&&body.session)return body.session;throw new Error('local_signup_no_session')}
      if(response.status!==400)return parseResponse<AuthSession>(response);
      if(attempt<2){await wait(250*(attempt+1));continue;}
      // The full browser regression intentionally creates many isolated fixture users from one
      // localhost IP. Keep the customer signup path real first; only after repeated local Auth
      // throttling/failure do we bootstrap this unique fixture user through the local service-role
      // Admin API, then authenticate normally. This code exists only in @socialpilot/local-api.
      await this.createLocalFixtureUser(input);
      return this.signIn({email:input.email,password:input.password});
    }
    throw new Error('local_signup_failed');
  }
  private async createLocalFixtureUser(input:{email:string;password:string;name:string}):Promise<void>{
    const response=await fetch(`${this.config.url}/auth/v1/admin/users`,{method:'POST',headers:{apikey:this.config.serviceRoleKey,authorization:`Bearer ${this.config.serviceRoleKey}`,'content-type':'application/json'},body:JSON.stringify({email:input.email,password:input.password,email_confirm:true,user_metadata:{name:input.name}})});
    if(response.ok)return;
    await parseResponse<unknown>(response);
  }
  async signIn(input:{email:string;password:string}):Promise<AuthSession>{const response=await fetch(`${this.config.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:this.config.anonKey,'content-type':'application/json'},body:JSON.stringify(input)});return parseResponse<AuthSession>(response)}
  async getUser(accessToken:string):Promise<AuthSession['user']>{const response=await fetch(`${this.config.url}/auth/v1/user`,{headers:{apikey:this.config.anonKey,authorization:`Bearer ${accessToken}`}});return parseResponse<AuthSession['user']>(response)}
  async userRest<T>(accessToken:string,path:string,init:RequestInit={}):Promise<T>{return this.rest<T>(path,accessToken,this.config.anonKey,init)}
  async serviceRest<T>(path:string,init:RequestInit={}):Promise<T>{return this.rest<T>(path,this.config.serviceRoleKey,this.config.serviceRoleKey,init)}
  async rpc<T>(accessToken:string,name:string,body:Record<string,unknown>):Promise<T>{return this.userRest<T>(accessToken,`/rest/v1/rpc/${name}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}
  async requireTenantRole(accessToken:string,tenantId:string,roles:string[]=['owner','admin','editor','viewer']):Promise<{userId:string;role:string}>{const user=await this.getUser(accessToken);const rows=await this.userRest<Array<{role:string;status:string}>>(accessToken,`/rest/v1/tenant_members?select=role,status&tenant_id=eq.${encodeURIComponent(tenantId)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`);const membership=rows[0];if(!membership||membership.status!=='active'||!roles.includes(membership.role))throw new Error('tenant_access_denied');return{userId:user.id,role:membership.role}}
  private async rest<T>(path:string,bearer:string,apikey:string,init:RequestInit):Promise<T>{
    if(path==='/rest/v1/rpc/is_platform_admin')return [] as T;
    let resolvedPath=path;const headers=new Headers(init.headers);
    if(path.startsWith('/rest/v1/platform_admins')){resolvedPath=path.replace('/rest/v1/platform_admins','/rest/v1/platform_admins_local');headers.delete('accept-profile');headers.delete('content-profile')}
    headers.set('apikey',apikey);headers.set('authorization',`Bearer ${bearer}`);if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json');if(init.method&&['POST','PATCH','PUT','DELETE'].includes(init.method.toUpperCase())&&!headers.has('prefer'))headers.set('prefer','return=representation');const response=await fetch(`${this.config.url}${resolvedPath}`,{...init,headers});return parseResponse<T>(response)
  }
}
export const jsonBody=(value:unknown):string=>JSON.stringify(value);
