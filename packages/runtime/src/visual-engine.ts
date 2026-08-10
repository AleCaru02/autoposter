export type VisualPlatform = 'instagram' | 'facebook' | 'linkedin' | 'google_business_profile';
export type VisualFormat = 'square' | 'portrait' | 'landscape';
export type AssetType = 'logo'|'logo_alt'|'product'|'service'|'property'|'food'|'team'|'person'|'interior'|'exterior'|'testimonial'|'screenshot'|'document'|'brochure'|'background'|'generic_photo'|'generated_visual';
export type VisualType = 'real_photo'|'photo_plus_overlay'|'branded_card'|'quote_card'|'testimonial'|'infographic'|'promotional'|'carousel'|'generated_image'|'no_visual';
export type TemplateKey = 'photo_full_bleed'|'photo_text_overlay'|'split_layout'|'minimal_brand_card'|'quote_testimonial'|'educational_tip'|'promotional'|'statistic_data'|'service_highlight'|'local_gbp';

export interface VisualAsset {
  id:string; tenantId:string; assetType:AssetType; mimeType:string|null; filename:string; tags:string[]; suitablePlatforms:VisualPlatform[]; suitableTopics:string[]; qualityScore:number; isBrandLocked:boolean; isPreferred:boolean; status:'ACTIVE'|'ARCHIVED'|'BLOCKED'; usageCount:number; lastUsedAt:string|null;
}
export interface AssetUsageSignal { assetId:string; templateKey?:string; visualType?:VisualType; usedAt:string; visualFingerprint?:string; }
export interface AssetClassification { assetType:AssetType; tags:string[]; qualityScore:number; suitablePlatforms:VisualPlatform[]; suitableTopics:string[]; }
export interface AssetClassifier { classify(input:{filename:string;mimeType:string;width:number|null;height:number|null}):AssetClassification; }
export interface AssetSelectionResult { decision:'real_asset'|'branded_graphic'|'generated_visual'; selectedAssetId:string|null; generatedVisualRequired:boolean; motivationCode:string; confidence:number; score:number; }
export interface VisualTemplateProfile { preferredTemplates:TemplateKey[]; spacing:'compact'|'balanced'|'airy'; imageRatio:'adaptive'|VisualFormat; textDensity:'low'|'medium'|'high'; logoPosition:'top_left'|'top_right'|'bottom_left'|'bottom_right'|'hidden'; borderStyle:'none'|'soft'|'strong'; ctaStyle:'pill'|'underline'|'boxed'|'minimal'; variantSeed:number; }
export interface VisualBrief { objective:string; headline:string; supportingText:string; cta:string; requiresPhotorealism?:boolean; carouselType?:'educational'|'checklist'|'mistakes'|'step_by_step'|'before_after'|'faq'|'tips'; }
export interface VisualDirection { visualType:VisualType; objective:string; selectedAssetIds:string[]; headline:string; supportingText:string; layout:string; emphasis:string; brandElements:string[]; visualCta:string; imagePrompt:string|null; accessibilityNotes:string[]; templateKey:TemplateKey; }
export interface VisualQaIssue { code:string; affectedComponent:'headline'|'supporting_text'|'cta'|'contrast'|'layout'|'template'|'fact_claim'; severity:'warning'|'error'|'blocker'; repairAction:string; }
export interface RenderSpec { tenantId:string; platform:VisualPlatform; format:VisualFormat; visualType:VisualType; templateKey:TemplateKey; headline:string; supportingText:string; cta:string; palette:string[]; fontFamily:string; assetDataUri?:string; logoDataUri?:string; logoPosition:VisualTemplateProfile['logoPosition']; forbiddenClaims:string[]; slideIndex?:number; totalSlides?:number; }
export interface RenderResult { status:'ready'|'qa_failed'; svg:string; width:number; height:number; issues:VisualQaIssue[]; fingerprint:string; }
export interface ImageGenerationRequest { tenantId:string; prompt:string; format:VisualFormat; forbiddenElements:string[]; referenceAssetIds:string[]; }
export interface ImageGenerationResult { provider:'mock'; assetType:'generated_visual'; mimeType:'image/svg+xml'; dataUri:string; promptHash:string; }
export interface ImageGenerationProvider { generate(input:ImageGenerationRequest):Promise<ImageGenerationResult>; edit(input:ImageGenerationRequest & {sourceAssetId:string}):Promise<ImageGenerationResult>; variation(input:ImageGenerationRequest & {sourceAssetId:string}):Promise<ImageGenerationResult>; }

