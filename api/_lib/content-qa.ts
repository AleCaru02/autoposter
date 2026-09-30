import { neon } from "@neondatabase/serverless";
import { ActivityBudgetEngine } from "./activity-budget.js";
import { findNearDuplicate, type ContentDedupeCandidate } from "./content-dedupe.js";
import { EntitlementUsageService } from "./entitlement-usage.js";
import { runOpenAIEditorialQA } from "./openai-editorial-qa.js";
import { contentNeedsFactCheck, runOpenAIFactCheckAgent, type FactCheckAgentResult } from "./openai-research-factcheck.js";
import { runOpenAIVisualQa, type OpenAIVisualQaResult } from "./openai-visual-qa.js";
import { estimateTerraCostUsd, type GeneratedCarouselSlide, type GeneratedSocialContent, type GeneratedVariant, type SocialFormat, type SocialProvider } from "./openai-text.js";
import { loadEditorialProfile, loadProfileBrandContext } from "./personal-brand-sources.js";
import { providerCapabilities } from "./social.js";

export type ContentQaStatus = "PASS" | "FAIL" | "NEEDS_SOURCE";
export type ContentQaCheckStatus = ContentQaStatus | "SKIP";

export type CarouselSlideQaResult = {
  slideId: string;
  slideNumber: number;
  copyStatus: ContentQaStatus;
  visualStatus: ContentQaStatus;
  factStatus: ContentQaStatus;
  brandStatus: ContentQaStatus;
  qualityStatus: ContentQaStatus;
  reason: string;
};

export type ContentQaResult = {
  runId: string;
  profileId: string;
  contentId: string;
  variantId: string;
  fingerprint: string;
  cached: boolean;
  overallStatus: ContentQaStatus;
  brandStatus: ContentQaStatus;
  copyStatus: ContentQaStatus;
  visualStatus: ContentQaStatus;
  factStatus: ContentQaStatus;
  platformStatus: ContentQaStatus;
  duplicateStatus: ContentQaStatus;
  budgetStatus: ContentQaStatus;
  reason: string;
  slides: CarouselSlideQaResult[];
  checkedAt: string;
  details: Record<string,unknown>;
};

type Sql=ReturnType<typeof neon>;

type ContentItemRow={
  id:string;profile_id:string;topic:string;objective:string|null;title:string|null;pillar:string|null;
  source_refs:unknown;fact_provenance:unknown;decision_record:unknown;
};
type VariantRow={
  id:string;content_id:string;profile_id:string;provider:SocialProvider;format:SocialFormat;eligible:boolean;
  hook:string|null;caption:string|null;cta:string|null;hashtags:unknown;visual_brief:string|null;alt_text:string|null;
  image_asset_id:string|null;approval_status:string;factual_basis:unknown;qa_status:ContentQaStatus|"PENDING";
  qa_fingerprint:string|null;qa_result:unknown;visual_identity_qa_status:string|null;
};
type SlideRow={
  id:string;profile_id:string;content_id:string;variant_id:string;position:number;purpose:string;headline:string;body:string;
  hierarchy:string;visual_brief:string;alt_text:string;asset_id:string|null;width:number;height:number;qa_status:string;updated_at:string;
};
type AssetRow={
  id:string;profile_id:string;kind:string;storage_url:string;mime_type:string|null;provider:string|null;model:string|null;
  width:number|null;height:number|null;format:string|null;quality_status:string;identity_status:string;metadata:unknown;updated_at:string;
};
type RecentRow={id:string;topic:string;title:string|null;hook:string|null;caption:string|null};

function object(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function stringArray(value:unknown){return Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];}

function stable(value:unknown):string{
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
  const obj=value as Record<string,unknown>;
  return `{${Object.keys(obj).sort().map((key)=>`${JSON.stringify(key)}:${stable(obj[key])}`).join(",")}}`;
}
async function sha256(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}

function externalSources(sourceRefs:unknown){
  if(!Array.isArray(sourceRefs))return [];
  return [...new Set(sourceRefs.flatMap((ref)=>{
    const row=object(ref);
    return row.type==="EXTERNAL_SOURCE"&&typeof row.url==="string"?[row.url]:[];
  }))].slice(0,20);
}

function normalizeFactStatus(result:FactCheckAgentResult):ContentQaStatus{
  if(result.verdict==="PASS")return "PASS";
  if(result.verdict==="NEEDS_SOURCE")return "NEEDS_SOURCE";
  return "FAIL";
}

function factStatusForSlide(result:FactCheckAgentResult,slideNumber:number):ContentQaStatus{
  const claims=result.checkedClaims.filter((claim)=>claim.slideNumber===slideNumber);
  if(!claims.length)return "PASS";
  if(claims.some((claim)=>claim.status==="CONTRADICTED"))return "FAIL";
  if(claims.some((claim)=>claim.status==="UNSUPPORTED"&&(claim.claimType==="BRAND"||claim.claimType==="INTERNAL")))return "FAIL";
  if(claims.some((claim)=>claim.sourceRequired&&(claim.status==="UNSUPPORTED"||claim.status==="TIME_SENSITIVE")))return "NEEDS_SOURCE";
  return "PASS";
}

