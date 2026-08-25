import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);

export interface StrategyPreferencesInput {
  objectives?:string[];
  audience?:Record<string,unknown>;
  contentMix?:Record<string,unknown>;
  platformStrategy?:Record<string,unknown>;
  schedulingPreferences?:Record<string,unknown>;
}

export class StrategyPreferencesService {
  constructor(private readonly db=new LocalSupabaseClient()){}

  async save(token:string,tenantId:string,input:StrategyPreferencesInput){
    const actor=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const current=(await this.db.userRest<Array<any>>(token,`/rest/v1/content_strategies?select=*&tenant_id=eq.${q(tenantId)}&order=version.desc&limit=1`))[0];
    const payload={
      objectives:Array.isArray(input.objectives)?input.objectives:(current?.objectives??[]),
      audience:input.audience&&typeof input.audience==='object'?input.audience:(current?.audience??{}),
      content_mix:input.contentMix&&typeof input.contentMix==='object'?input.contentMix:(current?.content_mix??{}),
      platform_strategy:input.platformStrategy&&typeof input.platformStrategy==='object'?input.platformStrategy:(current?.platform_strategy??{}),
      scheduling_preferences:input.schedulingPreferences&&typeof input.schedulingPreferences==='object'?input.schedulingPreferences:(current?.scheduling_preferences??{}),
      status:'confirmed',
      updated_at:new Date().toISOString(),
    };
    let rows:Array<Record<string,unknown>>;
    if(current){
      rows=await this.db.serviceRest<Array<Record<string,unknown>>>(`/rest/v1/content_strategies?id=eq.${q(String(current.id))}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody(payload)});
    }else{
      rows=await this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/content_strategies',{method:'POST',body:jsonBody({tenant_id:tenantId,version:1,...payload})});
    }
    const saved=rows[0];if(!saved)throw new Error('strategy_save_failed');
    await this.db.serviceRest('/rest/v1/audit_logs',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:tenantId,actor_user_id:actor.userId,actor_type:'user',action:'strategy.manual_update',entity_type:'content_strategy',entity_id:String(saved.id),metadata:{source:'manual'}})}).catch(()=>undefined);
    return saved;
  }
}
