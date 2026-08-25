import { createHash, randomUUID } from 'node:crypto';
import { LocalSupabaseClient, jsonBody } from './db.js';
import { OpenAIProductionClient, OPENAI_IMAGE_MODEL } from './openai-production-client.js';

const q=(value:string)=>encodeURIComponent(value);
const now=()=>new Date().toISOString();
const first=<T>(rows:T[],message='row_not_found'):T=>{const row=rows[0];if(!row)throw new Error(message);return row;};
const asObject=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const asStrings=(value:unknown):string[]=>Array.isArray(value)?value.map(String).map((item)=>item.trim()).filter(Boolean):[];
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
const platformKeys=['instagram','facebook','linkedin','google_business_profile'] as const;
type Platform=typeof platformKeys[number];
const isPlatform=(value:unknown):value is Platform=>platformKeys.includes(value as Platform);
const safeFormat=(value:unknown):'post'|'carousel'|'story'=>value==='carousel'?'carousel':value==='story'?'story':'post';
const pathEncode=(value:string)=>value.split('/').map(encodeURIComponent).join('/');

interface BrandRow {id:string;tenant_id:string;status:string;version:number;brand_name?:string|null;description?:string|null;industry?:string|null;sub_industry?:string|null;location?:unknown;target?:unknown;personas?:unknown;services?:unknown;products?:unknown;differentiators?:unknown;usp?:string|null;value_propositions?:unknown;brand_colors?:unknown;fonts?:unknown;visual_style?:unknown;tone_of_voice?:unknown;vocabulary?:unknown;banned_words?:unknown;cta_preferences?:unknown;claims_allowed?:unknown;claims_forbidden?:unknown;topics?:unknown;goals?:unknown;source_summary?:unknown;}
interface PostRow {id:string;tenant_id:string;pillar_id?:string|null;topic:string;objective?:string|null;status:string;planned_at?:string|null;format?:string|null;generation_version:number;}
interface VariantRow {id:string;tenant_id:string;post_id:string;platform:Platform;platform_decision:string;format?:string|null;visual_brief?:Record<string,any>;}

interface BrandAI {
  brandName:string;description:string;industry:string;subIndustry:string;location:{city?:string;serviceArea?:string};target:string[];personas:string[];services:string[];products:string[];differentiators:string[];usp:string;valuePropositions:string[];brandColors:string[];fonts:string[];visualStyle:{description:string};toneOfVoice:{description:string};vocabulary:string[];bannedWords:string[];ctaPreferences:string[];claimsAllowed:string[];claimsForbidden:string[];topics:string[];goals:string[];
}
interface StrategyAI {
  objectives:string[];audience:string[];pillars:Array<{name:string;description:string;share:number;objective?:string}>;platformStrategy:Record<string,unknown>;scheduling:{postsPerWeek:number;preferredDays:number[];preferredTimes:string[]};ctaStrategy:string[];avoidThemes:string[];
}
interface CalendarAI {items:Array<{scheduledAt:string;platform:string;format:string;pillarName:string;topic:string;objective:string}>;}
interface PostAI {coreConcept:{angle:string;message:string;objective:string};factConfidence?:number;variants:Array<{platform:string;decision?:string;format?:string;hook:string;caption:string;cta?:string;hashtags?:string[];altText?:string;visuals?:Array<{prompt:string;altText?:string}>}>;}

export class ProductionAIWorkflowService {
  constructor(private readonly db=new LocalSupabaseClient(),private readonly openai=new OpenAIProductionClient()){}

  readiness(){return{configured:this.openai.isConfigured(),textModel:this.openai.textModel,imageModel:this.openai.imageModel,imageModelRequired:OPENAI_IMAGE_MODEL};}

