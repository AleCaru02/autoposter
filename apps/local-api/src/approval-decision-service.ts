import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);
const now=()=>new Date().toISOString();

interface VariantRow {
  id:string;
  tenant_id:string;
  post_id:string;
  platform:string;
  platform_decision:string;
  approval_mode:'auto'|'manual';
  approval_status:'not_required'|'pending'|'approved'|'rejected';
  status:string;
  scheduled_at:string|null;
}

export class ApprovalDecisionService {
  constructor(private readonly db=new LocalSupabaseClient()){}

  async approveWeb(token:string,tenantId:string,variantId:string){
    const actor=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const variant=await this.variant(tenantId,variantId);
    if(variant.platform_decision==='skip')throw new Error('variant_skipped');
    if(variant.approval_status==='rejected')throw new Error('variant_rejected');
    const existing=await this.db.serviceRest<Array<{id:string}>>(`/rest/v1/post_approvals?select=id&tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&source=eq.web&limit=1`);
    if(!existing[0])await this.db.serviceRest('/rest/v1/post_approvals',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,approved_by:actor.userId,source:'web'})});
    await this.db.serviceRest(`/rest/v1/post_variants?id=eq.${q(variantId)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({approval_status:'approved',status:'approved'})});
    await this.db.serviceRest('/rest/v1/feedback_events',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,event_type:'approved',created_by:actor.userId})}).catch(()=>undefined);
    if(variant.approval_mode==='auto')await this.queueApprovedVariant(tenantId,variantId);
    await this.reconcilePost(variant.post_id,tenantId);
    return {ok:true,approvalStatus:'approved',delivery:variant.approval_mode==='auto'?'scheduled_after_approval':'manual_after_approval'};
  }

  async rejectWeb(token:string,tenantId:string,variantId:string,reason='Non pubblicare'){
    const actor=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const variant=await this.variant(tenantId,variantId);
    if(variant.platform_decision==='skip')throw new Error('variant_skipped');
    await this.db.serviceRest('/rest/v1/post_rejections',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,rejected_by:actor.userId,reason,source:'web'})});
    await this.db.serviceRest(`/rest/v1/post_variants?id=eq.${q(variantId)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({approval_status:'rejected',status:'rejected'})});
    await this.reconcilePost(variant.post_id,tenantId);
    return {ok:true,approvalStatus:'rejected'};
  }

  async publishApprovedWeb(token:string,tenantId:string,variantId:string){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const result=await this.queueApprovedVariant(tenantId,variantId,true);
    return {ok:true,...result};
  }

  private async queueApprovedVariant(tenantId:string,variantId:string,forceNow=false){
    const variant=await this.variant(tenantId,variantId);
    if(variant.approval_status!=='approved')throw new Error('HUMAN_APPROVAL_REQUIRED');
    const approval=await this.db.serviceRest<Array<{id:string}>>(`/rest/v1/post_approvals?select=id&tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&source=in.(web,telegram)&limit=1`);
    if(!approval[0])throw new Error('HUMAN_APPROVAL_REQUIRED');
    const scheduledAt=forceNow?now():(variant.scheduled_at??now());
    await this.db.serviceRest('/rest/v1/publication_jobs?on_conflict=tenant_id,idempotency_key',{method:'POST',headers:{prefer:'resolution=ignore-duplicates,return=minimal'},body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,platform:variant.platform,scheduled_at:scheduledAt,idempotency_key:`${tenantId}:${variantId}:v1`,status:'queued',max_attempts:3})});
    await this.db.serviceRest(`/rest/v1/post_variants?id=eq.${q(variantId)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:'scheduled'})});
    await this.reconcilePost(variant.post_id,tenantId);
    return {status:'scheduled',scheduledAt};
  }

  private async variant(tenantId:string,variantId:string){
    const rows=await this.db.serviceRest<VariantRow[]>(`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(variantId)}&limit=1`);
    const row=rows[0];if(!row)throw new Error('variant_not_found');return row;
  }

  private async reconcilePost(postId:string,tenantId:string){
    const variants=await this.db.serviceRest<VariantRow[]>(`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&post_id=eq.${q(postId)}`);
    const active=variants.filter((item)=>item.platform_decision!=='skip');
    const pending=active.some((item)=>!['approved','rejected'].includes(item.approval_status));
    const approved=active.filter((item)=>item.approval_status==='approved');
    const scheduled=approved.some((item)=>item.status==='scheduled'||item.status==='publishing'||item.status==='published');
    const next=pending?'awaiting_approval':approved.length===0?'rejected':scheduled?'scheduled':'approved';
    await this.db.serviceRest(`/rest/v1/posts?id=eq.${q(postId)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',headers:{prefer:'return=minimal'},body:jsonBody({status:next})});
  }
}