const platforms:VisualPlatform[]=['instagram','facebook','linkedin','google_business_profile'];
const formatPresets:Record<VisualFormat,{width:number;height:number}>={square:{width:1080,height:1080},portrait:{width:1080,height:1350},landscape:{width:1200,height:630}};
export const visualFormatPresets=structuredClone(formatPresets);

const hashNumber=(value:string):number=>{let h=2166136261;for(let i=0;i<value.length;i+=1){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const words=(value:string)=>value.toLowerCase().replace(/[^a-z0-9à-ÿ]+/gi,' ').split(/\s+/).filter((item)=>item.length>2);
const escapeXml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const unique=<T,>(items:T[]):T[]=>[...new Set(items)];
const isoWeekAgo=(now:string)=>new Date(new Date(now).getTime()-7*86400000).toISOString();

export class DeterministicAssetClassifier implements AssetClassifier {
  classify(input:{filename:string;mimeType:string;width:number|null;height:number|null}):AssetClassification {
    const name=input.filename.toLowerCase(); const tokens=words(name);
    let assetType:AssetType='generic_photo';
    if(input.mimeType==='application/pdf') assetType=name.includes('brochure')||name.includes('menu')?'brochure':'document';
    else if(/logo|marchio/.test(name)) assetType=/alt|white|dark/.test(name)?'logo_alt':'logo';
    else if(/pizza|food|dish|piatto|menu|burger|pasta|cibo/.test(name)) assetType='food';
    else if(/room|camera|soggiorno|living|interior|interno/.test(name)) assetType='interior';
    else if(/facade|facciata|outside|exterior|esterno/.test(name)) assetType='exterior';
    else if(/team|staff|squadra/.test(name)) assetType='team';
    else if(/person|persona|founder|owner|ritratto|portrait/.test(name)) assetType='person';
    else if(/product|prodotto/.test(name)) assetType='product';
    else if(/property|immobile|appartamento|villa/.test(name)) assetType='property';
    else if(/testimonial|review|recensione/.test(name)) assetType='testimonial';
    else if(/screen|screenshot/.test(name)) assetType='screenshot';
    else if(/background|sfondo/.test(name)) assetType='background';
    const pixels=(input.width??0)*(input.height??0); const quality=pixels>=2_000_000?.95:pixels>=900_000?.86:pixels>0?.72:input.mimeType==='application/pdf'?.8:.68;
    const topicHints=unique([...tokens,assetType].filter((item)=>!['image','photo','img','file'].includes(item)));
    return {assetType,tags:topicHints,qualityScore:quality,suitablePlatforms:[...platforms],suitableTopics:topicHints};
  }
}

export class AssetSelectionEngine {
  select(input:{tenantId:string;topic:string;pillar:string;platform:VisualPlatform;format:VisualFormat;brief:VisualBrief;assets:VisualAsset[];usage:AssetUsageSignal[];now:string}):AssetSelectionResult {
    const recentCutoff=isoWeekAgo(input.now); const topicWords=unique([...words(input.topic),...words(input.pillar),...words(input.brief.headline)]);
    const candidates=input.assets.filter((asset)=>asset.tenantId===input.tenantId&&asset.status==='ACTIVE'&&asset.suitablePlatforms.includes(input.platform));
    const scored=candidates.map((asset)=>{
      const semantic=topicWords.filter((word)=>asset.tags.some((tag)=>tag.includes(word)||word.includes(tag))||asset.suitableTopics.some((tag)=>tag.includes(word)||word.includes(tag))).length;
      const foodBonus=/pizza|food|ristor|menu|margherita/.test(input.topic.toLowerCase())&&asset.assetType==='food'?48:0;
      const propertyBonus=/property|immobil|camera|soggiorno|appart/.test(`${input.topic} ${input.pillar}`.toLowerCase())&&['property','interior','exterior'].includes(asset.assetType)?42:0;
      const peopleBonus=/team|persona|network|founder|community/.test(`${input.topic} ${input.pillar}`.toLowerCase())&&['person','team'].includes(asset.assetType)?36:0;
      const recent=input.usage.filter((item)=>item.assetId===asset.id&&item.usedAt>=recentCutoff).length;
      const score=semantic*18+foodBonus+propertyBonus+peopleBonus+asset.qualityScore*24+(asset.isPreferred?15:0)+(asset.isBrandLocked?5:0)-recent*28-asset.usageCount*.6;
      return {asset,score};
    }).sort((a,b)=>b.score-a.score||a.asset.id.localeCompare(b.asset.id));
    const best=scored[0];
    if(best&&best.score>=48)return{decision:'real_asset',selectedAssetId:best.asset.id,generatedVisualRequired:false,motivationCode:best.score>=78?'REAL_ASSET_HIGH_RELEVANCE':'REAL_ASSET_ADAPTABLE',confidence:clamp(best.score/100),score:Math.round(best.score)};
    if(input.brief.requiresPhotorealism)return{decision:'generated_visual',selectedAssetId:null,generatedVisualRequired:true,motivationCode:'NO_RELEVANT_REAL_ASSET_PHOTO_REQUIRED',confidence:.72,score:0};
    return{decision:'branded_graphic',selectedAssetId:null,generatedVisualRequired:false,motivationCode:candidates.length?'REAL_ASSET_RELEVANCE_TOO_LOW':'NO_ACTIVE_ASSET',confidence:.82,score:best?Math.round(best.score):0};
  }
}

export const templateCatalog:Record<TemplateKey,{label:string;visualTypes:VisualType[]}>= {
  photo_full_bleed:{label:'Photo Full Bleed',visualTypes:['real_photo']},
  photo_text_overlay:{label:'Photo + Text Overlay',visualTypes:['photo_plus_overlay','real_photo']},
  split_layout:{label:'Split Layout',visualTypes:['photo_plus_overlay','service_highlight' as VisualType]},
  minimal_brand_card:{label:'Minimal Brand Card',visualTypes:['branded_card']},
  quote_testimonial:{label:'Quote/Testimonial',visualTypes:['quote_card','testimonial']},
  educational_tip:{label:'Educational Tip',visualTypes:['infographic','carousel','branded_card']},
  promotional:{label:'Promotional',visualTypes:['promotional','photo_plus_overlay']},
  statistic_data:{label:'Statistic/Data',visualTypes:['infographic','branded_card']},
  service_highlight:{label:'Service Highlight',visualTypes:['branded_card','photo_plus_overlay']},
  local_gbp:{label:'Local/Google Business Profile',visualTypes:['real_photo','photo_plus_overlay','branded_card']},
};

export const deriveVisualTemplateProfile=(tenantId:string):VisualTemplateProfile=>{const seed=hashNumber(tenantId);const all=Object.keys(templateCatalog) as TemplateKey[];const start=seed%all.length;return{preferredTemplates:[all[start]!,all[(start+3)%all.length]!,all[(start+6)%all.length]!],spacing:(['compact','balanced','airy'] as const)[seed%3]!,imageRatio:'adaptive',textDensity:(['low','medium','high'] as const)[Math.floor(seed/3)%3]!,logoPosition:(['top_left','top_right','bottom_left','bottom_right'] as const)[Math.floor(seed/7)%4]!,borderStyle:(['none','soft','strong'] as const)[Math.floor(seed/11)%3]!,ctaStyle:(['pill','underline','boxed','minimal'] as const)[Math.floor(seed/13)%4]!,variantSeed:seed};};

export class DeterministicVisualDirector {
  direct(input:{tenantId:string;platform:VisualPlatform;format:VisualFormat;topic:string;brief:VisualBrief;selection:AssetSelectionResult;profile:VisualTemplateProfile;recentFingerprints:string[]}):VisualDirection {
    let visualType:VisualType;
    if(input.brief.carouselType) visualType='carousel';
    else if(input.selection.decision==='real_asset') visualType=input.platform==='instagram'&&/pizza|food|property|interior|camera/.test(input.topic.toLowerCase())?'real_photo':'photo_plus_overlay';
    else if(input.selection.decision==='generated_visual') visualType='generated_image';
    else if(/quote|testimonial|recensione/.test(input.topic.toLowerCase())) visualType='quote_card';
    else if(/promo|offerta|prenota|sconto/.test(`${input.topic} ${input.brief.objective}`.toLowerCase())) visualType='promotional';
    else if(/tip|guida|errore|step|checklist|come /.test(input.topic.toLowerCase())) visualType='infographic';
    else visualType='branded_card';
    const compatible=(Object.keys(templateCatalog) as TemplateKey[]).filter((key)=>templateCatalog[key].visualTypes.includes(visualType)||(input.platform==='google_business_profile'&&key==='local_gbp'));
    const ordered=unique([...input.profile.preferredTemplates,...compatible]).filter((key)=>compatible.includes(key));
    const fallback=compatible[0]??'minimal_brand_card'; let templateKey=ordered[0]??fallback;
    for(const candidate of ordered){const probe=`${candidate}|${visualType}|${headlineShape(input.brief.headline)}`;if(!input.recentFingerprints.some((fp)=>fp.includes(probe))){templateKey=candidate;break}}
    return{visualType,objective:input.brief.objective,selectedAssetIds:input.selection.selectedAssetId?[input.selection.selectedAssetId]:[],headline:input.brief.headline,supportingText:input.brief.supportingText,layout:templateKey,emphasis:input.profile.textDensity==='low'?'image':'balanced',brandElements:['palette','font','logo'],visualCta:input.brief.cta,imagePrompt:input.selection.generatedVisualRequired?'required':null,accessibilityNotes:['Maintain safe area','Keep text legible at mobile size','Provide alt text'],templateKey};
  }
}

const headlineShape=(headline:string)=>`${words(headline).length}-${headline.length>42?'long':'short'}`;
const rgb=(hex:string):[number,number,number]=>{const clean=hex.replace('#','');const full=clean.length===3?clean.split('').map((c)=>c+c).join(''):clean;const value=parseInt(full,16);return[(value>>16)&255,(value>>8)&255,value&255]};
const luminance=(hex:string)=>{const [r,g,b]=rgb(hex).map((c)=>{const s=c/255;return s<=.03928?s/12.92:Math.pow((s+.055)/1.055,2.4)});return .2126*r+.7152*g+.0722*b};
export const contrastRatio=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const wrap=(text:string,max:number)=>{const ws=text.trim().split(/\s+/).filter(Boolean);const lines:string[]=[];let line='';for(const word of ws){const next=line?`${line} ${word}`:word;if(next.length>max&&line){lines.push(line);line=word}else line=next}if(line)lines.push(line);return lines};

export const visualFingerprint=(input:{templateKey:TemplateKey;visualType:VisualType;assetId:string|null;headline:string;background:string;ctaPosition:string})=>`${input.templateKey}|${input.visualType}|${input.assetId??'none'}|${headlineShape(input.headline)}|${input.background}|${input.ctaPosition}`;

export class DeterministicGraphicRenderer {
  validate(spec:RenderSpec):VisualQaIssue[]{const issues:VisualQaIssue[]=[];const bg=spec.palette[0]??'#111111';const fg=spec.palette[1]??'#ffffff';if(spec.headline.length>72)issues.push({code:'HEADLINE_TOO_LONG',affectedComponent:'headline',severity:'error',repairAction:'shorten_headline'});if(spec.supportingText.length>190)issues.push({code:'BODY_TOO_LONG',affectedComponent:'supporting_text',severity:'error',repairAction:'shorten_supporting_text'});if(spec.cta.length>40)issues.push({code:'CTA_TOO_LONG',affectedComponent:'cta',severity:'warning',repairAction:'shorten_cta'});if(contrastRatio(bg,fg)<4.5)issues.push({code:'LOW_CONTRAST',affectedComponent:'contrast',severity:'error',repairAction:'use_accessible_palette'});const lower=`${spec.headline} ${spec.supportingText}`.toLowerCase();for(const claim of spec.forbiddenClaims.filter(Boolean)){if(lower.includes(claim.toLowerCase()))issues.push({code:'FORBIDDEN_FACT_CLAIM',affectedComponent:'fact_claim',severity:'blocker',repairAction:'remove_unverified_claim'})}return issues;}
  render(spec:RenderSpec):RenderResult {const preset=formatPresets[spec.format];const issues=this.validate(spec);const bg=spec.palette[0]??'#111827',fg=spec.palette[1]??'#ffffff',accent=spec.palette[2]??'#f59e0b';const safe=Math.round(preset.width*.07);const headlineLines=wrap(spec.headline,spec.format==='landscape'?34:26).slice(0,4);const bodyLines=wrap(spec.supportingText,spec.format==='landscape'?55:38).slice(0,5);const photo=spec.assetDataUri?`<image href="${escapeXml(spec.assetDataUri)}" x="0" y="0" width="${preset.width}" height="${preset.height}" preserveAspectRatio="xMidYMid slice"/>`:'';const overlay=spec.assetDataUri?`<rect width="100%" height="100%" fill="${bg}" opacity="0.48"/>`:'';const imageMode=['photo_full_bleed','photo_text_overlay','promotional','local_gbp'].includes(spec.templateKey);const split=spec.templateKey==='split_layout';const cardX=split?Math.round(preset.width*.52):safe;const cardW=split?Math.round(preset.width*.41):preset.width-safe*2;const contentY=Math.round(preset.height*.24);const logoAnchor=spec.logoPosition.includes('right')?'end':'start';const logoX=spec.logoPosition.includes('right')?preset.width-safe:safe;const logoY=spec.logoPosition.includes('bottom')?preset.height-safe:Math.round(safe*.9);const logo=spec.logoDataUri&&spec.logoPosition!=='hidden'?`<image href="${escapeXml(spec.logoDataUri)}" x="${logoAnchor==='end'?logoX-160:logoX}" y="${spec.logoPosition.includes('bottom')?logoY-64:logoY}" width="160" height="64" preserveAspectRatio="xMidYMid meet"/>`:'';const headlineSvg=headlineLines.map((line,i)=>`<text x="${cardX}" y="${contentY+i*68}" font-family="${escapeXml(spec.fontFamily)}" font-size="58" font-weight="760" fill="${fg}">${escapeXml(line)}</text>`).join('');const bodyStart=contentY+headlineLines.length*68+36;const bodySvg=bodyLines.map((line,i)=>`<text x="${cardX}" y="${bodyStart+i*42}" font-family="${escapeXml(spec.fontFamily)}" font-size="30" fill="${fg}" opacity="0.94">${escapeXml(line)}</text>`).join('');const ctaY=Math.min(preset.height-safe-54,bodyStart+bodyLines.length*42+62);const cta=`<rect x="${cardX}" y="${ctaY-42}" width="${Math.min(cardW,Math.max(190,spec.cta.length*20+62))}" height="62" rx="31" fill="${accent}"/><text x="${cardX+28}" y="${ctaY}" font-family="${escapeXml(spec.fontFamily)}" font-size="25" font-weight="700" fill="#111111">${escapeXml(spec.cta)}</text>`;const splitPhoto=split&&spec.assetDataUri?`<image href="${escapeXml(spec.assetDataUri)}" x="0" y="0" width="${Math.round(preset.width*.47)}" height="${preset.height}" preserveAspectRatio="xMidYMid slice"/>`:'';const slide=`${spec.totalSlides&&spec.totalSlides>1?`<text x="${preset.width-safe}" y="${preset.height-safe}" text-anchor="end" font-family="${escapeXml(spec.fontFamily)}" font-size="22" fill="${fg}" opacity=".75">${(spec.slideIndex??0)+1}/${spec.totalSlides}</text>`:''}`;const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${preset.width}" height="${preset.height}" viewBox="0 0 ${preset.width} ${preset.height}"><rect width="100%" height="100%" fill="${bg}"/>${imageMode?photo:''}${imageMode?overlay:''}${splitPhoto}<rect x="${split?cardX-safe/2:0}" y="0" width="${split?cardW+safe:0}" height="${preset.height}" fill="${split?bg:'none'}"/>${headlineSvg}${bodySvg}${spec.cta?cta:''}${logo}${slide}</svg>`;const fingerprint=visualFingerprint({templateKey:spec.templateKey,visualType:spec.visualType,assetId:null,headline:spec.headline,background:bg,ctaPosition:'bottom_content'});return{status:issues.some((issue)=>issue.severity==='blocker'||issue.severity==='error')?'qa_failed':'ready',svg,width:preset.width,height:preset.height,issues,fingerprint};}
}

export class MockImageGenerationProvider implements ImageGenerationProvider {
  async generate(input:ImageGenerationRequest):Promise<ImageGenerationResult>{return this.make(input,'generate')}
  async edit(input:ImageGenerationRequest&{sourceAssetId:string}):Promise<ImageGenerationResult>{return this.make(input,`edit:${input.sourceAssetId}`)}
  async variation(input:ImageGenerationRequest&{sourceAssetId:string}):Promise<ImageGenerationResult>{return this.make(input,`variation:${input.sourceAssetId}`)}
  private async make(input:ImageGenerationRequest,mode:string):Promise<ImageGenerationResult>{const preset=formatPresets[input.format];const h=hashNumber(`${input.tenantId}|${input.prompt}|${mode}`);const a=`#${((h&0xffffff)|0x303030).toString(16).slice(-6)}`,b=`#${(((h>>>3)&0xffffff)|0x505050).toString(16).slice(-6)}`;const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${preset.width}" height="${preset.height}"><defs><linearGradient id="g"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="75%" cy="25%" r="180" fill="#fff" opacity=".16"/><path d="M0 ${preset.height*.72} Q ${preset.width*.45} ${preset.height*.45} ${preset.width} ${preset.height*.68} V ${preset.height} H0Z" fill="#fff" opacity=".12"/></svg>`;return{provider:'mock',assetType:'generated_visual',mimeType:'image/svg+xml',dataUri:`data:image/svg+xml;base64,${toBase64(svg)}`,promptHash:String(h)}}
}

const toBase64=(value:string)=>{const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';const bytes=new TextEncoder().encode(value);let out='';for(let i=0;i<bytes.length;i+=3){const a=bytes[i]??0,b=bytes[i+1]??0,c=bytes[i+2]??0;const triple=(a<<16)|(b<<8)|c;out+=alphabet[(triple>>18)&63]+alphabet[(triple>>12)&63]+(i+1<bytes.length?alphabet[(triple>>6)&63]:'=')+(i+2<bytes.length?alphabet[triple&63]:'=')}return out};

export class ImagePromptBuilder { build(input:{brandName:string;visualBrief:VisualBrief;content:string;platform:VisualPlatform;style:string;forbiddenElements:string[];assetReferences:string[];photographicDirection:string}):{prompt:string;forbiddenElements:string[];referenceAssetIds:string[]}{const forbidden=unique(['invented logos','unverified products','fake customer testimonials','text embedded in photography',...input.forbiddenElements]);return{prompt:`Brand: ${input.brandName}. Objective: ${input.visualBrief.objective}. Subject: ${input.content}. Platform: ${input.platform}. Style: ${input.style}. Direction: ${input.photographicDirection}. No invented brand marks or factual claims.`,forbiddenElements:forbidden,referenceAssetIds:[...input.assetReferences]};} }

export interface RepairableVariant { hook:string;caption:string;hashtags:string[];cta:string;visual:{templateKey:TemplateKey;headline:string;supportingText:string}; }
export type RepairComponent='hook'|'caption'|'hashtags'|'cta'|'visual';
export class SelectiveQaRepairEngine { repair(input:{component:RepairComponent;variant:RepairableVariant;issueCode:string;variantSeed:number}):{variant:RepairableVariant;repairAction:string}{const next=structuredClone(input.variant);let action='';if(input.component==='hook'){next.hook=shorten(next.hook,64)||'Un punto concreto da conoscere';action='rewrite_hook_only'}else if(input.component==='caption'){next.caption=shorten(next.caption,420);action='shorten_caption_only'}else if(input.component==='hashtags'){next.hashtags=unique(next.hashtags.map((tag)=>tag.startsWith('#')?tag:`#${tag.replace(/\s+/g,'')}`)).slice(0,8);action='replace_hashtags_only'}else if(input.component==='cta'){next.cta=shorten(next.cta,34)||'Scopri di più';action='rewrite_cta_only'}else{const keys=Object.keys(templateCatalog) as TemplateKey[];const current=keys.indexOf(next.visual.templateKey);next.visual.templateKey=keys[(Math.max(0,current)+1+input.variantSeed%3)%keys.length]!;next.visual.headline=shorten(next.visual.headline,68);next.visual.supportingText=shorten(next.visual.supportingText,150);action=input.issueCode==='TEMPLATE_REPETITION'?'rotate_template_only':'repair_visual_only'}return{variant:next,repairAction:action};} }
const shorten=(value:string,max:number)=>value.trim().length<=max?value.trim():`${value.trim().slice(0,Math.max(1,max-1)).replace(/[\s,.;:!-]+$/,'')}…`;

export const buildCarouselSlides=(input:{type:NonNullable<VisualBrief['carouselType']>;headline:string;supportingText:string;cta:string}):Array<{slideIndex:number;headline:string;body:string;layout:string;visualType:VisualType}>=>{const count=input.type==='before_after'?4:5;return Array.from({length:count},(_,index)=>({slideIndex:index,headline:index===0?input.headline:index===count-1?'Prossimo passo':`${index}. ${carouselLabel(input.type,index)}`,body:index===count-1?input.cta:shorten(input.supportingText,130),layout:index===0?'cover':index===count-1?'cta':'content',visualType:'carousel'}));};
const carouselLabel=(type:NonNullable<VisualBrief['carouselType']>,index:number)=>({educational:'Idea chiave',checklist:'Controllo',mistakes:'Errore da evitare',step_by_step:'Passaggio',before_after:index===1?'Prima':'Dopo',faq:'Domanda frequente',tips:'Suggerimento'}[type]);
