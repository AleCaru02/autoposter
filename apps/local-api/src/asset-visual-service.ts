import { createHash } from 'node:crypto';
import {
  AssetSelectionEngine,
  DeterministicAssetClassifier,
  DeterministicGraphicRenderer,
  DeterministicVisualDirector,
  ImagePromptBuilder,
  MockImageGenerationProvider,
  SelectiveQaRepairEngine,
  buildCarouselSlides,
  deriveVisualTemplateProfile,
  visualFingerprint,
  type AssetSelectionResult,
  type AssetType,
  type AssetUsageSignal,
  type RepairComponent,
  type RepairableVariant,
  type TemplateKey,
  type VisualAsset,
  type VisualBrief,
  type VisualFormat,
  type VisualPlatform,
  type VisualQaIssue,
  type VisualTemplateProfile,
} from '../../../packages/runtime/src/index.js';
import { LocalSupabaseClient, jsonBody } from './db.js';

const allowedMimes=new Set(['image/jpeg','image/png','image/webp','image/svg+xml','application/pdf']);
const imageMimes=new Set(['image/jpeg','image/png','image/webp','image/svg+xml']);
const q=(value:string)=>encodeURIComponent(value);
const now=()=>new Date().toISOString();
const sha256=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const maxBytes=()=>Number(process.env.LOCAL_ASSET_MAX_BYTES??8*1024*1024);
const jsonHeaders={'content-type':'application/json'};
const safeFilename=(value:string)=>value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').replace(/^[-.]+|[-.]+$/g,'').slice(0,120)||'asset';
const pathEncode=(value:string)=>value.split('/').map(encodeURIComponent).join('/');
const first=<T>(rows:T[],message='row_not_found'):T=>{const item=rows[0];if(!item)throw new Error(message);return item};
const trim=(value:string,max:number)=>value.trim().length<=max?value.trim():`${value.trim().slice(0,Math.max(1,max-1)).replace(/[\s,.;:!-]+$/,'')}…`;

interface AssetRow {
  id:string; tenant_id:string; kind:string; storage_bucket:string; storage_path:string; original_filename:string|null;
  mime_type:string|null; bytes:number|null; width:number|null; height:number|null; tags:string[]; content_hash:string|null;
  metadata:Record<string,unknown>; asset_type:AssetType; source:string; description:string|null; alt_text:string|null;
  dominant_colors:string[]; suitable_platforms:VisualPlatform[]; suitable_topics:string[]; quality_score:number|null;
  is_brand_locked:boolean; is_preferred:boolean; status:'ACTIVE'|'ARCHIVED'|'BLOCKED'; thumbnail_path:string|null;
  index_status:string; usage_count:number; last_used_at:string|null; created_at:string; updated_at:string;
}
interface VariantRow { id:string;tenant_id:string;post_id:string;platform:VisualPlatform;platform_decision:string;format:string|null;hook:string|null;caption:string|null;cta:string|null;hashtags:string[];alt_text:string|null;visual_brief:Record<string,unknown>;scheduled_at:string|null;approval_status:string; }
interface PostRow { id:string;topic:string;objective:string|null;quality_score:Record<string,unknown>;pillar_id:string|null; }
interface VisualRenderRow { id:string;tenant_id:string;post_variant_id:string;render_version:number;storage_bucket:string;storage_paths:string[];status:string;fingerprint:string;visual_spec:Record<string,unknown>;qa_result:Record<string,unknown>; }

