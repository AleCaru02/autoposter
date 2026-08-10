import { describe, expect, it } from 'vitest';
import { AssetSelectionEngine, DeterministicGraphicRenderer, DeterministicVisualDirector, deriveVisualTemplateProfile, visualFingerprint, type VisualAsset, type VisualPlatform } from '../src/visual-engine.js';

const platforms: VisualPlatform[]=['instagram','facebook','linkedin','google_business_profile'];
const asset=(tenantId:string,id:string,type:VisualAsset['assetType'],tags:string[]):VisualAsset=>({id,tenantId,assetType:type,mimeType:'image/svg+xml',filename:`${id}.svg`,tags,suitablePlatforms:platforms,suitableTopics:tags,qualityScore:.94,isBrandLocked:false,isPreferred:true,status:'ACTIVE',usageCount:0,lastUsedAt:null});
const palette=(seed:string)=>seed.includes('rosso')?['#7f1d1d','#ffffff','#f59e0b']:seed.includes('blu')?['#1e3a8a','#ffffff','#22d3ee']:seed.includes('verde')?['#14532d','#ffffff','#facc15']:seed.includes('casa')?['#334155','#ffffff','#38bdf8']:seed.includes('home')?['#3f3f46','#ffffff','#a3e635']:['#4c1d95','#ffffff','#fb7185'];

describe('visual anti-clone acceptance',()=>{
  it('keeps three pizzerias visually distinct by composite fingerprint, template profile, asset and palette',()=>{
    const tenants=[
      {id:'pizza-rosso',topic:'pizza margherita artigianale',asset:asset('pizza-rosso','pizza-a','food',['pizza','margherita'])},
      {id:'pizza-blu',topic:'offerta menu stagionale',asset:asset('pizza-blu','pizza-b','food',['menu','stagionale'])},
      {id:'pizza-verde',topic:'guida alla lunga lievitazione',asset:asset('pizza-verde','pizza-c','food',['impasto','lievitazione'])},
    ];
    const selector=new AssetSelectionEngine(),director=new DeterministicVisualDirector(),renderer=new DeterministicGraphicRenderer();
    const signatures=tenants.map((tenant,index)=>{
      const profile=deriveVisualTemplateProfile(tenant.id);
      const selection=selector.select({tenantId:tenant.id,topic:tenant.topic,pillar:index===2?'education':'prodotto',platform:'instagram',format:'square',brief:{objective:index===1?'promotion':'consideration',headline:`${tenant.topic} — ${tenant.id}`,supportingText:'Contenuto specifico del brand e del topic.',cta:index===1?'Prenota ora':'Scopri la storia'},assets:[tenant.asset],usage:[],now:'2026-08-10T06:30:00Z'});
      const direction=director.direct({tenantId:tenant.id,platform:'instagram',format:'square',topic:tenant.topic,brief:{objective:index===1?'promotion':'consideration',headline:`${tenant.topic} — ${tenant.id}`,supportingText:'Contenuto specifico del brand e del topic.',cta:index===1?'Prenota ora':'Scopri la storia'},selection,profile,recentFingerprints:[]});
      const colors=palette(tenant.id);
      const rendered=renderer.render({tenantId:tenant.id,platform:'instagram',format:'square',visualType:direction.visualType,templateKey:direction.templateKey,headline:direction.headline,supportingText:direction.supportingText,cta:direction.visualCta,palette:colors,fontFamily:'Inter',logoPosition:profile.logoPosition,forbiddenClaims:[]});
      return{assetId:selection.selectedAssetId,visualType:direction.visualType,template:direction.templateKey,layout:direction.layout,headline:direction.headline,cta:direction.visualCta,palette:colors[0],profile:JSON.stringify(profile),fingerprint:visualFingerprint({templateKey:direction.templateKey,visualType:direction.visualType,assetId:selection.selectedAssetId,headline:direction.headline,background:colors[0]!,ctaPosition:profile.logoPosition}),svg:rendered.svg};
    });
    expect(new Set(signatures.map(x=>x.fingerprint)).size).toBe(3);
    expect(new Set(signatures.map(x=>x.assetId)).size).toBe(3);
    expect(new Set(signatures.map(x=>x.profile)).size).toBe(3);
    expect(new Set(signatures.map(x=>x.palette)).size).toBe(3);
    expect(new Set(signatures.map(x=>x.headline)).size).toBe(3);
    expect(signatures.every(x=>x.svg.includes(x.palette))).toBe(true);
  });

  it('keeps three property managers visually distinct while selecting their own real property assets',()=>{
    const tenants=[
      {id:'casa-pm',topic:'soggiorno pronto per gli ospiti',a:asset('casa-pm','living-a','interior',['soggiorno','ospiti'])},
      {id:'home-pm',topic:'camera preparata per il check-in',a:asset('home-pm','room-b','interior',['camera','check-in'])},
      {id:'host-pm',topic:'facciata e arrivo degli ospiti',a:asset('host-pm','facade-c','exterior',['facciata','ospiti'])},
    ];
    const selector=new AssetSelectionEngine(),director=new DeterministicVisualDirector();
    const signatures=tenants.map((tenant)=>{const profile=deriveVisualTemplateProfile(tenant.id);const selection=selector.select({tenantId:tenant.id,topic:tenant.topic,pillar:'property management',platform:'facebook',format:'square',brief:{objective:'trust',headline:tenant.topic,supportingText:'Gestione professionale dell’immobile.',cta:'Scopri il servizio'},assets:[tenant.a],usage:[],now:'2026-08-10T06:30:00Z'});const direction=director.direct({tenantId:tenant.id,platform:'facebook',format:'square',topic:tenant.topic,brief:{objective:'trust',headline:tenant.topic,supportingText:'Gestione professionale dell’immobile.',cta:'Scopri il servizio'},selection,profile,recentFingerprints:[]});return{asset:selection.selectedAssetId,template:direction.templateKey,visualType:direction.visualType,headline:direction.headline,layout:direction.layout,profile:JSON.stringify(profile),fingerprint:visualFingerprint({templateKey:direction.templateKey,visualType:direction.visualType,assetId:selection.selectedAssetId,headline:direction.headline,background:palette(tenant.id)[0]!,ctaPosition:profile.logoPosition})}});
    expect(signatures.every(x=>x.asset)).toBe(true);
    expect(new Set(signatures.map(x=>x.asset)).size).toBe(3);
    expect(new Set(signatures.map(x=>x.fingerprint)).size).toBe(3);
    expect(new Set(signatures.map(x=>x.profile)).size).toBe(3);
  });
});
