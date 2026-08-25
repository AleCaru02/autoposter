import { LocalSupabaseClient, jsonBody } from './db.js';
import { ProductionAIWorkflowService } from './production-ai-workflow-service.js';

const q=(value:string)=>encodeURIComponent(value);
const now=()=>new Date().toISOString();
const first=<T>(rows:T[],message='row_not_found'):T=>{const row=rows[0];if(!row)throw new Error(message);return row;};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const list=(value:unknown):string[]=>{
  if(Array.isArray(value))return value.map(String).map((item)=>item.trim()).filter(Boolean);
  if(typeof value==='string')return value.split(',').map((item)=>item.trim()).filter(Boolean);
  return[];
};
const text=(value:unknown):string=>typeof value==='string'?value.trim():'';
const compact=(input:Record<string,string>)=>Object.fromEntries(Object.entries(input).filter(([,value])=>Boolean(value)));

interface OnboardingRow{business?:unknown;goals?:unknown;target?:unknown;}
interface BrandRow{id:string;tenant_id:string;status:string;version:number;}

export class PersonalOnboardingCompletionService{
  constructor(private readonly db=new LocalSupabaseClient(),private readonly ai=new ProductionAIWorkflowService(db)){}

  async complete(token:string,tenantId:string){
    const actor=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const onboarding=first(await this.db.userRest<OnboardingRow[]>(token,`/rest/v1/onboarding_sessions?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),'onboarding_missing');
    let brand=(await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?select=id,tenant_id,status,version&tenant_id=eq.${q(tenantId)}&limit=1`))[0];
    if(!brand)brand=await this.createManualBrand(token,tenantId,actor.userId,onboarding);

    const confirmedAt=now();
    if(brand.status!=='confirmed'){
      const rows=await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?id=eq.${q(brand.id)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({status:'confirmed',confirmed_at:confirmedAt})});
      brand=first(rows,'brand_profile_missing');
      await this.db.userRest(token,`/rest/v1/brand_profile_versions?brand_profile_id=eq.${q(brand.id)}&version=eq.${brand.version}`,{method:'PATCH',body:jsonBody({status:'confirmed',confirmed_at:confirmedAt})});
    }

    await this.db.userRest(token,`/rest/v1/onboarding_sessions?tenant_id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({current_step:'completed',completed_at:confirmedAt})});
    await this.db.userRest(token,`/rest/v1/tenants?id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({onboarding_status:'completed'})});

    const readiness=this.ai.readiness();
    if(!readiness.configured)return{completed:true,brandId:brand.id,strategyGenerated:false,openaiConfigured:false,reason:'OPENAI_NOT_CONFIGURED'};
    try{
      const strategy=await this.ai.generateStrategy(token,tenantId);
      return{completed:true,brandId:brand.id,strategyGenerated:true,openaiConfigured:true,strategy};
    }catch{
      return{completed:true,brandId:brand.id,strategyGenerated:false,openaiConfigured:true,reason:'OPENAI_STRATEGY_GENERATION_FAILED'};
    }
  }

  private async createManualBrand(token:string,tenantId:string,userId:string,onboarding:OnboardingRow):Promise<BrandRow>{
    const business=object(onboarding.business);
    const target=object(onboarding.target);
    const brandName=text(business.name);
    if(!brandName)throw new Error('brand_name_required');
    const location=compact({city:text(business.location),serviceArea:text(business.serviceArea)});
    const website=text(business.website);
    const visualStyle=text(business.visualStyle);
    const toneOfVoice=text(business.toneOfVoice);
    const differentiator=text(business.differentiator);
    const snapshot={
      brand_name:brandName,
      description:text(business.description),
      industry:text(business.industry),
      sub_industry:text(business.subIndustry),
      location,
      target:list(target.manual),
      personas:list(target.personas),
      services:list(business.services),
      products:list(business.products),
      differentiators:differentiator?[differentiator]:[],
      usp:text(business.usp),
      value_propositions:list(business.valuePropositions),
      brand_colors:list(business.colors),
      fonts:list(business.fonts),
      visual_style:visualStyle?{description:visualStyle}:{},
      tone_of_voice:toneOfVoice?{description:toneOfVoice}:{},
      vocabulary:list(business.preferredWords),
      banned_words:list(business.bannedWords),
      cta_preferences:list(business.ctas),
      claims_allowed:list(business.claimsAllowed),
      claims_forbidden:list(business.claimsForbidden),
      topics:list(business.topics),
      urls:website?[website]:[],
      social_links:list(business.socialLinks),
      competitors:list(business.competitors),
      goals:list(onboarding.goals),
      source_summary:{source:'onboarding_manual',ai:false,createdAt:now()},
    };
    const created=first(await this.db.userRest<Array<BrandRow&Record<string,unknown>>>(token,'/rest/v1/brand_profiles',{method:'POST',body:jsonBody({tenant_id:tenantId,status:'confirmed',version:1,confirmed_at:now(),...snapshot})}),'brand_profile_create_failed');
    await this.db.userRest(token,'/rest/v1/brand_profile_versions',{method:'POST',body:jsonBody({tenant_id:tenantId,brand_profile_id:created.id,version:1,status:'confirmed',snapshot,source_summary:snapshot.source_summary,created_by:userId,confirmed_at:now()})});
    return created;
  }
}
