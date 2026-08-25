import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);
const one=<T>(rows:T[],code='row_not_found'):T=>{const row=rows[0];if(!row)throw new Error(code);return row};
const now=()=>new Date().toISOString();
const overrideKeys=new Set(['posts_per_week','monthly_post_limit','platforms','auto_publish_allowed','website_page_limit','ai_budget_cents','storage_mb','team_members','analytics_level','competitor_refresh_frequency']);

export class AdminCustomerService {
  constructor(private readonly db=new LocalSupabaseClient()){}

  private async requireAdmin(token:string){
    const user=await this.db.getUser(token);
    const rows=await this.db.serviceRest<Array<{user_id:string}>>(`/rest/v1/platform_admins?select=user_id&user_id=eq.${q(user.id)}&limit=1`,{headers:{'accept-profile':'app_private'}});
    if(!rows.some((row)=>row.user_id===user.id))throw new Error('platform_admin_required');
    return user;
  }

  private async audit(actorId:string,tenantId:string|null,action:string,entityType:string,entityId:string|null,metadata:Record<string,unknown>={}){
    await this.db.serviceRest('/rest/v1/audit_logs',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:tenantId,actor_user_id:actorId,actor_type:'admin',action,entity_type:entityType,entity_id:entityId,metadata})});
  }

  async snapshot(token:string){
    await this.requireAdmin(token);
    const [auth,tenants,members,plans,subscriptions,overrides,usage,aiUsage,aiBudgets,jobs,connections,audit,deletions]=await Promise.all([
      this.db.serviceAuth<{users:Array<Record<string,unknown>>}>('/admin/users?page=1&per_page=100').catch(()=>({users:[]})),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/tenants?select=id,name,slug,status,onboarding_status,created_by,created_at&order=created_at.desc'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/tenant_members?select=tenant_id,user_id,role,status,created_at'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/plans?select=id,code,name,status,posts_per_week,monthly_post_limit,platforms,ai_budget_cents,storage_mb,team_members&order=created_at.asc'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/subscriptions?select=*&order=created_at.desc'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/tenant_plan_overrides?select=*'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/tenant_usage_counters?select=*&order=period_start.desc'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/ai_usage_events?select=*&order=created_at.desc&limit=500'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/tenant_ai_budgets?select=*'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/publication_jobs?select=*&order=scheduled_at.desc&limit=500'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/social_connections?select=*&order=updated_at.desc'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/audit_logs?select=*&order=created_at.desc&limit=200'),
      this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/account_deletion_requests?select=*&order=requested_at.desc'),
    ]);
    return{users:auth.users,tenants,members,plans,subscriptions,overrides,usage,aiUsage,aiBudgets,jobs,connections,audit,deletions};
  }

  async assignManualPlan(token:string,tenantId:string,input:{planCode:string}){
    const admin=await this.requireAdmin(token);
    const plan=one(await this.db.serviceRest<Array<{id:string;code:string}>>(`/rest/v1/plans?select=id,code&code=eq.${q(input.planCode)}&status=eq.active&limit=1`),'plan_not_found');
    await this.db.serviceRest(`/rest/v1/subscriptions?tenant_id=eq.${q(tenantId)}&provider=eq.manual&status=in.(active,trialing)`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'canceled',current_period_end:now()})});
    const rows=await this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/subscriptions',{method:'POST',body:jsonBody({tenant_id:tenantId,plan_id:plan.id,provider:'manual',status:'active',current_period_start:now()})});
    await this.audit(admin.id,tenantId,'admin.plan.assign','subscription',String((rows[0] as any)?.id??''),{planCode:plan.code,provider:'manual'});
    return one(rows);
  }

  async setOverrides(token:string,tenantId:string,input:{overrides:Record<string,unknown>;reason?:string;expiresAt?:string|null}){
    const admin=await this.requireAdmin(token);const clean:Record<string,unknown>={};
    for(const [key,value]of Object.entries(input.overrides??{}))if(overrideKeys.has(key))clean[key]=value;
    const rows=await this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/tenant_plan_overrides?on_conflict=tenant_id',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=representation'},body:jsonBody({tenant_id:tenantId,overrides:clean,reason:input.reason??'Manual admin override',expires_at:input.expiresAt??null,updated_by:admin.id,updated_at:now()})});
    await this.audit(admin.id,tenantId,'admin.plan.override','tenant',tenantId,{keys:Object.keys(clean)});return one(rows);
  }

  async setStatus(token:string,tenantId:string,status:'active'|'suspended'|'closed'){
    const admin=await this.requireAdmin(token);const rows=await this.db.serviceRest<Array<Record<string,unknown>>>(`/rest/v1/tenants?id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({status})});
    await this.audit(admin.id,tenantId,`admin.tenant.${status}`,'tenant',tenantId);return one(rows);
  }

  async setTenantAiBudget(token:string,tenantId:string,input:{currency?:'USD'|'EUR';softLimitMicrounits:number;hardLimitMicrounits:number;enabled:boolean}){
    const admin=await this.requireAdmin(token);if(input.softLimitMicrounits<0||input.hardLimitMicrounits<0||input.softLimitMicrounits>input.hardLimitMicrounits)throw new Error('invalid_ai_budget');
    const rows=await this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/tenant_ai_budgets?on_conflict=tenant_id',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=representation'},body:jsonBody({tenant_id:tenantId,currency:input.currency??'USD',soft_limit_microunits:input.softLimitMicrounits,hard_limit_microunits:input.hardLimitMicrounits,enabled:input.enabled,updated_by:admin.id,updated_at:now()})});
    await this.audit(admin.id,tenantId,'admin.ai_budget.update','tenant',tenantId,{soft:input.softLimitMicrounits,hard:input.hardLimitMicrounits,enabled:input.enabled});return one(rows);
  }

  async setGlobalAiBudget(token:string,input:{currency?:'USD'|'EUR';softLimitMicrounits:number;hardLimitMicrounits:number;enabled:boolean}){
    const admin=await this.requireAdmin(token);if(input.softLimitMicrounits<0||input.hardLimitMicrounits<0||input.softLimitMicrounits>input.hardLimitMicrounits)throw new Error('invalid_ai_budget');
    const rows=await this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/global_ai_budget?on_conflict=singleton',{method:'POST',headers:{'content-profile':'app_private','accept-profile':'app_private',prefer:'resolution=merge-duplicates,return=representation'},body:jsonBody({singleton:true,currency:input.currency??'USD',soft_limit_microunits:input.softLimitMicrounits,hard_limit_microunits:input.hardLimitMicrounits,enabled:input.enabled,updated_by:admin.id,updated_at:now()})});return one(rows);
  }

  async requestDeletion(token:string,tenantId:string|null,scope:'ACCOUNT'|'TENANT',reason=''){
    const user=await this.db.getUser(token);if(tenantId)await this.db.requireTenantRole(token,tenantId,['owner','admin']);
    const rows=await this.db.userRest<Array<Record<string,unknown>>>(token,'/rest/v1/account_deletion_requests',{method:'POST',body:jsonBody({requesting_user_id:user.id,tenant_id:tenantId,scope,reason})});return one(rows);
  }

  async revokeTenantConnections(token:string,tenantId:string){
    const actor=await this.db.requireTenantRole(token,tenantId,['owner','admin']);
    await Promise.all([
      this.db.serviceRest(`/rest/v1/social_connections?tenant_id=eq.${q(tenantId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({connection_status:'disabled',granted_scopes:[],token_expires_at:null})}),
      this.db.serviceRest(`/rest/v1/telegram_connections?tenant_id=eq.${q(tenantId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'disabled',telegram_chat_id:null,telegram_user_id:null})}),
    ]);
    await this.db.serviceRest('/rest/v1/audit_logs',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:tenantId,actor_user_id:actor.userId,actor_type:'user',action:'connections.revoke_all',entity_type:'tenant',entity_id:tenantId})});return{ok:true};
  }

  async executeDeletion(token:string,requestId:string){
    const admin=await this.requireAdmin(token);const request=one(await this.db.serviceRest<Array<any>>(`/rest/v1/account_deletion_requests?select=*&id=eq.${q(requestId)}&limit=1`),'deletion_request_not_found');
    if(request.status!=='REQUESTED'&&request.status!=='APPROVED')throw new Error('deletion_request_not_executable');
    await this.db.serviceRest(`/rest/v1/account_deletion_requests?id=eq.${q(requestId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'PROCESSING',processed_by:admin.id})});
    if(request.scope==='TENANT'&&request.tenant_id){
      const assets=await this.db.serviceRest<Array<{storage_bucket:string;storage_path:string}>>(`/rest/v1/brand_assets?select=storage_bucket,storage_path&tenant_id=eq.${q(request.tenant_id)}`);
      for(const asset of assets){await this.db.serviceStorage(`/object/${encodeURIComponent(asset.storage_bucket)}/${asset.storage_path.split('/').map(encodeURIComponent).join('/')}`,{method:'DELETE'}).catch(()=>undefined);}
      await this.db.serviceRest('/rest/v1/account_lifecycle_audit',{method:'POST',headers:{'content-profile':'app_private',prefer:'return=minimal'},body:jsonBody({actor_user_id:admin.id,target_user_id:request.requesting_user_id,tenant_id_snapshot:request.tenant_id,action:'tenant.delete',metadata:{requestId}})});
      await this.db.serviceRest(`/rest/v1/tenants?id=eq.${q(request.tenant_id)}`,{method:'DELETE',headers:{prefer:'return=minimal'}});return{ok:true,scope:'TENANT'};
    }
    if(request.scope==='ACCOUNT'){
      const memberships=await this.db.serviceRest<Array<{tenant_id:string;role:string;status:string}>>(`/rest/v1/tenant_members?select=tenant_id,role,status&user_id=eq.${q(request.requesting_user_id)}&status=eq.active`);
      if(memberships.some((item)=>item.role==='owner'))throw new Error('account_owns_active_tenant');
      await this.db.serviceRest('/rest/v1/account_lifecycle_audit',{method:'POST',headers:{'content-profile':'app_private',prefer:'return=minimal'},body:jsonBody({actor_user_id:admin.id,target_user_id:request.requesting_user_id,tenant_id_snapshot:null,action:'account.delete',metadata:{requestId}})});
      await this.db.serviceAuth(`/admin/users/${request.requesting_user_id}`,{method:'DELETE'});return{ok:true,scope:'ACCOUNT'};
    }
    throw new Error('invalid_deletion_scope');
  }
}