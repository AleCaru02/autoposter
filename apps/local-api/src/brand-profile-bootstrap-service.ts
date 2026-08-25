import { LocalSupabaseClient, jsonBody } from './db.js';

const q=(value:string)=>encodeURIComponent(value);

export class BrandProfileBootstrapService {
  constructor(private readonly db=new LocalSupabaseClient()){}

  async ensureManualProfile(token:string,tenantId:string,input:Record<string,unknown>={}){
    const actor=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const existing=await this.db.userRest<Array<Record<string,unknown>>>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`);
    if(existing[0])return existing[0];
    const sessions=await this.db.userRest<Array<any>>(token,`/rest/v1/onboarding_sessions?select=business,goals,target&tenant_id=eq.${q(tenantId)}&limit=1`);
    const onboarding=sessions[0]??{};
    const business=onboarding.business??{};
    const target=Array.isArray(onboarding.target?.manual)?onboarding.target.manual:[];
    const services=String(business.services??'').split(',').map((item)=>item.trim()).filter(Boolean);
    const differentiators=String(business.differentiator??'').split(',').map((item)=>item.trim()).filter(Boolean);
    const rows=await this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/brand_profiles',{method:'POST',body:jsonBody({
      tenant_id:tenantId,
      status:'draft',
      brand_name:String(input.brand_name??business.name??''),
      description:String(input.description??''),
      industry:String(input.industry??business.industry??''),
      sub_industry:String(input.sub_industry??business.subIndustry??''),
      location:{city:String(business.location??''),serviceArea:String(business.serviceArea??''),language:String(business.language??'it')},
      target:Array.isArray(input.target)?input.target:target,
      services:Array.isArray(input.services)?input.services:services,
      products:Array.isArray(input.products)?input.products:[],
      differentiators:Array.isArray(input.differentiators)?input.differentiators:differentiators,
      usp:String(input.usp??''),
      value_propositions:Array.isArray(input.value_propositions)?input.value_propositions:[],
      brand_colors:Array.isArray(input.brand_colors)?input.brand_colors:[],
      fonts:Array.isArray(input.fonts)?input.fonts:[],
      visual_style:input.visual_style&&typeof input.visual_style==='object'?input.visual_style:{},
      tone_of_voice:input.tone_of_voice&&typeof input.tone_of_voice==='object'?input.tone_of_voice:{},
      vocabulary:Array.isArray(input.vocabulary)?input.vocabulary:[],
      banned_words:Array.isArray(input.banned_words)?input.banned_words:[],
      cta_preferences:Array.isArray(input.cta_preferences)?input.cta_preferences:[],
      topics:Array.isArray(input.topics)?input.topics:[],
      goals:Array.isArray(onboarding.goals)?onboarding.goals:[],
      source_summary:{source:'manual',createdBy:actor.userId},
      version:1,
    })});
    const profile=rows[0];if(!profile)throw new Error('brand_profile_create_failed');
    await this.db.serviceRest('/rest/v1/brand_profile_versions',{method:'POST',headers:{prefer:'return=minimal'},body:jsonBody({tenant_id:tenantId,brand_profile_id:profile.id,version:1,snapshot:profile,source_summary:{source:'manual'},created_by:actor.userId})}).catch(()=>undefined);
    return profile;
  }
}