function combine(statuses:ContentQaStatus[]):ContentQaStatus{
  if(statuses.includes("FAIL"))return "FAIL";
  if(statuses.includes("NEEDS_SOURCE"))return "NEEDS_SOURCE";
  return "PASS";
}

function expectedAspect(format:SocialFormat){return format==="STORY"?"2:3":"1:1";}

function platformRuntimeSupports(provider:SocialProvider,format:SocialFormat){
  return (providerCapabilities(provider).publish as readonly string[]).includes(format);
}

function visualIdentityStatus(profileType:string,asset:AssetRow|null,variant:VariantRow){
  if(!asset)return "FAIL" as const;
  if(profileType!=="PERSONAL_BRAND")return "PASS" as const;
  if(asset.provider!=="HIGGSFIELD")return asset.identity_status==="BLOCK"?"FAIL" as const:"PASS" as const;
  if(asset.identity_status==="PASS"||variant.visual_identity_qa_status==="PASS")return "PASS" as const;
  return "FAIL" as const;
}

function visualTechnicalStatus(asset:AssetRow|null,format:SocialFormat){
  if(!asset||asset.kind!=="IMAGE"||!asset.storage_url)return "FAIL" as const;
  if(asset.quality_status==="BLOCK"||asset.quality_status==="FAILED")return "FAIL" as const;
  if(!asset.width||!asset.height||asset.width<=0||asset.height<=0)return "FAIL" as const;
  if(asset.format&&asset.format!==expectedAspect(format))return "FAIL" as const;
  return "PASS" as const;
}

function visualStatus(result:OpenAIVisualQaResult|null,technical:"PASS"|"FAIL",identity:"PASS"|"FAIL"){
  return technical==="PASS"&&identity==="PASS"&&result?.verdict==="PASS"?"PASS" as const:"FAIL" as const;
}

async function recentContent(sql:Sql,profileId:string,contentId:string){
  return await sql`
    select ci.id::text,ci.topic,ci.title,cv.hook,cv.caption
    from public.content_items ci
    join lateral (
      select hook,caption from public.content_variants
      where content_id=ci.id and profile_id=ci.profile_id
      order by created_at asc limit 1
    ) cv on true
    where ci.profile_id=${profileId}::uuid and ci.id<>${contentId}::uuid
    order by ci.created_at desc limit 40
  ` as unknown as RecentRow[];
}

function asGenerated(item:ContentItemRow,variant:VariantRow,slides:SlideRow[]):{content:GeneratedSocialContent;variant:GeneratedVariant}{
  const carouselSlides:GeneratedCarouselSlide[]=slides.map((slide)=>({
    position:slide.position,purpose:slide.purpose,headline:slide.headline,body:slide.body,hierarchy:slide.hierarchy,
    visualBrief:slide.visual_brief,altText:slide.alt_text,
  }));
  const generatedVariant:GeneratedVariant={
    provider:variant.provider,format:variant.format,eligible:variant.eligible,hook:variant.hook??"",caption:variant.caption??"",
    cta:variant.cta,hashtags:stringArray(variant.hashtags),visualBrief:variant.visual_brief??"",altText:variant.alt_text??"",
    factualBasis:stringArray(variant.factual_basis),carouselSlides:variant.format==="CAROUSEL"?carouselSlides:[],
  };
  const decision=object(item.decision_record);
  return {
    variant:generatedVariant,
    content:{
      editorialTopic:item.topic,
      pillar:item.pillar??undefined,
      editorialAngle:item.title??item.topic,
      strategySummary:typeof decision.strategySummary==="string"?decision.strategySummary:item.title??item.topic,
      variants:[generatedVariant],
    },
  };
}

async function persist(sql:Sql,input:{
  result:ContentQaResult;actorType:"MANUAL"|"AUTOPILOT"|"SYSTEM";
}){
  const r=input.result;
  await sql`select public.persist_content_qa_result(
    ${r.profileId}::uuid,${r.contentId}::uuid,${r.variantId}::uuid,${r.runId}::uuid,${r.fingerprint},
    ${r.overallStatus},${r.brandStatus},${r.copyStatus},${r.visualStatus},${r.factStatus},${r.platformStatus},
    ${r.duplicateStatus},${r.budgetStatus},${r.reason},${JSON.stringify(r.details)}::jsonb,${input.actorType},
    ${JSON.stringify(r.slides)}::jsonb
  )`;
}

function cachedResult(row:VariantRow,fingerprint:string):ContentQaResult|null{
  if(row.qa_fingerprint!==fingerprint||row.qa_status==="PENDING")return null;
  const qa=object(row.qa_result);
  const result=object(qa.result