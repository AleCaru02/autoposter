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