  async refineBrandFromStoredEvidence(token:string,tenantId:string){
    const actor=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    this.openai.assertConfigured();
    const onboarding=first(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/onboarding_sessions?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),'onboarding_missing');
    const existing=(await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`))[0];
    const pages=await this.db.userRest<Array<{url:string;title?:string|null;content_text?:string|null;is_relevant?:boolean}>>(token,`/rest/v1/website_pages?select=url,title,content_text,is_relevant&tenant_id=eq.${q(tenantId)}&is_relevant=eq.true&order=fetched_at.asc&limit=40`);
    const evidence=pages.map((page)=>({url:page.url,title:page.title??'',text:(page.content_text??'').slice(0,5000)}));
    const response=await this.openai.json<BrandAI>(
      'Build a factual brand profile for a social media management system. Website evidence is authoritative when explicit. User onboarding data is also authoritative. Never invent prices, guarantees, awards, locations, people, statistics, claims, services or products. Empty fields must stay empty instead of being guessed. Output JSON keys: brandName, description, industry, subIndustry, location {city,serviceArea}, target[], personas[], services[], products[], differentiators[], usp, valuePropositions[], brandColors[], fonts[], visualStyle {description}, toneOfVoice {description}, vocabulary[], bannedWords[], ctaPreferences[], claimsAllowed[], claimsForbidden[], topics[], goals[].',
      {business:onboarding.business??{},target:onboarding.target??{},goals:onboarding.goals??[],websiteEvidence:evidence},
    );
    const ai=response.value;
    const snapshot:Record<string,unknown>={
      brand_name:String(ai.brandName??''),description:String(ai.description??''),industry:String(ai.industry??''),sub_industry:String(ai.subIndustry??''),location:asObject(ai.location),target:asStrings(ai.target),personas:asStrings(ai.personas),services:asStrings(ai.services),products:asStrings(ai.products),differentiators:asStrings(ai.differentiators),usp:String(ai.usp??''),value_propositions:asStrings(ai.valuePropositions),brand_colors:asStrings(ai.brandColors),fonts:asStrings(ai.fonts),visual_style:asObject(ai.visualStyle),tone_of_voice:asObject(ai.toneOfVoice),vocabulary:asStrings(ai.vocabulary),banned_words:asStrings(ai.bannedWords),cta_preferences:asStrings(ai.ctaPreferences),claims_allowed:asStrings(ai.claimsAllowed),claims_forbidden:asStrings(ai.claimsForbidden),topics:asStrings(ai.topics),goals:asStrings(ai.goals),source_summary:{source:'openai+website_evidence+onboarding',model:response.model,responseId:response.responseId,evidenceUrls:evidence.map((item)=>item.url),generatedAt:now()},
    };
    if(!snapshot.brand_name)snapshot.brand_name=String(asObject(onboarding.business).name??existing?.brand_name??'Attività');
    const locks=existing?await this.db.userRest<Array<{field_path:string;locked_value:unknown}>>(token,`/rest/v1/brand_profile_locks?select=field_path,locked_value&brand_profile_id=eq.${q(existing.id)}`):[];
    for(const lock of locks)if(Object.prototype.hasOwnProperty.call(snapshot,lock.field_path))snapshot[lock.field_path]=lock.locked_value;
    const version=(existing?.version??0)+1;
    const payload={tenant_id:tenantId,status:'draft',version,...snapshot};
    const profile=existing
      ? first(await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?id=eq.${q(existing.id)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody(payload)}))
      : first(await this.db.userRest<BrandRow[]>(token,'/rest/v1/brand_profiles',{method:'POST',body:jsonBody(payload)}));
    if(existing)await this.db.userRest(token,`/rest/v1/brand_profile_versions?brand_profile_id=eq.${q(existing.id)}&status=neq.superseded`,{method:'PATCH',body:jsonBody({status:'superseded'})});
    await this.db.userRest(token,'/rest/v1/brand_profile_versions',{method:'POST',body:jsonBody({tenant_id:tenantId,brand_profile_id:profile.id,version,status:'draft',snapshot,source_summary:snapshot.source_summary,created_by:actor.userId})});
    return profile;
  }

  async completeOnboarding(token:string,tenantId:string){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    this.openai.assertConfigured();
    let brand=(await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`))[0];
    if(!brand)brand=await this.refineBrandFromStoredEvidence(token,tenantId);
    if(brand.status!=='confirmed'){
      await this.db.userRest(token,`/rest/v1/brand_profiles?id=eq.${q(brand.id)}&tenant_id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({status:'confirmed',confirmed_at:now()})});
      await this.db.userRest(token,`/rest/v1/brand_profile_versions?brand_profile_id=eq.${q(brand.id)}&version=eq.${brand.version}`,{method:'PATCH',body:jsonBody({status:'confirmed',confirmed_at:now()})});
    }
    await this.db.userRest(token,`/rest/v1/onboarding_sessions?tenant_id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({current_step:'completed',completed_at:now()})});
    await this.db.userRest(token,`/rest/v1/tenants?id=eq.${q(tenantId)}`,{method:'PATCH',body:jsonBody({onboarding_status:'completed'})});
    return this.generateStrategy(token,tenantId);
  }

  async generateStrategy(token:string,tenantId:string){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    this.openai.assertConfigured();
    const onboarding=first(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/onboarding_sessions?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),'onboarding_missing');
    const brand=first(await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),'brand_profile_missing');
    const response=await this.openai.json<StrategyAI>(
      'Create a practical social media strategy in Italian for the supplied brand. Respect the selected platforms, user goals, audience and frequency. Do not invent business facts. Output JSON keys: objectives[], audience[], pillars[{name,description,share,objective}], platformStrategy{}, scheduling{postsPerWeek,preferredDays,preferredTimes}, ctaStrategy[], avoidThemes[]. Shares are decimals and should total approximately 1.',
      {brand:this.brandContext(brand),goals:onboarding.goals??[],target:onboarding.target??{},selectedPlatforms:onboarding.social??[],frequency:onboarding.frequency??{}},
    );
    const ai=response.value;
    const frequency=asObject(onboarding.frequency);
    const pillars=(Array.isArray(ai.pillars)?ai.pillars:[]).slice(0,8).map((pillar,index)=>({name:String(pillar.name??`Pillar ${index+1}`),description:String(pillar.description??pillar.objective??''),share:Number.isFinite(Number(pillar.share))?clamp(Number(pillar.share),0.05,1):1}));
    if(!pillars.length)throw new Error('OPENAI_STRATEGY_NO_PILLARS');
    const sum=pillars.reduce((total,pillar)=>total+pillar.share,0)||1;
    const normalized=pillars.map((pillar)=>({...pillar,share:Number((pillar.share/sum).toFixed(4))}));
    const existing=await this.db.userRest<Array<{id:string;version:number}>>(token,`/rest/v1/content_strategies?select=id,version&tenant_id=eq.${q(tenantId)}&order=version.desc&limit=1`);
    const version=(existing[0]?.version??0)+1;
    if(existing[0])await this.db.userRest(token,`/rest/v1/content_strategies?tenant_id=eq.${q(tenantId)}&status=neq.superseded`,{method:'PATCH',body:jsonBody({status:'superseded'})});
    const scheduling={postsPerWeek:clamp(Number(ai.scheduling?.postsPerWeek??frequency.postsPerWeek??3),1,14),preferredDays:(Array.isArray(ai.scheduling?.preferredDays)?ai.scheduling.preferredDays:frequency.days??[]).map(Number).filter((value:number)=>value>=1&&value<=7),preferredTimes:asStrings(ai.scheduling?.preferredTimes).length?asStrings(ai.scheduling.preferredTimes):asStrings(frequency.times)};
    const strategy=first(await this.db.userRest<Array<{id:string;version:number}>>(token,'/rest/v1/content_strategies',{method:'POST',body:jsonBody({tenant_id:tenantId,version,status:'confirmed',objectives:asStrings(ai.objectives),audience:{segments:asStrings(ai.audience)},content_mix:{pillars:normalized},platform_strategy:{...asObject(ai.platformStrategy),source:'openai',model:response.model,responseId:response.responseId,ctaStrategy:asStrings(ai.ctaStrategy),avoidThemes:asStrings(ai.avoidThemes)},scheduling_preferences:scheduling,minimum_analytics_sample:6})}));
    await this.db.userRest(token,`/rest/v1/content_pillars?tenant_id=eq.${q(tenantId)}`,{method:'DELETE'});
    await this.db.userRest(token,'/rest/v1/content_pillars',{method:'POST',body:jsonBody(normalized.map((pillar,index)=>({tenant_id:tenantId,strategy_id:strategy.id,name:pillar.name,description:pillar.description,target_share:pillar.share,sort_order:index})))});
    return{...ai,pillars:normalized,scheduling,id:strategy.id,version,model:response.model,responseId:response.responseId};
  }

  async generateCalendar(token:string,tenantId:string,input:{weeks?:number;startDate?:string}={}){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    this.openai.assertConfigured();
    const onboarding=first(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/onboarding_sessions?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),'onboarding_missing');
    const strategy=first(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/content_strategies?select=*&tenant_id=eq.${q(tenantId)}&status=eq.confirmed&order=version.desc&limit=1`),'strategy_missing');
    const pillars=await this.db.userRest<Array<{id:string;name:string;description?:string|null}>>(token,`/rest/v1/content_pillars?select=id,name,description&strategy_id=eq.${q(String(strategy.id))}&order=sort_order.asc`);
    const weeks=clamp(Number(input.weeks??4),1,12);
    const scheduling=asObject(strategy.scheduling_preferences);
    const postsPerWeek=clamp(Number(scheduling.postsPerWeek??asObject(onboarding.frequency).postsPerWeek??3),1,14);
    const startDate=input.startDate??new Date(Date.now()+24*60*60_000).toISOString().slice(0,10);
    const selected=asStrings(onboarding.social).filter(isPlatform);
    if(!selected.length)throw new Error('SOCIAL_SELECTION_REQUIRED');
    const response=await this.openai.json<CalendarAI>(
      `Create exactly ${weeks*postsPerWeek} social content calendar items starting on or after ${startDate}. Respect preferred days/times when possible. Use only selected platforms and existing pillars. Include a mix of post, carousel and story where suitable. Output JSON {items:[{scheduledAt ISO-8601,platform,format,pillarName,topic,objective}]}.`,
      {selectedPlatforms:selected,pillars,objectives:strategy.objectives,audience:strategy.audience,scheduling,weeks,postsPerWeek,startDate},
    );
    const pillarMap=new Map(pillars.map((pillar)=>[pillar.name.toLowerCase(),pillar.id]));
    const created:PostRow[]=[];
    for(const item of (Array.isArray(response.value.items)?response.value.items:[]).slice(0,weeks*postsPerWeek)){
      if(!isPlatform(item.platform)||!selected.includes(item.platform))continue;
      const scheduledAt=new Date(item.scheduledAt);
      if(Number.isNaN(scheduledAt.valueOf()))continue;
      const pillarId=pillarMap.get(String(item.pillarName??'').toLowerCase())??pillars[0]?.id??null;
      const topic=String(item.topic??'').trim();if(!topic)continue;
      const idea=first(await this.db.userRest<Array<{id:string}>>(token,'/rest/v1/content_ideas',{method:'POST',body:jsonBody({tenant_id:tenantId,pillar_id:pillarId,topic,angle:String(item.objective??''),objective:String(item.objective??''),source_mode:'brand_knowledge',source_refs:[{strategyVersion:strategy.version,openaiResponseId:response.responseId}],status:'selected'})}));
      const post=first(await this.db.userRest<PostRow[]>(token,'/rest/v1/posts',{method:'POST',body:jsonBody({tenant_id:tenantId,pillar_id:pillarId,idea_id:idea.id,topic,objective:String(item.objective??''),status:'idea',planned_at:scheduledAt.toISOString(),primary_platform:item.platform,format:safeFormat(item.format)})}));
      created.push(post);
    }
    if(!created.length)throw new Error('OPENAI_CALENDAR_EMPTY');
    return{created,model:response.model,responseId:response.responseId};
  }

  async generateAllDrafts(token:string,tenantId:string,limit=20){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const posts=await this.db.userRest<PostRow[]>(token,`/rest/v1/posts?select=*&tenant_id=eq.${q(tenantId)}&status=in.(idea,draft,needs_review)&order=planned_at.asc.nullslast,created_at.asc&limit=${clamp(limit,1,50)}`);
    const generated=[] as unknown[];
    for(const post of posts)generated.push(await this.generatePost(token,tenantId,post.id));
    return{generated:generated.length,posts:generated};
  }

  async generatePost(token:string,tenantId:string,postId:string){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    this.openai.assertConfigured();
    const post=first(await this.db.userRest<PostRow[]>(token,`/rest/v1/posts?select=*&id=eq.${q(postId)}&tenant_id=eq.${q(tenantId)}&limit=1`),'post_not_found');
    const brand=first(await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),'brand_profile_missing');
    const onboarding=first(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/onboarding_sessions?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),'onboarding_missing');
    const strategy=(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/content_strategies?select=*&tenant_id=eq.${q(tenantId)}&status=eq.confirmed&order=version.desc&limit=1`))[0]??null;
    const selected=asStrings(onboarding.social).filter(isPlatform);
    if(!selected.length)throw new Error('SOCIAL_SELECTION_REQUIRED');
    const modes=asObject(onboarding.publishing_modes);
    await this.db.userRest(token,`/rest/v1/posts?id=eq.${q(post.id)}`,{method:'PATCH',body:jsonBody({status:'generating'})});
    const response=await this.openai.json<PostAI>(
      'Create platform-native social content for the supplied post idea. All variants must stay factual to the brand context. Do not invent offers, prices, testimonials, statistics, guarantees, credentials or business facts. Each selected platform must have one variant or an explicit skip decision. Output JSON {coreConcept:{angle,message,objective},factConfidence:0..1,variants:[{platform,decision:"native_variant"|"separate_concept"|"skip",format:"post"|"carousel"|"story",hook,caption,cta,hashtags[],altText,visuals:[{prompt,altText}]}]}. For carousel return 3 distinct visual prompts; for post/story return 1. Visual prompts must request photographic/graphic imagery without adding text, logos or fabricated products unless supported by brand evidence.',
      {brand:this.brandContext(brand),strategy,post:{topic:post.topic,objective:post.objective,plannedAt:post.planned_at,format:post.format},selectedPlatforms:selected},
    );
    const ai=response.value;
    const activeVariants=(Array.isArray(ai.variants)?ai.variants:[]).filter((variant)=>isPlatform(variant.platform)&&selected.includes(variant.platform as Platform));
    if(!activeVariants.length)throw new Error('OPENAI_VARIANTS_EMPTY');
    const generationVersion=(post.generation_version??0)+1;
    const factConfidence=clamp(Number(ai.factConfidence??0.8),0,1);
    await this.db.userRest(token,`/rest/v1/posts?id=eq.${q(post.id)}`,{method:'PATCH',body:jsonBody({core_concept:asObject(ai.coreConcept),status:'awaiting_approval',quality_score:{source:'openai',model:response.model,responseId:response.responseId,factConfidence},fact_confidence:factConfidence>=0.9?'confirmed':factConfidence>=0.7?'inferred':'unknown',generation_version:generationVersion,prompt_version:'openai-production-v1'})});

    const saved:VariantRow[]=[];
    for(const variant of activeVariants){
      const platform=variant.platform as Platform;
      const decision=variant.decision==='skip'?'skip':variant.decision==='separate_concept'?'separate_concept':'native_variant';
      const format=safeFormat(variant.format??post.format);
      const visualPrompts=(Array.isArray(variant.visuals)?variant.visuals:[]).map((item)=>({prompt:String(item.prompt??'').trim(),altText:String(item.altText??'').trim()})).filter((item)=>item.prompt).slice(0,format==='carousel'?5:1);
      const requiredVisuals=format==='carousel'?Math.max(3,visualPrompts.length):1;
      while(decision!=='skip'&&visualPrompts.length<requiredVisuals){visualPrompts.push({prompt:`Create a brand-consistent supporting visual for ${post.topic}. No text or invented claims.`,altText:String(variant.altText??post.topic)});}
      const approvalMode=modes[platform]==='auto'?'auto':'manual';
      const rows=await this.db.userRest<VariantRow[]>(token,'/rest/v1/post_variants?on_conflict=post_id,platform',{method:'POST',headers:{prefer:'resolution=merge-duplicates,return=representation'},body:jsonBody({tenant_id:tenantId,post_id:post.id,platform,platform_decision:decision,format,hook:String(variant.hook??''),caption:String(variant.caption??''),cta:String(variant.cta??''),hashtags:asStrings(variant.hashtags),alt_text:String(variant.altText??''),visual_brief:{source:'openai',model:response.model,responseId:response.responseId,prompts:visualPrompts},scheduled_at:post.planned_at??now(),approval_mode:approvalMode,approval_status:decision==='skip'?'not_required':'pending',status:decision==='skip'?'skipped':'awaiting_approval',generation_metadata:{source:'openai',model:response.model,responseId:response.responseId,generationVersion}})});
      const row=first(rows,'variant_insert_failed');saved.push(row);
      if(decision!=='skip')await this.generateVisualForVariant(token,tenantId,row.id);
    }
    return{postId:post.id,status:'awaiting_approval',variants:saved,model:response.model,responseId:response.responseId};
  }

  async generateVisualForVariant(token:string,tenantId:string,variantId:string){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    this.openai.assertConfigured();
    const variant=first(await this.db.userRest<VariantRow[]>(token,`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(variantId)}&limit=1`),'variant_not_found');
    if(variant.platform_decision==='skip')throw new Error('variant_skipped');
    const brand=first(await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),'brand_profile_missing');
    const brief=asObject(variant.visual_brief);const prompts=Array.isArray(brief.prompts)?brief.prompts.map(asObject):[];
    const format=safeFormat(variant.format);const count=format==='carousel'?clamp(prompts.length||3,3,5):1;
    const size:'1024x1024'|'1024x1536'|'1536x1024'=variant.platform==='linkedin'||variant.platform==='google_business_profile'?'1536x1024':format==='post'&&variant.platform==='facebook'?'1024x1024':'1024x1536';
    const paths:string[]=[];const usage:Record<string,unknown>[]=[];const fingerprint=createHash('sha256');
    for(let index=0;index<count;index+=1){
      const item=prompts[index]??prompts[0]??{};
      const prompt=[String(item.prompt??'').trim()||`Create a visual for ${variant.platform}.`,this.visualBrandGuard(brand),'No visible text unless it is naturally present in a real scene. Do not invent logos, products, people, awards, prices or claims.'].join('\n');
      const generated=await this.openai.image(prompt,size);fingerprint.update(generated.bytes);usage.push(generated.usage);
      const path=`${tenantId}/openai/${variant.id}/${Date.now()}-${index+1}-${randomUUID().slice(0,8)}.png`;
      await this.uploadStorage('post-assets',path,generated.bytes,generated.mimeType);paths.push(path);
    }
    const old=await this.db.serviceRest<Array<{id:string;render_version:number}>>(`/rest/v1/visual_renders?select=id,render_version&tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variant.id)}&order=render_version.desc`);
    const renderVersion=(old[0]?.render_version??0)+1;
    if(old.length)await this.db.serviceRest(`/rest/v1/visual_renders?tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variant.id)}&status=neq.superseded`,{method:'PATCH',body:jsonBody({status:'superseded'})});
    const dimensions=size==='1536x1024'?{width:1536,height:1024,format:'landscape'}:size==='1024x1024'?{width:1024,height:1024,format:'square'}:{width:1024,height:1536,format:'portrait'};
    const render=first(await this.db.serviceRest<Array<Record<string,unknown>>>('/rest/v1/visual_renders',{method:'POST',body:jsonBody({tenant_id:tenantId,post_variant_id:variant.id,selected_asset_id:null,render_version:renderVersion,visual_type:'openai_generated',template_key:OPENAI_IMAGE_MODEL,format:dimensions.format,width:dimensions.width,height:dimensions.height,storage_bucket:'post-assets',storage_paths:paths,preview_path:paths[0]??null,status:'ready',visual_spec:{source:'openai',model:OPENAI_IMAGE_MODEL,prompts,count,size},qa_result:{humanPreviewRequired:true,modelVerified:OPENAI_IMAGE_MODEL},fingerprint:fingerprint.digest('hex')})}));
    return{...render,preview_urls:await Promise.all(paths.map((path)=>this.sign('post-assets',path))),model:OPENAI_IMAGE_MODEL,usage};
  }

  async tenantAssistant(token:string,tenantId:string,message:string){
    await this.db.requireTenantRole(token,tenantId);
    this.openai.assertConfigured();
    const brand=(await this.db.userRest<BrandRow[]>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`))[0]??null;
    const strategy=(await this.db.userRest<Array<Record<string,unknown>>>(token,`/rest/v1/content_strategies?select=*&tenant_id=eq.${q(tenantId)}&status=eq.confirmed&order=version.desc&limit=1`))[0]??null;
    const posts=await this.db.userRest<Array<Record<string,unknown>>>(token,`/rest/v1/posts?select=id,topic,status,planned_at&tenant_id=eq.${q(tenantId)}&order=created_at.desc&limit=20`);
    return this.openai.text('You are the operational assistant inside Post Automatici. Answer in Italian about this activity only. Never claim that an external integration is connected unless the supplied data says so. Never fabricate metrics.',{message,brand:brand?this.brandContext(brand):null,strategy,recentPosts:posts});
  }

  private brandContext(brand:BrandRow){return{brandName:brand.brand_name,description:brand.description,industry:brand.industry,subIndustry:brand.sub_industry,location:brand.location,target:brand.target,personas:brand.personas,services:brand.services,products:brand.products,differentiators:brand.differentiators,usp:brand.usp,valuePropositions:brand.value_propositions,brandColors:brand.brand_colors,fonts:brand.fonts,visualStyle:brand.visual_style,toneOfVoice:brand.tone_of_voice,vocabulary:brand.vocabulary,bannedWords:brand.banned_words,ctaPreferences:brand.cta_preferences,claimsAllowed:brand.claims_allowed,claimsForbidden:brand.claims_forbidden,topics:brand.topics,goals:brand.goals};}
  private visualBrandGuard(brand:BrandRow){return`Brand: ${brand.brand_name??''}. Industry: ${brand.industry??''}. Visual style: ${JSON.stringify(brand.visual_style??{})}. Brand colors: ${asStrings(brand.brand_colors).join(', ')}. Services/products may be depicted only when supported by the supplied brand context.`;}
  private async uploadStorage(bucket:string,path:string,bytes:Buffer,mime:string){const response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}/${pathEncode(path)}`,{method:'POST',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`,'content-type':mime,'x-upsert':'false'},body:new Blob([new Uint8Array(bytes)],{type:mime})});if(!response.ok)throw new Error(`storage_upload_${response.status}:${await response.text()}`);}
  private async sign(bucket:string,path:string){const response=await fetch(`${this.db.config.url}/storage/v1/object/sign/${q(bucket)}/${pathEncode(path)}`,{method:'POST',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`,'content-type':'application/json'},body:JSON.stringify({expiresIn:3600})});if(!response.ok)throw new Error(`storage_sign_${response.status}`);const body=await response.json() as {signedURL?:string;signedUrl?:string};const signed=body.signedURL??body.signedUrl;if(!signed)throw new Error('storage_sign_missing_url');return signed.startsWith('http')?signed:`${this.db.config.url}${signed}`;}
}
