import { ProductionAIWorkflowService } from './production-ai-workflow-service.js';

/**
 * Vercel Hobby functions have a short request lifetime. Keep one external AI unit per HTTP request:
 * text generation first, then visual generation through /variants/:id/visual.
 */
export class VercelSafeProductionAIWorkflowService extends ProductionAIWorkflowService {
  private deferVisuals=false;

  override async generatePost(token:string,tenantId:string,postId:string){
    this.deferVisuals=true;
    try{return await super.generatePost(token,tenantId,postId);}
    finally{this.deferVisuals=false;}
  }

  override async generateAllDrafts(token:string,tenantId:string,limit=20){
    // Server-side batching is intentionally bounded. The web client owns the long queue,
    // so every AI call gets a fresh serverless execution window.
    return super.generateAllDrafts(token,tenantId,Math.min(Math.max(1,limit),1));
  }

  override async generateVisualForVariant(token:string,tenantId:string,variantId:string){
    if(this.deferVisuals)return{deferred:true,variantId,status:'awaiting_visual_generation'};
    return super.generateVisualForVariant(token,tenantId,variantId);
  }
}