function detectDimensions(bytes:Buffer,mime:string):{width:number|null;height:number|null}{
  if(mime==='image/png'){
    if(bytes.length<24||bytes.toString('hex',0,8)!=='89504e470d0a1a0a')throw new Error('asset_corrupt_image');
    return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }
  if(mime==='image/jpeg'){
    if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)throw new Error('asset_corrupt_image');
    let offset=2;
    while(offset+9<bytes.length){
      if(bytes[offset]!==0xff){offset+=1;continue}
      const marker=bytes[offset+1]??0;
      const length=bytes.readUInt16BE(offset+2);
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return{height:bytes.readUInt16BE(offset+5),width:bytes.readUInt16BE(offset+7)};
      if(length<2)break;
      offset+=2+length;
    }
    throw new Error('asset_corrupt_image');
  }
  if(mime==='image/svg+xml'){
    const source=bytes.toString('utf8',0,Math.min(bytes.length,10000));
    if(!/<svg\b/i.test(source))throw new Error('asset_corrupt_image');
    const width=source.match(/\bwidth=["']([0-9.]+)/i);
    const height=source.match(/\bheight=["']([0-9.]+)/i);
    const view=source.match(/\bviewBox=["'][^"']*?([0-9.]+)[ ,]+([0-9.]+)["']/i);
    return{width:width?.[1]?Math.round(Number(width[1])):view?.[1]?Math.round(Number(view[1])):1080,height:height?.[1]?Math.round(Number(height[1])):view?.[2]?Math.round(Number(view[2])):1080};
  }
  if(mime==='image/webp'){
    if(bytes.length<16||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw new Error('asset_corrupt_image');
    return{width:null,height:null};
  }
  return{width:null,height:null};
}

export class LocalAssetVisualService {
  private readonly db=new LocalSupabaseClient();
  private readonly classifier=new DeterministicAssetClassifier();
  private readonly selector=new AssetSelectionEngine();
  private readonly director=new DeterministicVisualDirector();
  private readonly renderer=new DeterministicGraphicRenderer();
  private readonly imageProvider=new MockImageGenerationProvider();
  private readonly promptBuilder=new ImagePromptBuilder();
  private readonly repairEngine=new SelectiveQaRepairEngine();

  async listAssets(token:string,tenantId:string,filter:{search?:string;type?:string;status?:string}={}){
    await this.db.requireTenantRole(token,tenantId);
    const rows=await this.db.userRest<AssetRow[]>(token,`/rest/v1/brand_assets?select=*&tenant_id=eq.${q(tenantId)}&order=created_at.desc`);
    const search=(filter.search??'').trim().toLowerCase();
    const filtered=rows
      .filter((asset)=>!filter.type||asset.asset_type===filter.type)
      .filter((asset)=>!filter.status||asset.status===filter.status)
      .filter((asset)=>!search||`${asset.original_filename??''} ${asset.description??''} ${(asset.tags??[]).join(' ')}`.toLowerCase().includes(search));
    return Promise.all(filtered.map(async(asset)=>({...asset,preview_url:imageMimes.has(asset.mime_type??'')?await this.sign(asset.storage_bucket,asset.thumbnail_path??asset.storage_path):null})));
  }

  async uploadAsset(token:string,tenantId:string,input:{filename:string;mimeType:string;dataBase64:string;description?:string;altText?:string}){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    if(!allowedMimes.has(input.mimeType))throw new Error('asset_mime_not_supported');
    const bytes=Buffer.from(input.dataBase64,'base64');
    if(bytes.length===0)throw new Error('asset_empty_file');
    if(bytes.length>maxBytes())throw new Error('asset_file_too_large');
    const digest=sha256(bytes);
    const duplicates=await this.db.userRest<AssetRow[]>(token,`/rest/v1/brand_assets?select=*&tenant_id=eq.${q(tenantId)}&content_hash=eq.${digest}&limit=1`);
    if(duplicates[0])return{asset:{...duplicates[0],preview_url:imageMimes.has(duplicates[0].mime_type??'')?await this.sign(duplicates[0].storage_bucket,duplicates[0].storage_path):null},deduplicated:true};
    const dimensions=detectDimensions(bytes,input.mimeType);
    if((dimensions.width??1)<=0||(dimensions.height??1)<=0)throw new Error('asset_invalid_dimensions');
    const classification=this.classifier.classify({filename:input.filename,mimeType:input.mimeType,width:dimensions.width,height:dimensions.height});
    const path=`${tenantId}/assets/${digest.slice(0,16)}-${safeFilename(input.filename)}`;
    await this.uploadStorage('brand-assets',path,bytes,input.mimeType);
    const kind=classification.assetType==='logo'||classification.assetType==='logo_alt'?'logo':input.mimeType==='application/pdf'?'document':'image';
    const inserted=await this.db.serviceRest<AssetRow[]>('/rest/v1/brand_assets',{method:'POST',headers:jsonHeaders,body:jsonBody({
      tenant_id:tenantId,kind,storage_bucket:'brand-assets',storage_path:path,original_filename:safeFilename(input.filename),mime_type:input.mimeType,
      bytes:bytes.length,width:dimensions.width,height:dimensions.height,tags:classification.tags,classification_confidence:1,content_hash:digest,
      metadata:{classifier:'deterministic-v1'},created_by:auth.userId,asset_type:classification.assetType,source:'upload',description:input.description??null,
      alt_text:input.altText??null,dominant_colors:[],suitable_platforms:classification.suitablePlatforms,suitable_topics:classification.suitableTopics,
      quality_score:classification.qualityScore,is_brand_locked:false,is_preferred:false,status:'ACTIVE',index_status:input.mimeType==='application/pdf'?'pending':'not_applicable'
    })});
    const asset=first(inserted,'asset_insert_failed');
    await this.logCost(tenantId,'asset_classification',{assetId:asset.id});
    return{asset:{...asset,preview_url:imageMimes.has(asset.mime_type??'')?await this.sign(asset.storage_bucket,asset.storage_path):null},deduplicated:false};
  }

  async updateAsset(token:string,tenantId:string,assetId:string,input:Record<string,unknown>){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const patch:Record<string,unknown>={updated_at:now()};
    const fields:[string,string][]=[['description','description'],['altText','alt_text'],['tags','tags'],['assetType','asset_type'],['isPreferred','is_preferred'],['isBrandLocked','is_brand_locked'],['status','status']];
    for(const [source,target] of fields)if(source in input)patch[target]=input[source];
    const rows=await this.db.userRest<AssetRow[]>(token,`/rest/v1/brand_assets?tenant_id=eq.${q(tenantId)}&id=eq.${q(assetId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody(patch)});
    return first(rows,'asset_not_found');
  }

  async deleteAsset(token:string,tenantId:string,assetId:string){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const asset=first(await this.db.userRest<AssetRow[]>(token,`/rest/v1/brand_assets?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(assetId)}&limit=1`),'asset_not_found');
    const refs=await this.db.serviceRest<Array<{id:string}>>(`/rest/v1/post_assets?select=id&tenant_id=eq.${q(tenantId)}&asset_id=eq.${q(assetId)}&limit=1`);
    if(refs[0])throw new Error('asset_in_use');
    await this.deleteStorage(asset.storage_bucket,asset.storage_path);
    await this.db.userRest<unknown>(token,`/rest/v1/brand_assets?tenant_id=eq.${q(tenantId)}&id=eq.${q(assetId)}`,{method:'DELETE'});
    return{deleted:true};
  }

  async getTemplateProfile(token:string,tenantId:string){
    await this.db.requireTenantRole(token,tenantId);
    const existing=await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/visual_template_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`);
    if(existing[0])return existing[0];
    const profile=deriveVisualTemplateProfile(tenantId);
    const created=await this.db.serviceRest<Array<Record<string,any>>>('/rest/v1/visual_template_profiles',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,preferred_templates:profile.preferredTemplates,spacing:profile.spacing,image_ratio:profile.imageRatio,text_density:profile.textDensity,logo_position:profile.logoPosition,border_style:profile.borderStyle,cta_style:profile.ctaStyle,variants:{variantSeed:profile.variantSeed}})});
    return first(created);
  }

  async updateBrandVisualSettings(token:string,tenantId:string,input:{primaryLogoAssetId?:string|null;alternateLogoAssetId?:string|null;preferredVisualStyle?:Record<string,unknown>}){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    for(const assetId of [input.primaryLogoAssetId,input.alternateLogoAssetId].filter((value):value is string=>Boolean(value))){
      const found=await this.db.userRest<Array<{id:string}>>(token,`/rest/v1/brand_assets?select=id&tenant_id=eq.${q(tenantId)}&id=eq.${q(assetId)}&status=eq.ACTIVE&limit=1`);
      if(!found[0])throw new Error('asset_not_found');
    }
    const confirmed=await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&status=eq.confirmed&order=version.desc&limit=1`);
    const profile=confirmed[0]??first(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&order=version.desc&limit=1`));
    const patch:Record<string,unknown>={updated_at:now()};
    if(Object.prototype.hasOwnProperty.call(input,'primaryLogoAssetId'))patch.primary_logo_asset_id=input.primaryLogoAssetId??null;
    if(Object.prototype.hasOwnProperty.call(input,'alternateLogoAssetId'))patch.alternate_logo_asset_id=input.alternateLogoAssetId??null;
    if(input.preferredVisualStyle)patch.preferred_visual_style=input.preferredVisualStyle;
    return first(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/brand_profiles?tenant_id=eq.${q(tenantId)}&id=eq.${q(String(profile.id))}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody(patch)}));
  }

  async latestVisual(token:string,tenantId:string,variantId:string){
    await this.db.requireTenantRole(token,tenantId);
    const rows=await this.db.userRest<VisualRenderRow[]>(token,`/rest/v1/visual_renders?select=*&tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&order=render_version.desc&limit=1`);
    const render=rows[0];
    if(!render)return null;
    return{...render,preview_urls:await Promise.all((render.storage_paths??[]).map((path)=>this.sign(render.storage_bucket,path)))};
  }

  async renderPendingVariants(token:string,tenantId:string,limit=80){
    await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const variants=await this.db.userRest<VariantRow[]>(token,`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&platform_decision=neq.skip&order=created_at.asc&limit=${Math.max(1,Math.min(limit,100))}`);
    let created=0;
    for(const variant of variants){
      const existing=await this.db.userRest<Array<{id:string}>>(token,`/rest/v1/visual_renders?select=id&tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variant.id)}&status=neq.superseded&limit=1`);
      if(existing[0])continue;
      await this.renderVariant(token,tenantId,variant.id);
      created+=1;
    }
    return{created};
  }

  async renderVariant(token:string,tenantId:string,variantId:string,options:{assetId?:string;rotateTemplate?:boolean;cycleAsset?:boolean;carouselType?:string}={}){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    const variant=first(await this.db.userRest<VariantRow[]>(token,`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(variantId)}&limit=1`),'variant_not_found');
    if(variant.platform_decision==='skip')throw new Error('visual_not_applicable');
    const post=first(await this.db.userRest<PostRow[]>(token,`/rest/v1/posts?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(variant.post_id)}&limit=1`),'post_not_found');
    const brand=first(await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&order=version.desc&limit=1`),'brand_profile_not_found');
    const assets=await this.db.userRest<AssetRow[]>(token,`/rest/v1/brand_assets?select=*&tenant_id=eq.${q(tenantId)}&status=eq.ACTIVE&order=created_at.desc`);
    const usageRows=await this.db.userRest<Array<Record<string,any>>>(token,`/rest/v1/asset_usage_history?select=*&tenant_id=eq.${q(tenantId)}&order=used_at.desc&limit=100`);
    if(options.assetId&&!assets.some((asset)=>asset.id===options.assetId))throw new Error('asset_not_found');

    const format=this.resolveFormat(variant.platform,variant.format);
    const mappedAssets=assets.map((asset)=>this.mapAsset(asset));
    const usage:AssetUsageSignal[]=usageRows.map((item)=>{
      const signal:AssetUsageSignal={assetId:String(item.asset_id),usedAt:String(item.used_at)};
      if(item.template_key)signal.templateKey=String(item.template_key);
      if(item.visual_type)signal.visualType=item.visual_type as AssetUsageSignal['visualType'];
      if(item.visual_fingerprint)signal.visualFingerprint=String(item.visual_fingerprint);
      return signal;
    });
    const forced=options.assetId?mappedAssets.find((asset)=>asset.id===options.assetId)??null:null;
    let selection:AssetSelectionResult=forced
      ?{decision:'real_asset',selectedAssetId:forced.id,generatedVisualRequired:false,motivationCode:'USER_SELECTED_ASSET',confidence:1,score:100}
      :this.selector.select({tenantId,topic:post.topic,pillar:String(variant.visual_brief.pillar??''),platform:variant.platform,format,brief:this.brief(post,variant,options.carouselType),assets:mappedAssets,usage,now:now()});

    if(options.cycleAsset&&selection.selectedAssetId){
      const alternate=mappedAssets.find((asset)=>asset.id!==selection.selectedAssetId&&asset.status==='ACTIVE');
      if(alternate)selection={...selection,selectedAssetId:alternate.id,motivationCode:'USER_CYCLE_ASSET',confidence:1};
    }

    const profile=this.mapTemplateProfile(await this.getTemplateProfile(token,tenantId));
    const recent=await this.db.userRest<Array<{fingerprint:string}>>(token,`/rest/v1/visual_renders?select=fingerprint&tenant_id=eq.${q(tenantId)}&order=created_at.desc&limit=30`);
    const brief=this.brief(post,variant,options.carouselType);
    const direction=this.director.direct({tenantId,platform:variant.platform,format,topic:post.topic,brief,selection,profile,recentFingerprints:recent.map((item)=>item.fingerprint)});
    const templateKeys=Object.keys((await import('../../../packages/runtime/src/visual-engine.js')).templateCatalog) as TemplateKey[];
    const matchingRecent=recent.filter((item)=>item.fingerprint.startsWith(`${direction.templateKey}|${direction.visualType}|${selection.selectedAssetId??'none'}|`)).length;
    if(options.rotateTemplate||matchingRecent>=2){
      const current=Math.max(0,templateKeys.indexOf(direction.templateKey));
      direction.templateKey=templateKeys[(current+1+profile.variantSeed%3)%templateKeys.length]!;
      direction.layout=direction.templateKey;
    }

    const selectedRow=selection.selectedAssetId?assets.find((asset)=>asset.id===selection.selectedAssetId)??null:null;
    let assetDataUri:string|undefined;
    if(selectedRow&&imageMimes.has(selectedRow.mime_type??'')){
      try{assetDataUri=this.dataUri(await this.downloadStorage(selectedRow.storage_bucket,selectedRow.storage_path),selectedRow.mime_type??'image/jpeg')}
      catch{selection={...selection,decision:'branded_graphic',selectedAssetId:null,generatedVisualRequired:false,motivationCode:'SELECTED_ASSET_MISSING_FALLBACK',confidence:.6}}
    }

    if(selection.generatedVisualRequired){
      const prompt=this.promptBuilder.build({brandName:String(brand.brand_name??'Brand'),visualBrief:brief,content:post.topic,platform:variant.platform,style:JSON.stringify(brand.preferred_visual_style??brand.visual_style??{}),forbiddenElements:['invented logos','fake testimonials'],assetReferences:[],photographicDirection:'natural, brand-consistent, no embedded text'});
      const generated=await this.imageProvider.generate({tenantId,prompt:prompt.prompt,format,forbiddenElements:prompt.forbiddenElements,referenceAssetIds:prompt.referenceAssetIds});
      assetDataUri=generated.dataUri;
      await this.logCost(tenantId,'image_generation',{variantId,provider:'mock'});
    }

    let logoDataUri:string|undefined;
    const primaryLogoId=typeof brand.primary_logo_asset_id==='string'?brand.primary_logo_asset_id:null;
    if(primaryLogoId){
      const logo=assets.find((asset)=>asset.id===primaryLogoId);
      if(logo&&imageMimes.has(logo.mime_type??'')){
        try{logoDataUri=this.dataUri(await this.downloadStorage(logo.storage_bucket,logo.storage_path),logo.mime_type??'image/svg+xml')}catch{}
      }
    }

    const basePalette=this.palette(brand,tenantId);
    const forbiddenClaims=this.stringArray(brand.claims_forbidden);
    const carouselType=options.carouselType as VisualBrief['carouselType']|undefined;
    const slides=carouselType?buildCarouselSlides({type:carouselType,headline:direction.headline,supportingText:direction.supportingText,cta:direction.visualCta}):[{slideIndex:0,headline:direction.headline,body:direction.supportingText,layout:'single',visualType:direction.visualType}];
    const previous=await this.db.userRest<Array<{render_version:number}>>(token,`/rest/v1/visual_renders?select=render_version&tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&order=render_version.desc&limit=1`);
    const version=(previous[0]?.render_version??0)+1;
    const rendered:Array<{svg:string;width:number;height:number;initialIssues:VisualQaIssue[];finalIssues:VisualQaIssue[]}>=[];

    for(const slide of slides){
      let headline=slide.headline;
      let supportingText=slide.body;
      let cta=direction.visualCta;
      let palette=[...basePalette];
      const make=()=>this.renderer.render({tenantId,platform:variant.platform,format,visualType:carouselType?'carousel':direction.visualType,templateKey:direction.templateKey,headline,supportingText,cta,palette,fontFamily:this.font(brand),...(assetDataUri?{assetDataUri}:{}),...(logoDataUri?{logoDataUri}:{}),logoPosition:profile.logoPosition,forbiddenClaims,slideIndex:slide.slideIndex,totalSlides:slides.length});
      let result=make();
      const initialIssues=[...result.issues];
      if(result.issues.some((issue)=>issue.code==='HEADLINE_TOO_LONG'))headline=trim(headline,68);
      if(result.issues.some((issue)=>issue.code==='BODY_TOO_LONG'))supportingText=trim(supportingText,150);
      if(result.issues.some((issue)=>issue.code==='CTA_TOO_LONG'))cta=trim(cta,34);
      if(result.issues.some((issue)=>issue.code==='LOW_CONTRAST'))palette=['#111827','#ffffff',palette[2]??'#f59e0b'];
      if(initialIssues.some((issue)=>issue.severity!=='blocker'))result=make();
      rendered.push({svg:result.svg,width:result.width,height:result.height,initialIssues,finalIssues:result.issues});
    }

    const storagePaths:string[]=[];
    for(let index=0;index<rendered.length;index+=1){
      const path=`${tenantId}/visuals/${variantId}/v${version}-${index+1}.svg`;
      await this.uploadStorage('post-assets',path,Buffer.from(rendered[index]!.svg,'utf8'),'image/svg+xml',true);
      storagePaths.push(path);
    }

    const fingerprint=visualFingerprint({templateKey:direction.templateKey,visualType:carouselType?'carousel':direction.visualType,assetId:selection.selectedAssetId,headline:direction.headline,background:basePalette[0]??'#111827',ctaPosition:'bottom_content'});
    const initialIssues=rendered.flatMap((item)=>item.initialIssues);
    const finalIssues=rendered.flatMap((item)=>item.finalIssues);
    await this.db.serviceRest(`/rest/v1/visual_renders?tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&status=neq.superseded`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({status:'superseded'})});
    const render=first(await this.db.serviceRest<VisualRenderRow[]>('/rest/v1/visual_renders',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,selected_asset_id:selection.selectedAssetId,render_version:version,visual_type:carouselType?'carousel':direction.visualType,template_key:direction.templateKey,format,width:rendered[0]!.width,height:rendered[0]!.height,storage_bucket:'post-assets',storage_paths:storagePaths,preview_path:storagePaths[0],status:finalIssues.some((issue)=>issue.severity==='blocker'||issue.severity==='error')?'qa_failed':'ready',visual_spec:{direction,selection,palette:basePalette,slides},qa_result:{initialIssues,finalIssues,selectiveRepairApplied:initialIssues.length>finalIssues.length},fingerprint})}),'visual_render_insert_failed');

    for(const issue of initialIssues){
      const stillOpen=finalIssues.some((finalIssue)=>finalIssue.code===issue.code&&finalIssue.affectedComponent===issue.affectedComponent);
      await this.db.serviceRest('/rest/v1/visual_qa_issues',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,visual_render_id:render.id,issue_code:issue.code,affected_component:issue.affectedComponent,severity:issue.severity,repair_action:issue.repairAction,status:stillOpen?(issue.severity==='blocker'?'blocked':'open'):'repaired',details:issue,...(stillOpen?{}:{resolved_at:now()})})});
    }

    await this.db.serviceRest('/rest/v1/post_assets',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,asset_id:selection.selectedAssetId,source_type:selection.decision==='real_asset'?'real_asset':selection.decision==='generated_visual'?'ai_generated':'deterministic_graphic',storage_bucket:'post-assets',storage_path:storagePaths[0],role:'primary',metadata:{visualRenderId:render.id,renderVersion:version}})});
    if(selection.selectedAssetId){
      await this.db.serviceRest('/rest/v1/asset_usage_history',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,asset_id:selection.selectedAssetId,post_variant_id:variantId,platform:variant.platform,template_key:direction.templateKey,visual_type:carouselType?'carousel':direction.visualType,visual_fingerprint:fingerprint})});
      await this.db.serviceRest(`/rest/v1/brand_assets?tenant_id=eq.${q(tenantId)}&id=eq.${q(selection.selectedAssetId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({usage_count:(selectedRow?.usage_count??0)+1,last_used_at:now(),updated_at:now()})});
    }

    const visualScore=this.visualScore(finalIssues,selection.confidence,matchingRecent);
    await this.db.serviceRest(`/rest/v1/post_variants?tenant_id=eq.${q(tenantId)}&id=eq.${q(variantId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({visual_brief:{...variant.visual_brief,direction,selection,visualRenderId:render.id,renderVersion:version,previewPath:storagePaths[0],visualQuality:visualScore},alt_text:variant.alt_text??`${post.topic}. Visuale coerente con il brand.`})});
    await this.db.serviceRest(`/rest/v1/posts?tenant_id=eq.${q(tenantId)}&id=eq.${q(post.id)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({quality_score:{...post.quality_score,visual:visualScore}})});
    await this.recordComponentVersion(tenantId,variantId,'visual',{renderId:render.id,templateKey:direction.templateKey,assetId:selection.selectedAssetId,paths:storagePaths,quality:visualScore},'visual_render','render_visual',auth.userId);
    await this.logCost(tenantId,'visual_qa',{variantId,initialIssueCount:initialIssues.length,finalIssueCount:finalIssues.length});
    return{...render,selection,direction,visual_quality:visualScore,preview_urls:await Promise.all(storagePaths.map((path)=>this.sign('post-assets',path)))};
  }

  async repairVariant(token:string,tenantId:string,variantId:string,input:{component:RepairComponent;issueCode:string}){
    const auth=await this.db.requireTenantRole(token,tenantId,['owner','admin','editor']);
    if(input.component==='visual')return this.renderVariant(token,tenantId,variantId,{rotateTemplate:true});
    const variant=first(await this.db.userRest<VariantRow[]>(token,`/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&id=eq.${q(variantId)}&limit=1`),'variant_not_found');
    const direction=(variant.visual_brief.direction??{}) as Record<string,unknown>;
    const current:RepairableVariant={hook:variant.hook??'',caption:variant.caption??'',hashtags:variant.hashtags??[],cta:variant.cta??'',visual:{templateKey:(direction.templateKey??'minimal_brand_card') as TemplateKey,headline:String(direction.headline??variant.hook??''),supportingText:String(direction.supportingText??variant.caption??'')}};
    const repaired=this.repairEngine.repair({component:input.component,variant:current,issueCode:input.issueCode,variantSeed:deriveVisualTemplateProfile(tenantId).variantSeed});
    const oldValue=input.component==='hook'?current.hook:input.component==='caption'?current.caption:input.component==='hashtags'?current.hashtags:current.cta;
    const newValue=input.component==='hook'?repaired.variant.hook:input.component==='caption'?repaired.variant.caption:input.component==='hashtags'?repaired.variant.hashtags:repaired.variant.cta;
    await this.recordComponentVersion(tenantId,variantId,input.component,oldValue,input.issueCode,'before_repair',auth.userId);
    await this.db.serviceRest(`/rest/v1/post_variants?tenant_id=eq.${q(tenantId)}&id=eq.${q(variantId)}`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({[input.component]:newValue,updated_at:now()})});
    await this.recordComponentVersion(tenantId,variantId,input.component,newValue,input.issueCode,repaired.repairAction,auth.userId);
    return{component:input.component,repairAction:repaired.repairAction,value:newValue};
  }

  private brief(post:PostRow,variant:VariantRow,carouselType?:string):VisualBrief{
    const brief:VisualBrief={objective:post.objective??'engagement',headline:variant.hook??post.topic,supportingText:variant.caption??'',cta:variant.cta??'',requiresPhotorealism:Boolean(variant.visual_brief.requiresPhotorealism)};
    if(carouselType)brief.carouselType=carouselType as NonNullable<VisualBrief['carouselType']>;
    return brief;
  }
  private mapAsset(asset:AssetRow):VisualAsset{return{id:asset.id,tenantId:asset.tenant_id,assetType:asset.asset_type,mimeType:asset.mime_type,filename:asset.original_filename??asset.id,tags:asset.tags??[],suitablePlatforms:asset.suitable_platforms??[],suitableTopics:asset.suitable_topics??[],qualityScore:Number(asset.quality_score??.5),isBrandLocked:asset.is_brand_locked,isPreferred:asset.is_preferred,status:asset.status,usageCount:asset.usage_count,lastUsedAt:asset.last_used_at}}
  private mapTemplateProfile(row:Record<string,any>):VisualTemplateProfile{return{preferredTemplates:(row.preferred_templates??[]) as TemplateKey[],spacing:row.spacing as VisualTemplateProfile['spacing'],imageRatio:row.image_ratio as VisualTemplateProfile['imageRatio'],textDensity:row.text_density as VisualTemplateProfile['textDensity'],logoPosition:row.logo_position as VisualTemplateProfile['logoPosition'],borderStyle:row.border_style as VisualTemplateProfile['borderStyle'],ctaStyle:row.cta_style as VisualTemplateProfile['ctaStyle'],variantSeed:Number(row.variants?.variantSeed??0)}}
  private resolveFormat(platform:VisualPlatform,format:string|null):VisualFormat{const normalized=(format??'').toLowerCase();if(normalized.includes('portrait')||normalized.includes('story'))return'portrait';if(normalized.includes('landscape')||platform==='linkedin'||platform==='google_business_profile')return'landscape';return'square'}
  private palette(brand:Record<string,any>,tenantId:string){const colors=(JSON.stringify(brand.brand_colors??[]).match(/#[0-9a-fA-F]{6}/g)??[]);if(colors.length>=2)return[colors[0]!,colors[1]!,colors[2]??'#f59e0b'];const digest=sha256(Buffer.from(tenantId));return[`#${digest.slice(0,6)}`,'#ffffff',`#${digest.slice(6,12)}`]}
  private font(brand:Record<string,any>){return this.stringArray(brand.fonts)[0]??'Inter, Arial, sans-serif'}
  private stringArray(value:unknown):string[]{return Array.isArray(value)?value.map(String):[]}
  private dataUri(bytes:Buffer,mime:string){return`data:${mime};base64,${bytes.toString('base64')}`}
  private visualScore(issues:VisualQaIssue[],assetConfidence:number,repetitionCount:number){const blocker=issues.some((issue)=>issue.severity==='blocker');const errors=issues.filter((issue)=>issue.severity==='error').length;return{brand_match:blocker?.45:.92,asset_relevance:Number(assetConfidence.toFixed(2)),layout_quality:Math.max(.4,.94-errors*.16),readability:Math.max(.35,.96-errors*.2),visual_novelty:Math.max(.45,.95-repetitionCount*.2),platform_fit:.93,text_density:issues.some((issue)=>issue.code==='BODY_TOO_LONG')?.5:.92,template_repetition:Math.max(.4,1-repetitionCount*.25),passed:!blocker&&errors===0}}
  private async recordComponentVersion(tenantId:string,variantId:string,component:string,value:unknown,reason:string,repairAction:string,userId:string){const previous=await this.db.serviceRest<Array<{version:number}>>(`/rest/v1/content_component_versions?select=version&tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&component=eq.${q(component)}&order=version.desc&limit=1`);await this.db.serviceRest(`/rest/v1/content_component_versions?tenant_id=eq.${q(tenantId)}&post_variant_id=eq.${q(variantId)}&component=eq.${q(component)}&is_current=eq.true`,{method:'PATCH',headers:jsonHeaders,body:jsonBody({is_current:false})});await this.db.serviceRest('/rest/v1/content_component_versions',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,post_variant_id:variantId,component,version:(previous[0]?.version??0)+1,value,reason,repair_action:repairAction,is_current:true,created_by:userId})});}
  private async logCost(tenantId:string,task:string,metadata:Record<string,unknown>){await this.db.serviceRest('/rest/v1/ai_usage_events',{method:'POST',headers:jsonHeaders,body:jsonBody({tenant_id:tenantId,task,provider:'mock',model:'deterministic-visual-v1',estimated_cost_microunits:0,metadata})})}
  private async uploadStorage(bucket:string,path:string,bytes:Buffer,mime:string,upsert=false){const response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}/${pathEncode(path)}`,{method:'POST',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`,'content-type':mime,'x-upsert':String(upsert)},body:bytes});if(!response.ok)throw new Error(`storage_upload_${response.status}:${await response.text()}`)}
  private async downloadStorage(bucket:string,path:string){const response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}/${pathEncode(path)}`,{headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`}});if(!response.ok)throw new Error(`storage_download_${response.status}`);return Buffer.from(await response.arrayBuffer())}
  private async deleteStorage(bucket:string,path:string){let response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}/${pathEncode(path)}`,{method:'DELETE',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`}});if(response.ok||response.status===404)return;response=await fetch(`${this.db.config.url}/storage/v1/object/${q(bucket)}`,{method:'DELETE',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`,'content-type':'application/json'},body:JSON.stringify({prefixes:[path]})});if(!response.ok&&response.status!==404)throw new Error(`storage_delete_${response.status}:${await response.text()}`)}
  private async sign(bucket:string,path:string){const response=await fetch(`${this.db.config.url}/storage/v1/object/sign/${q(bucket)}/${pathEncode(path)}`,{method:'POST',headers:{apikey:this.db.config.serviceRoleKey,authorization:`Bearer ${this.db.config.serviceRoleKey}`,'content-type':'application/json'},body:JSON.stringify({expiresIn:3600})});if(!response.ok)throw new Error(`storage_sign_${response.status}`);const body=await response.json() as {signedURL?:string;signedUrl?:string};const signed=body.signedURL??body.signedUrl;if(!signed)throw new Error('storage_sign_missing_url');return signed.startsWith('http')?signed:`${this.db.config.url}${signed}`}
}
