import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);

interface VariantRow {
  id:string;
  tenant_id:string;
  post_id:string;
  platform_decision:string;
  approval_status:string;
  status:string;
  scheduled_at:string|null;
}

export class ContentScheduleService {
  constructor(private readonly db=new LocalSupabaseClient()){}

  async rescheduleVariant(token:string,tenantId:string,variantId:string,scheduledAt:string){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const date=new Date(scheduledAt);
    if(!scheduledAt||Number.isNaN(date.getTime()))throw new Error('invalid_scheduled_at');
    const variants=await this.db.userRest<VariantRow[]>(token,`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(variantId)}&limit=1`);
    const variant=variants[0];if(!variant)throw new Error('variant_not_found');
    if(variant.platform_decision==='skip')throw new Error('variant_skipped');
    if(['publishing','published'].includes(variant.status))throw new Error('published_schedule_locked');
    const iso=date.toISOString();
    await this.db.userRest(token,`/rest/v1/post_variants?id=eq.${q(variantId)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({scheduled_at:iso})});

    if(variant.approval_status==='approved'){
      await this.db.serviceRest(`/rest/v1/publication_jobs?tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&status=in.(queued,retry_wait)`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({scheduled_at:iso,next_attempt_at:null})});
    }

    const siblings=await this.db.userRest<VariantRow[]>(token,`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&post_id=eq.${q(variant.post_id)}&platform_decision=neq.skip`);
    const times=siblings.map((item)=>item.id===variantId?iso:item.scheduled_at).filter((value):value is string=>Boolean(value)).sort();
    if(times[0])await this.db.userRest(token,`/rest/v1/posts?id=eq.${q(variant.post_id)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({planned_at:times[0]})});
    return {ok:true,variantId,scheduledAt:iso,approvalStatus:variant.approval_status};
  }
}
