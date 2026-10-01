import { neon } from "@neondatabase/serverless";
import { findEditorialRepetition, findNearDuplicate, semanticContentSimilarity, type ContentDedupeCandidate } from "./content-dedupe.js";
import { buildAutopilotPillarInstruction } from "./editorial-intelligence.js";
import { normalizeEditorialResearchMode } from "./editorial-research.js";
import { buildPlanDrivenTopicRequest, selectPlanItem } from "./autopilot-ai-plan.js";
import { runOpenAIEditorialQA } from "./openai-editorial-qa.js";
import { runContentQa } from "./content-qa.js";
import { estimateTextRequestUpperBoundUsd, generateSocialText, OpenAITextPipelineError, type BrandContext, type SocialFormat, type SocialProvider } from "./openai-text.js";
import type { ImageSocialFormat, ImageSocialProvider } from "./openai-image.js";
import { generateRoutedImage } from "./routed-image.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "./image-generation-metering.js";
import { TextGenerationMetering, technicalEventsFromTextResult, type TechnicalAiEvent } from "./text-generation-metering.js";
import type { ContentType } from "./content-agents.js";
import { buildAutopilotLearningInstruction, learnedFormatPreference, learnedTimingPreference, usableLearningDecisions, type LearnedTimingPreference, type PersistedLearningInsight } from "./learning-guidance.js";
import { ActivityBudgetEngine } from "./activity-budget.js";
import { assetContentHashFromBase64, findReusableAsset, visualFingerprint, type ReusableAssetCandidate } from "./asset-intelligence.js";
import { decideMasterEditorial, type MasterEditorialDecision } from "./master-editorial-brain.js";
import { buildPersonalBrandEditorialContext, loadProfileBrandContext, resolvePersonalBrandSource, type PersonalBrandSourceRelation } from "./personal-brand-sources.js";
import { higgsfieldConfigured } from "./higgsfield.js";
import { decideVisualRuntime } from "./visual-runtime-decision.js";
import { buildEditorialMemoryInstruction, deriveContinuityDecision, refreshProfileEditorialMemory } from "./editorial-memory.js";
import { chooseSubjectStrategy, profileTypeStrategyInstruction } from "./subject-strategy.js";
import { normalizeBrandVisualIdentity } from "./brand-visual-identity.js";
import { selectAutonomousFormat } from "./format-selection.js";

export type ApprovalMode = "MANUAL_REVIEW" | "AUTOMATIC";
export type AutopilotEnv = { DATABASE_URL?: string; OPENAI_API_KEY?: string; OPENAI_TEXT_MONTHLY_BUDGET_USD?: string; OPENAI_IMAGE_MONTHLY_LIMIT?: string; HF_CREDENTIALS?: string };

function createSql(connectionString: string) { return neon(connectionString); }
type Sql = ReturnType<typeof createSql>;
type ProfileRow = { id: string; name: string; website_url: string | null; industry: string | null; timezone: string; profile_type: "BUSINESS" | "PERSONAL_BRAND"; owner_auth_user_id: string };
type BrandRow = { description: string | null; business_model: string | null; location: string | null; service_area: string | null; target_audience: unknown; tone_of_voice: unknown; goals: unknown; visual_identity: unknown };
type StrategyRow = { objectives: unknown; platform_strategy: unknown };
export type AutopilotSchedule = { provider: SocialProvider; timezone: string; posts_per_week: number; preferred_slots: unknown; auto_choose: boolean; enabled: boolean };
type ScheduleRow = AutopilotSchedule;
type PreferredSlot = { day: number; time: string };
export type AutopilotCandidateSlot = { scheduledAt: string; timingSource: "USER_CONFIG" | "LEARNING" | "STRATEGY" | "DEFAULT" };
type PageRow = { url: string; title: string | null; content_text: string | null };
type JobRow = { provider: SocialProvider; scheduled_at: string };
type RecentItemRow = { topic: string };
type RecentContentRow = { id: string; topic: string; title: string | null; pillar: string | null; visual_archetype: string | null; subject_strategy: string | null; narrative_structure: string | null; hook: string | null; caption: string | null; cta: string | null };
type CountRow = { count: number | string };
type SpendRow = { spend: number | string | null };
type RunOptions = { profileId?: string; maxGenerations?: number; allowImageGeneration?: boolean };
type RunResult = { profilesChecked: number; generated: number; scheduled: number; blockedForReview: number; skipped: number; errors: string[] };

const AUTO_QA_RESERVE_USD = 0.03;
const MAX_PROFILES_PER_RUN = 100;
const DEFAULT_GENERATIONS_PER_RUN = 12;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_SCHEDULES: Array<{ provider: SocialProvider; posts: number }> = [
  { provider: "INSTAGRAM", posts: 2 }, { provider: "FACEBOOK", posts: 1 }, { provider: "LINKEDIN", posts: 1 }, { provider: "GBP", posts: 1 },
];
const PROVIDER_BASE_TIME: Record<SocialProvider, string> = { INSTAGRAM: "18:00", FACEBOOK: "12:30", LINKEDIN: "09:00", GBP: "10:00" };
const PROVIDER_OFFSET: Record<SocialProvider, number> = { INSTAGRAM: 0, FACEBOOK: 1, LINKEDIN: 2, GBP: 3 };
export const AUTOPILOT_PUBLISH_FORMATS: Record<SocialProvider, SocialFormat[]> = { INSTAGRAM: ["POST","STORY"], FACEBOOK: ["POST"], LINKEDIN: ["POST"], GBP: ["POST"] };

function asObject(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function summary(value: unknown) { const text = asObject(value).summary; return typeof text === "string" && text.trim() ? text.trim() : null; }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : []; }
function stringSignals(value: unknown, max = 16) {
  const result: string[] = [];
  const seen = new Set<string>();
  const visit = (current: unknown, depth: number) => {
    if (result.length >= max || depth > 3 || current == null) return;
    if (typeof current === "string") {
      const cleaned = current.trim();
      if (cleaned && !seen.has(cleaned)) { seen.add(cleaned); result.push(cleaned); }
      return;
    }
    if (Array.isArray(current)) { for (const item of current) visit(item, depth + 1); return; }
    if (typeof current === "object") { for (const item of Object.values(current as Record<string, unknown>)) visit(item, depth + 1); }
  };
  visit(value, 0);
  return result;
}
function normalizeSlots(value: unknown): PreferredSlot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>(); const slots: PreferredSlot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const day = Number((item as Record<string, unknown>).day); const time = String((item as Record<string, unknown>).time ?? "");
    if (!Number.isInteger(day) || day < 1 || day > 7 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    const key = `${day}:${time}`; if (seen.has(key)) continue; seen.add(key); slots.push({ day, time });
  }
  return slots.sort((a,b) => a.day - b.day || a.time.localeCompare(b.time));
}
function monthStartIso() { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString(); }
function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23" }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year:pick("year"),month:pick("month"),day:pick("day"),hour:pick("hour"),minute:pick("minute"),second:pick("second") };
}
function offsetAt(timestamp: number, timeZone: string) { const p=zonedParts(new Date(timestamp),timeZone); return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(timestamp/1000)*1000; }
function zonedLocalToIso(localValue: string,timeZone:string) {
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue); if(!match) throw new Error("INVALID_LOCAL_DATETIME");
  const [,y,m,d,h,min]=match; const localAsUtc=Date.UTC(Number(y),Number(m)-1,Number(d),Number(h),Number(min),0); let instant=localAsUtc-offsetAt(localAsUtc,timeZone); instant=localAsUtc-offsetAt(instant,timeZone);
  const r=zonedParts(new Date(instant),timeZone); if(r.year!==Number(y)||r.month!==Number(m)||r.day!==Number(d)||r.hour!==Number(h)||r.minute!==Number(min)) throw new Error("NON_EXISTENT_LOCAL_TIME"); return new Date(instant).toISOString();
}
function localDateKey(date: Date, timezone: string) { const p=zonedParts(date,timezone); return `${p.year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`; }
function isoWeekdayFromLocalDate(key:string) { const [y,m,d]=key.split("-").map(Number); const day=new Date(Date.UTC(y,m-1,d)).getUTCDay(); return day===0?7:day; }
function uniqueFutureLocalDates(now:Date,timezone:string,count=14) { const keys:string[]=[]; const seen=new Set<string>(); for(let i=0;keys.length<count&&i<count+5;i+=1){const key=localDateKey(new Date(now.getTime()+i*DAY_MS),timezone);if(!seen.has(key)){seen.add(key);keys.push(key);}} return keys; }
export function candidateSlots(schedule:AutopilotSchedule,now=new Date(),learned:LearnedTimingPreference|null=null):AutopilotCandidateSlot[] {
  const target=Math.min(Math.max(Math.floor(Number(schedule.posts_per_week)||0),0),21); if(!target) return [];
  const timezone=schedule.timezone||"Europe/Rome"; const dates=uniqueFutureLocalDates(now,timezone,14); const preferred=normalizeSlots(schedule.preferred_slots); const candidates:AutopilotCandidateSlot[]=[];
  const add=(date:string,time:string,source:AutopilotCandidateSlot["timingSource"])=>{try{const scheduledAt=zonedLocalToIso(`${date}T${time}`,timezone);if(new Date(scheduledAt).getTime()>now.getTime()+HOUR_MS&&!candidates.some((item)=>item.scheduledAt===scheduledAt))candidates.push({scheduledAt,timingSource:source});}catch{}};
  if(preferred.length){for(const date of dates){const weekday=isoWeekdayFromLocalDate(date);for(const slot of preferred){if(slot.day===weekday)add(date,slot.time,"USER_CONFIG");}}}
  if(!candidates.length&&learned){for(const date of dates){if(learned.weekday&&learned.weekday!==isoWeekdayFromLocalDate(date))continue;add(date,learned.time||PROVIDER_BASE_TIME[schedule.provider]||"12:00","LEARNING");}}
  if(!candidates.length){const strategyTime=PROVIDER_BASE_TIME[schedule.provider];if(strategyTime){for(let index=0;index<target*3&&candidates.length<target*2;index+=1){const spread=Math.floor((index%Math.max(target,1))*7/Math.max(target,1));const cycle=Math.floor(index/Math.max(target,1));const date=dates[PROVIDER_OFFSET[schedule.provider]+spread+cycle*7];if(date)add(date,cycle===0?strategyTime:cycle===1?"13:00":"09:00","STRATEGY");}}}
  if(!candidates.length){for(const date of dates.slice(0,target)){add(date,"12:00","DEFAULT");}}
  return candidates.sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)).slice(0,target);
}
function settingsFromStrategy(value:unknown){const strategy=asObject(value);return{enabled:strategy.autopilotEnabled!==false,approvalMode:strategy.approvalMode==="AUTOMATIC"?"AUTOMATIC" as ApprovalMode:"MANUAL_REVIEW" as ApprovalMode};}
async function ensureStrategy(sql:Sql,profileId:string){const defaults=JSON.stringify({autopilotEnabled:true,approvalMode:"MANUAL_REVIEW",researchMode:"BALANCED"});await sql`insert into public.content_strategies (profile_id,platform_strategy,updated_at) values (${profileId}::uuid,${defaults}::jsonb,now()) on conflict (profile_id) do nothing`;}
async function ensureSchedules(sql:Sql,profile:ProfileRow){for(const item of DEFAULT_SCHEDULES){await sql`insert into public.schedules (profile_id,provider,timezone,posts_per_week,preferred_slots,auto_choose,enabled,updated_at) select ${profile.id}::uuid,${item.provider},${profile.timezone||"Europe/Rome"},${item.posts},'[]'::jsonb,true,true,now() where not exists (select 1 from public.schedules where profile_id=${profile.id}::uuid and provider=${item.provider})`;}}
type PersonalBrandEditorialContext = {
  relation: PersonalBrandSourceRelation | null;
  pillar: string;
  audience: Record<string, unknown>;
  sourceRefs: unknown[];
  factProvenance: unknown[];
};

async function loadBrandContext(sql:Sql,profile:ProfileRow):Promise<{context:BrandContext;visualIdentity:unknown;personalBrand:PersonalBrandEditorialContext|null}>{
  if(profile.profile_type==="PERSONAL_BRAND"){
    const own=await loadProfileBrandContext(sql,profile);
    if(!Object.keys(own.audience).length) throw new Error("PERSONAL_BRAND_AUDIENCE_REQUIRED");
    const relation=await resolvePersonalBrandSource(sql,profile.id);
    if(relation){
      const resolved=await buildPersonalBrandEditorialContext(sql,profile,relation);
      return{context:resolved.brand,visualIdentity:resolved.visualIdentity,personalBrand:{relation,pillar:relation.pillar,audience:resolved.audience,sourceRefs:resolved.sourceRefs,factProvenance:resolved.factProvenance}};
    }
    const pillar=profile.industry?.trim()||"Personal Brand";
    return{
      context:own.brand,
      visualIdentity:own.visualIdentity,
      personalBrand:{
        relation:null,
        pillar,
        audience:own.audience,
        sourceRefs:own.brand.confirmedWebsiteContent.map((page)=>({type:"OWN_WEBSITE_PAGE",url:page.url,title:page.title})),
        factProvenance:[{source_type:"OWN_PROFILE",profile_id:profile.id,pillar,verified_at:new Date().toISOString()}],
      },
    };
  }
  const own=await loadProfileBrandContext(sql,profile);
  return{context:own.brand,visualIdentity:own.visualIdentity,personalBrand:null};
}
export function chooseAutopilotPublishFormat(provider:SocialProvider,recentCount:number,requested?:SocialFormat|null,learned?:SocialFormat|null):SocialFormat{const supported=AUTOPILOT_PUBLISH_FORMATS[provider];if(learned&&supported.includes(learned))return learned;if(requested&&supported.includes(requested))return requested;return supported[recentCount%supported.length]??"POST";}
export function chooseAutopilotContentType(format:SocialFormat):ContentType{return format==="STORY"?"SINGLE_STORY":format==="CAROUSEL"?"CAROUSEL":"SINGLE_POST";}
async function recentTopics(sql:Sql,profileId:string){const rows=await sql`select topic from public.content_items where profile_id=${profileId}::uuid order by created_at desc limit 24` as unknown as RecentItemRow[];return rows.map(r=>r.topic).filter(Boolean);}
async function activeLearningInsights(sql:Sql,profileId:string){return await sql`select profile_id,dimension,dimension_value,sample_size,total_scorable_samples,uplift_pct,confidence,recommendation,metric_basis,observed_from,observed_to,generated_at,active from public.learning_insights where profile_id=${profileId}::uuid and active=true and source_type='PROVIDER_API' and confidence in ('MEDIUM','HIGH') order by confidence desc,uplift_pct desc limit 20` as unknown as PersistedLearningInsight[];}
async function recentContentForDedupe(sql:Sql,profileId:string):Promise<ContentDedupeCandidate[]>{const rows=await sql`select ci.id,ci.topic,ci.title,ci.pillar,ci.visual_archetype,ci.subject_strategy,concat_ws(':',ci.decision_record->>'contentType',ci.decision_record->>'intent') as narrative_structure,cv.hook,cv.caption,cv.cta from public.content_items ci left join lateral (select hook,caption,cta from public.content_variants where profile_id=${profileId}::uuid and content_id=ci.id order by updated_at desc limit 1) cv on true where ci.profile_id=${profileId}::uuid order by ci.created_at desc limit 40` as unknown as RecentContentRow[];return rows.map(r=>({id:r.id,topic:r.topic??"",angle:r.title,hook:r.hook,caption:r.caption,cta:r.cta,pillar:r.pillar,visualArchetype:r.visual_archetype,subjectStrategy:r.subject_strategy,narrativeStructure:r.narrative_structure}));}
async function recentVariantCount(sql:Sql,profileId:string,provider:SocialProvider){const rows=await sql`select count(*)::int as count from public.content_variants where profile_id=${profileId}::uuid and provider=${provider}` as unknown as CountRow[];return Number(rows[0]?.count??0);}
async function persistMasterDecision(sql:Sql,profileId:string,strategy:StrategyRow|undefined,decision:MasterEditorialDecision){const existing=asObject(strategy?.platform_strategy);const previous=asObject(existing.masterEditorialDecisions);const entries=Object.entries(previous).slice(-39);await sql`update public.content_strategies set platform_strategy=${JSON.stringify({...existing,masterEditorialDecisions:Object.fromEntries([...entries,[decision.id,decision]])})}::jsonb,updated_at=now() where profile_id=${profileId}::uuid`;}
export async function currentSpend(sql:Sql,profileId:string){const rows=await sql`select coalesce(sum(cost_usd),0)::float8 as spend from public.ai_usage_events where profile_id=${profileId}::uuid and created_at>=${monthStartIso()}::timestamptz and operation in ('GENERATE_SOCIAL_TEXT','AGENT_RESEARCH','AGENT_FACTCHECK','AGENT_EDITORIAL_QA')` as unknown as SpendRow[];return Number(rows[0]?.spend??0)||0;}

async function createPlannedContent(input:{sql:Sql;env:Required<Pick<AutopilotEnv,"OPENAI_API_KEY">>&AutopilotEnv;profile:ProfileRow;strategy:StrategyRow|undefined;provider:SocialProvider;scheduledAt:string;timingSource:AutopilotCandidateSlot["timingSource"];approvalMode:ApprovalMode;allowImageGeneration:boolean}){
  const{sql,env,profile,strategy,provider,scheduledAt,timingSource,approvalMode,allowImageGeneration}=input;const loaded=await loadBrandContext(sql,profile);const context=loaded.context;if(!context.confirmedWebsiteContent.length)throw new Error(profile.profile_type==="PERSONAL_BRAND"?"AUTOPILOT_PERSONAL_BRAND_SOURCE_CONTEXT_MISSING":"AUTOPILOT_WEBSITE_CONTEXT_MISSING");
  const topics=await recentTopics(sql,profile.id);const count=await recentVariantCount(sql,profile.id,provider);const learning=await activeLearningInsights(sql,profile.id);const planItem=selectPlanItem(strategy?.platform_strategy,provider,scheduledAt);const learnedFormat=learnedFormatPreference(profile.id,provider,AUTOPILOT_PUBLISH_FORMATS[provider],learning);const objective=planItem?.objective||strings(strategy?.objectives)[0]||context.goals[0]||null;
  const strategyAi=asObject(asObject(strategy?.platform_strategy).aiStrategy);
  const memory=await refreshProfileEditorialMemory({sql,profileId:profile.id,profileType:profile.profile_type,strategyPillars:stringSignals(strategyAi.contentPillars)});
  if(profile.profile_type==="PERSONAL_BRAND"&&!objective)throw new Error("PERSONAL_BRAND_OBJECTIVE_REQUIRED");
  const configuredResearch=normalizeEditorialResearchMode(asObject(strategy?.platform_strategy).researchMode);
  const researchMode=planItem?.intent==="NEWS"?"NEWS":configuredResearch;
  const pillar=buildAutopilotPillarInstruction(loaded.visualIdentity,topics,count);
  const editorialBudget=await new ActivityBudgetEngine(env.DATABASE_URL!).snapshot(profile.id);
  const [connectionRows,calendarRows,metricRows,assetRows]=await Promise.all([
    sql`select provider from public.social_connections where profile_id=${profile.id}::uuid and status='ACTIVE' and provider in ('INSTAGRAM','FACEBOOK','LINKEDIN','GBP') order by provider` as unknown as Array<{provider:SocialProvider}>,
    sql`select count(*)::int as count from public.publication_jobs where profile_id=${profile.id}::uuid and scheduled_at>=now() and state in ('SCHEDULED','BLOCKED_APPROVAL','QUEUED')` as unknown as CountRow[],
    sql`select count(*)::int as count from public.metric_snapshots where profile_id=${profile.id}::uuid and source='PROVIDER_API'` as unknown as CountRow[],
    sql`select count(*)::int as count from public.assets where profile_id=${profile.id}::uuid and kind='IMAGE' and (quality_status is null or quality_status='PASS') and storage_url is not null` as unknown as CountRow[],
  ]);
  const formatDecision=selectAutonomousFormat({
    provider,
    topic:planItem?.topicDirection||pillar.instruction||"",
    objective,
    goal:context.goals[0]??null,
    supportedFormats:AUTOPILOT_PUBLISH_FORMATS[provider],
    requestedFormat:planItem?.format??null,
    learnedFormat,
    memory,
    reusableAssetCount:Number(assetRows[0]?.count??0),
    budgetBand:editorialBudget.band,
  });
  const format=formatDecision.selectedFormat;
  const effectivePlanItem=planItem?{...planItem,contentType:chooseAutopilotContentType(format),format}:null;
  const audienceSignals=stringSignals([context.target,loaded.personalBrand?.audience]);
  const pillarSignals=stringSignals([pillar.pillar?.name,loaded.personalBrand?.pillar]);
  const relevantEvents=planItem&&(planItem.intent==="NEWS"||planItem.intent==="SEASONAL")?[planItem.topicDirection]:[];
  const master=decideMasterEditorial({
    topic:planItem?.topicDirection||pillar.instruction||"",
    objective,
    audience:audienceSignals[0]??null,
    pillar:pillarSignals[0]??null,
    funnelStage:planItem?.funnelStage??"AWARENESS",
    contentType:planItem?.contentType??chooseAutopilotContentType(format),
    intent:planItem?.intent??"TIP",
    preferredProvider:provider,
    format,
    localBusinessRelevance:Boolean(context.websiteUrl||context.description||context.serviceArea),
    professionalRelevance:/business|profession|azienda|b2b|property|immobil/i.test(`${profile.industry??""} ${context.description??""} ${context.target??""}`),
    hasVerifiableContext:Boolean(context.confirmedWebsiteContent.length),
    context:{
      profileType:profile.profile_type,
      personalBrand:Boolean(loaded.personalBrand),
      brandSignalCount:stringSignals([context.description,context.businessModel,context.location,context.serviceArea,context.tone,context.userContext]).length,
      sitePageCount:context.confirmedWebsiteContent.length,
      sourceCount:context.confirmedWebsiteContent.length+(loaded.personalBrand?.sourceRefs.length??0),
      industry:profile.industry,
      goals:stringSignals([objective,...context.goals]),
      audience:audienceSignals,
      pillars:pillarSignals,
      connectedProviders:connectionRows.map((row)=>row.provider),
      recentContentCount:topics.length,
      calendarScheduledCount:Number(calendarRows[0]?.count??0),
      budget:{
        band:editorialBudget.band,
        remainingEur:editorialBudget.remainingEur,
        higgsfieldRemainingEur:editorialBudget.higgsfieldRemainingEur,
        otherAiRemainingEur:editorialBudget.otherAiRemainingEur,
      },
      relevantEvents,
      analyticsSampleCount:Number(metricRows[0]?.count??0),
      learningSignalCount:usableLearningDecisions(profile.id,learning).length,
      reusableAssetCount:Number(assetRows[0]?.count??0),
      editorialMemory:{
        activeSeriesCount:memory.continuity.activeSeries.length,
        suggestedNextTopicIntent:memory.continuity.suggestedNextTopicIntent,
        underusedPillars:memory.balance.underusedPillars,
        overusedPillars:memory.balance.overusedPillars,
        feedbackSignalCount:memory.feedback.weightedSignals.length,
        recentSubjects:memory.recent.subjects,
        recentVisualArchetypes:memory.recent.visualArchetypes,
      },
    },
  });
  master.timing={scheduledAt,source:timingSource};
  if(master.status==="SKIP_PUBLICATION"){await persistMasterDecision(sql,profile.id,strategy,master);return {scheduled:false,blocked:false};}
  const baseTopicRequest=effectivePlanItem?buildPlanDrivenTopicRequest(effectivePlanItem,topics):[pillar.instruction||"Scegli autonomamente un nuovo tema editoriale specifico e utile per questa attività.","Per i fatti specifici dell'attività usa solo sito e brand; per conoscenze di settore, consigli e aggiornamenti segui il filtro editoriale e usa ricerca esterna verificata quando consentita.",`Il contenuto è destinato a ${provider} nel formato ${format}.`,topics.length?`Evita di ripetere questi temi recenti: ${topics.join(" | ")}.`:"Evita temi generici e ripetitivi."].join(" ");
  const learningInstruction=buildAutopilotLearningInstruction(profile.id,provider,learning);
  const profileStrategyInstruction=profileTypeStrategyInstruction({profileType:profile.profile_type,industry:profile.industry,businessModel:context.businessModel,offer:context.description,audience:context.target,objective,provider});
  const memoryInstruction=buildEditorialMemoryInstruction(memory);
  const topicRequest=[baseTopicRequest,profileStrategyInstruction,memoryInstruction,learningInstruction].filter(Boolean).join("\n\n");
  const meter=new TextGenerationMetering(env.DATABASE_URL!);
  const operationIdentity=`autopilot:${profile.id}:${provider}:${scheduledAt}`;
  const reservation=await meter.reserve({profileId:profile.id,source:"AUTOPILOT",operationIdentity,requestFingerprint:{provider,format,scheduledAt,topicRequest,objective,researchMode}});
  if(reservation.status==="DENIED")throw new Error(reservation.code);
  if(reservation.status==="COMPLETED")return reservation.cached.response as {scheduled:boolean;blocked:boolean};
  if(reservation.status==="IN_PROGRESS")throw new Error("AUTOPILOT_GENERATION_IN_PROGRESS");
  if(reservation.status==="RELEASED")throw new Error("METERING_FAILED");
  const logicalEventId=reservation.eventId;let logicalCommitted=false;const imageMeter=new ImageGenerationMetering(env.DATABASE_URL!);let imageEventId:string|null=null;let imageCommitted=false;let imageAssetId:string|null=null;
  try{
  const upper=estimateTextRequestUpperBoundUsd({topic:topicRequest,objective,providers:[provider],formats:[format],brand:context,researchMode});const qaReserve=approvalMode==="AUTOMATIC"?AUTO_QA_RESERVE_USD:0;
  const activityBudget=await new ActivityBudgetEngine(env.DATABASE_URL!).preflight({profileId:profile.id,task:"COPY_FINAL",importance:"STANDARD",projectedOperationCostUsd:upper+qaReserve});
  if(!activityBudget.allowed){await meter.release(logicalEventId,activityBudget.reason??"AI_BUDGET_HARD_STOP");throw new Error("AUTOPILOT_ACTIVITY_BUDGET_STOP");}
  await meter.markProviderStarted(logicalEventId);
  const generated=await generateSocialText({apiKey:env.OPENAI_API_KEY,topic:topicRequest,objective,providers:[provider],formats:[format],brand:context,researchMode,cacheKey:`post-automatici:${profile.id}`});
  const variant=generated.content.variants.find(item=>item.provider===provider&&item.format===format);if(!variant)throw new Error("AUTOPILOT_VARIANT_MISSING");
  const identityRowsForSubject=profile.profile_type==="PERSONAL_BRAND"
    ? await sql`select status from public.personal_brand_visual_identities where profile_id=${profile.id}::uuid limit 1` as unknown as Array<{status:"NOT_CONFIGURED"|"REFERENCES_PENDING"|"READY_TO_CREATE"|"CREATING"|"COMPLETED"|"FAILED"}>
    : [];
  const canonicalIdentityState=identityRowsForSubject[0]?.status??"NOT_CONFIGURED";
  const subjectDecision=chooseSubjectStrategy({
    profileType:profile.profile_type,
    provider,
    format,
    topic:generated.content.editorialTopic,
    angle:generated.content.editorialAngle,
    visualBrief:variant.visualBrief,
    memory,
    suitableRealAssetAvailable:false,
    canonicalIdentityReady:canonicalIdentityState==="COMPLETED",
  });
  const continuityDecision=deriveContinuityDecision({
    memory,
    profileType:profile.profile_type,
    contentType:master.contentType,
    intent:master.intent,
    topic:generated.content.editorialTopic,
  });
  if(loaded.personalBrand){
    const allowed=Array.isArray(loaded.personalBrand.relation?.allowed_ctas)?loaded.personalBrand.relation?.allowed_ctas.filter((item):item is string=>typeof item==="string"&&Boolean(item.trim())).map((item)=>item.trim().toLowerCase()):[];
    if(allowed.length&&variant.cta&&!allowed.includes(variant.cta.trim().toLowerCase()))throw new Error("AUTOPILOT_PERSONAL_BRAND_CTA_NOT_ALLOWED");
  }
  await meter.persistTechnicalEvents(profile.id,logicalEventId,technicalEventsFromTextResult(generated,{source:"AUTOPILOT",provider,format,research_mode:generated.researchMode,external_sources:generated.externalSources,verification:generated.verification,planner_driven:Boolean(planItem),planner_intent:planItem?.intent??null,planner_funnel_stage:planItem?.funnelStage??null,planner_topic_direction:planItem?.topicDirection??null,learning_applied:Boolean(learningInstruction),learning_format_applied:learnedFormat??null,format_preferred:formatDecision.preferredFormat,format_selected:formatDecision.selectedFormat,format_density:formatDecision.informationDensity,format_capability_constrained:formatDecision.capabilityConstrained,format_reasons:formatDecision.reasons,timing_source:timingSource,editorial_pillar_selected:planItem?null:pillar.pillar?.name??null,editorial_topic:generated.content.editorialTopic,editorial_angle:generated.content.editorialAngle}));
  const recentDedupe=await recentContentForDedupe(sql,profile.id);
  const duplicate=findNearDuplicate({topic:generated.content.editorialTopic,angle:generated.content.editorialAngle,hook:variant.hook,caption:variant.caption},recentDedupe);
  const linkedSeriesContinuation=continuityDecision.mode==="CONTINUE_SERIES"&&Boolean(continuityDecision.previousContentId);
  if(duplicate&&(!linkedSeriesContinuation||duplicate.bodyScore>=0.78))throw new Error(`AUTOPILOT_DUPLICATE_CONTENT:${duplicate.score.toFixed(3)}`);
  const repetition=findEditorialRepetition({topic:generated.content.editorialTopic,angle:generated.content.editorialAngle,hook:variant.hook,caption:variant.caption,cta:variant.cta,pillar:generated.content.pillar??null,visualArchetype:subjectDecision.visualArchetype,subjectStrategy:subjectDecision.subject,narrativeStructure:`${master.contentType}:${master.intent}`},recentDedupe);
  if(repetition.blocked)throw new Error(`AUTOPILOT_REPETITION_BLOCKED:${repetition.reasons.join(",")}`);
  if(approvalMode==="AUTOMATIC"&&variant.eligible){const qa=await runOpenAIEditorialQA({apiKey:env.OPENAI_API_KEY,profileName:profile.name,industry:profile.industry,tone:context.tone,provider,format,objective,content:generated.content,variant,verification:generated.verification,externalSources:generated.externalSources});const qaEvent:TechnicalAiEvent={operation:"AGENT_EDITORIAL_QA",model:qa.model,inputTokens:qa.usage.inputTokens,outputTokens:qa.usage.outputTokens,costUsd:qa.usage.estimatedCostUsd,metadata:{openai_response_id:qa.responseId,openai_request_id:qa.requestId,source:"AUTOPILOT",provider,format,verdict:qa.verdict,reasons:qa.reasons,checks:qa.checks}};await meter.persistTechnicalEvents(profile.id,logicalEventId,[qaEvent]);if(qa.verdict!=="PASS")throw new Error(`AUTOPILOT_EDITORIAL_QA_BLOCKED:${qa.reasons.slice(0,2).join(" | ")||"material issue"}`);}
  const contentId=crypto.randomUUID();const variantId=crypto.randomUUID();const now=new Date().toISOString();
  master.contentId=contentId;master.topic=generated.content.editorialTopic;master.angle=generated.content.editorialAngle;master.visualStrategy=variant.visualBrief;await persistMasterDecision(sql,profile.id,strategy,master);
  const generatedPillar=generated.content.pillar?.trim()||pillar.pillar?.name||loaded.personalBrand?.pillar||null;
  const brandVisual=normalizeBrandVisualIdentity(loaded.visualIdentity);
  const decisionRecord=JSON.stringify({
    source:"AUTOPILOT",
    masterDecisionId:master.id,
    rationale:master.rationale,
    context:master.context,
    contextSignals:master.contextSignals,
    channels:master.channels,
    timing:master.timing??null,
    provider,
    format,
    formatDecision,
    contentType:master.contentType,
    intent:master.intent,
    objective,
    pillar:generatedPillar,
    editorialTopic:generated.content.editorialTopic,
    editorialAngle:generated.content.editorialAngle,
    strategySummary:generated.content.strategySummary,
    profileType:profile.profile_type,
    subjectStrategy:subjectDecision.subject,
    visualArchetype:subjectDecision.visualArchetype,
    subjectReason:subjectDecision.reason,
    continuity:{
      mode:continuityDecision.mode,
      seriesId:continuityDecision.seriesId,
      sequenceNumber:continuityDecision.sequenceNumber,
      previousContentId:continuityDecision.previousContentId,
      nextTopicIntent:continuityDecision.nextTopicIntent,
      reason:continuityDecision.continuityReason,
    },
    memoryProof:{
      builtAt:memory.builtAt,
      sourceContentCount:memory.sourceContentCount,
      suggestedNextTopicIntent:memory.continuity.suggestedNextTopicIntent,
      underusedPillars:memory.balance.underusedPillars,
      overusedPillars:memory.balance.overusedPillars,
      feedbackSignals:memory.feedback.weightedSignals.slice(0,6),
      recentSubjects:memory.recent.subjects.slice(0,8),
      recentVisualArchetypes:memory.recent.visualArchetypes.slice(0,8),
    },
    antiRepetition:repetition.signals,
    generatedAt:now,
  });
  if(loaded.personalBrand){
    const sourceRefs=[...loaded.personalBrand.sourceRefs,...generated.externalSources.map((url)=>({type:"EXTERNAL_SOURCE",url}))];
    const factProvenance=[...loaded.personalBrand.factProvenance,...generated.externalSources.map((url)=>({source_type:"EXTERNAL_SOURCE",url}))];
    await sql`insert into public.content_items (id,profile_id,topic,objective,title,status,pillar,source_profile_id,source_profile_ids,source_refs,audience,fact_provenance,editorial_cta,source_mix_approved,decision_record,series_id,sequence_number,previous_content_id,next_topic_intent,continuity_reason,visual_archetype,subject_strategy,updated_at) values (${contentId}::uuid,${profile.id}::uuid,${generated.content.editorialTopic},${objective},${generated.content.editorialAngle.slice(0,240)},'IN_REVIEW',${generatedPillar},${loaded.personalBrand.relation?.source_profile_id ?? null}::uuid,case when ${loaded.personalBrand.relation?.source_profile_id ?? null}::uuid is null then '{}'::uuid[] else ARRAY[${loaded.personalBrand.relation?.source_profile_id ?? null}::uuid] end,${JSON.stringify(sourceRefs)}::jsonb,${JSON.stringify(loaded.personalBrand.audience)}::jsonb,${JSON.stringify(factProvenance)}::jsonb,${variant.cta?.trim()||"NONE"},false,${decisionRecord}::jsonb,${continuityDecision.seriesId}::uuid,${continuityDecision.sequenceNumber},${continuityDecision.previousContentId}::uuid,${continuityDecision.nextTopicIntent},${continuityDecision.continuityReason},${subjectDecision.visualArchetype},${subjectDecision.subject},${now}::timestamptz)`;
  }else{
    await sql`insert into public.content_items (id,profile_id,topic,objective,title,status,pillar,decision_record,series_id,sequence_number,previous_content_id,next_topic_intent,continuity_reason,visual_archetype,subject_strategy,updated_at) values (${contentId}::uuid,${profile.id}::uuid,${generated.content.editorialTopic},${objective},${generated.content.editorialAngle.slice(0,240)},'IN_REVIEW',${generatedPillar},${decisionRecord}::jsonb,${continuityDecision.seriesId}::uuid,${continuityDecision.sequenceNumber},${continuityDecision.previousContentId}::uuid,${continuityDecision.nextTopicIntent},${continuityDecision.continuityReason},${subjectDecision.visualArchetype},${subjectDecision.subject},${now}::timestamptz)`;
  }
  await sql`insert into public.content_variants (id,content_id,profile_id,provider,format,eligible,hook,caption,cta,hashtags,visual_brief,alt_text,factual_basis,approval_status,approval_mode,workflow_status,updated_at) values (${variantId}::uuid,${contentId}::uuid,${profile.id}::uuid,${provider},${format},${variant.eligible},${variant.hook},${variant.caption},${variant.cta},${JSON.stringify(variant.hashtags)}::jsonb,${variant.visualBrief},${variant.altText},${JSON.stringify(variant.factualBasis)}::jsonb,'PENDING',${approvalMode==="AUTOMATIC"?"AUTO":"MANUAL"},'DRAFT',${now}::timestamptz)`;
  if(variant.eligible&&allowImageGeneration){
    const aspectRatio=format==="STORY"?"2:3":"1:1";
    const candidates=await sql`select id,source,kind,name,storage_url,mime_type,tags,metadata,provider,model,cost_eur,width,height,format,quality_status,identity_status,created_at from public.assets where profile_id=${profile.id}::uuid and kind='IMAGE' order by created_at desc limit 100` as unknown as ReusableAssetCandidate[];
    const reusable=await findReusableAsset({visualBrief:variant.visualBrief,aspectRatio,candidates});
    const budgetEngine=new ActivityBudgetEngine(env.DATABASE_URL!);
    const visualBudget=await budgetEngine.snapshot(profile.id);
    const visualDecision=decideVisualRuntime({
      profileType:profile.profile_type,
      visualBrief:variant.visualBrief,
      suitableRealAssetAvailable:Boolean(reusable),
      higgsfieldConfigured:higgsfieldConfigured(env.HF_CREDENTIALS),
      soulIdentityState:canonicalIdentityState,
      higgsfieldBudgetRemainingEur:visualBudget.higgsfieldRemainingEur,
      estimatedHiggsfieldCostEur:0.25,
      estimatedOpenAiCostEur:0.25,
      subject:subjectDecision.subject,
    });
    await sql`update public.content_variants set
      visual_provider=${visualDecision.provider},
      visual_model=${visualDecision.model},
      visual_decision_reason=${visualDecision.reasonCode},
      visual_estimated_cost_eur=${visualDecision.estimatedCostEur},
      visual_identity_qa_status=${visualDecision.identityQaStatus},
      updated_at=now()
      where id=${variantId}::uuid and profile_id=${profile.id}::uuid`;

    if(reusable){
      imageAssetId=reusable.asset.id;
      await sql`update public.content_items set subject_strategy='REAL_ASSET',visual_archetype='REAL_ASSET_FEATURE',updated_at=now() where id=${contentId}::uuid and profile_id=${profile.id}::uuid`;
      await sql`update public.assets set metadata=coalesce(metadata,'{}'::jsonb)||${JSON.stringify({reuse_reason:reusable.reason,last_reused_at:new Date().toISOString()})}::jsonb,reuse_count=reuse_count+1,last_used_at=now(),updated_at=now() where id=${imageAssetId}::uuid and profile_id=${profile.id}::uuid`;
      await sql`update public.content_variants set visual_actual_cost_eur=0 where id=${variantId}::uuid and profile_id=${profile.id}::uuid`;
    }

    if(!imageAssetId&&visualDecision.provider==="HIGGSFIELD"){
      console.log("autopilot-visual-routing",{profileId:profile.id,variantId,provider:"HIGGSFIELD",reason:visualDecision.reasonCode,state:"BLOCKED_UNTIL_RUNTIME_CERTIFIED"});
    }

    if(!imageAssetId&&visualDecision.provider==="OPENAI")try{
      const imageReservation=await imageMeter.reserve({profileId:profile.id,source:"AUTOPILOT",operationIdentity:`autopilot:${profile.id}:${provider}:${scheduledAt}:${variantId}`,referenceId:variantId,requestFingerprint:{provider,format,scheduledAt,variantId,visualBrief:variant.visualBrief,caption:variant.caption,visualProvider:visualDecision.provider,visualDecisionReason:visualDecision.reasonCode}});
      if(imageReservation.status==="COMPLETED"){imageAssetId=imageReservation.cached.assetId??null;}
      else if(imageReservation.status==="RESERVED"){
        imageEventId=imageReservation.eventId;
        const imageBudget=await budgetEngine.preflight({profileId:profile.id,task:"IMAGE_STANDARD",importance:"STANDARD",projectedOperationCostUsd:0.25,costBucket:"OTHER_AI"});
        if(!imageBudget.allowed){await imageMeter.release(imageEventId,imageBudget.reason??"AI_BUDGET_HARD_STOP");imageEventId=null;throw new Error("AUTOPILOT_IMAGE_BUDGET_STOP");}
        await imageMeter.markProviderStarted(imageEventId);
        const image=await generateRoutedImage({env:{OPENAI_API_KEY:env.OPENAI_API_KEY},budget:imageBudget,importance:"STANDARD",profileName:profile.name,profileType:profile.profile_type,industry:profile.industry,tone:context.tone,brandColors:brandVisual.colors,brandFonts:brandVisual.fonts,brandVisualStyle:brandVisual.visualStyle,provider:provider as ImageSocialProvider,format:format as ImageSocialFormat,visualBrief:variant.visualBrief,caption:variant.caption,additionalDirection:(visualDecision.mustAvoidSyntheticPerson||subjectDecision.prohibitSyntheticPerson)?"Do not depict or invent a synthetic replacement person. Use the chosen non-person subject, objects, environment, typography, infographic or other non-identifying elements only.":null});
        await imageMeter.persistTechnicalEvents(profile.id,imageEventId,technicalEventsFromImageResult(image,{source:"AUTOPILOT",provider,format,visual_provider:visualDecision.provider,visual_decision_reason:visualDecision.reasonCode}));
        imageAssetId=crypto.randomUUID();const dataUrl=`data:${image.mimeType};base64,${image.base64}`;
        const actualRows=await sql`select coalesce(actual_usd,reserved_usd)*fx_usd_to_eur_rate as actual_eur from public.provider_cost_attempts where logical_usage_event_id=${imageEventId}::uuid limit 1` as unknown as Array<{actual_eur:number|string}>;
        const actualEur=Number(actualRows[0]?.actual_eur??visualDecision.estimatedCostEur);
        const sizeMatch=/^(\\d+)x(\\d+)$/.exec(String(image.size??""));
        const contentHash=await assetContentHashFromBase64(image.base64);
        await sql`insert into public.assets (
          id,profile_id,content_id,source,kind,name,storage_url,mime_type,tags,metadata,
          provider,model,cost_eur,width,height,format,quality_status,identity_status,content_hash,updated_at
        ) values (
          ${imageAssetId}::uuid,${profile.id}::uuid,${contentId}::uuid,'AI_IMAGE','IMAGE',
          ${`${provider}-${format}-${variantId}.png`},${dataUrl},${image.mimeType},
          ${JSON.stringify([provider,format,"AI_GENERATED","AUTOPILOT"])}::jsonb,
          ${JSON.stringify({provider:"OPENAI",model:image.model,quality:image.quality,size:image.size,aspect_ratio:image.aspectRatio,visual_brief:variant.visualBrief,visual_fingerprint:await visualFingerprint({visualBrief:variant.visualBrief,aspectRatio:image.aspectRatio}),provider_request_id:image.requestId,storage_mode:"DATABASE_DATA_URL_V1",visual_decision_reason:visualDecision.reasonCode})}::jsonb,
          'OPENAI',${image.model},${actualEur},${sizeMatch?Number(sizeMatch[1]):null},${sizeMatch?Number(sizeMatch[2]):null},
          ${image.aspectRatio},'PENDING','NOT_REQUIRED',${contentHash},now()
        )`;
        await sql`update public.content_variants set visual_model=${image.model},visual_actual_cost_eur=${actualEur} where id=${variantId}::uuid and profile_id=${profile.id}::uuid`;
      }
    }catch(reason){if(imageEventId&&!imageCommitted)await imageMeter.release(imageEventId,reason instanceof Error?reason.message:"AUTOPILOT_IMAGE_FAILED").catch(()=>undefined);console.error("autopilot-image",{profileId:profile.id,provider,detail:reason instanceof Error?reason.message:"unknown"});}
  }
  if(imageAssetId)await sql`update public.content_variants set image_asset_id=${imageAssetId}::uuid,approval_status='PENDING',updated_at=now() where id=${variantId}::uuid and profile_id=${profile.id}::uuid`;
  if(imageEventId&&imageAssetId){await imageMeter.storeResult(imageEventId,{response:{assetId:imageAssetId,duplicate:true},assetId:imageAssetId,variantId});await imageMeter.commit(imageEventId);imageCommitted=true;}
  let canAutoApprove=false;
  if(approvalMode==="AUTOMATIC"&&variant.eligible){
    if(!imageAssetId)throw new Error("AUTOPILOT_IMAGE_REQUIRED_FOR_AUTO_APPROVAL");
    const finalQa=await runContentQa({
      databaseUrl:env.DATABASE_URL!,
      apiKey:env.OPENAI_API_KEY,
      profileId:profile.id,
      contentId,
      variantId,
      actorType:"AUTOPILOT",
    });
    if(finalQa.overallStatus==="PASS"){
      const approvedRows=await sql`select public.auto_approve_content_variant(${profile.id}::uuid,${variantId}::uuid,'SYSTEM_AUTOPILOT') as approved` as unknown as Array<{approved:boolean}>;
      canAutoApprove=approvedRows[0]?.approved===true;
    }
  }
  await sql`update public.content_items set status=${canAutoApprove?"APPROVED":"IN_REVIEW"},updated_at=now() where id=${contentId}::uuid and profile_id=${profile.id}::uuid`;
  if(variant.eligible){await refreshProfileEditorialMemory({sql,profileId:profile.id,profileType:profile.profile_type,strategyPillars:stringSignals(strategyAi.contentPillars)});const jobId=crypto.randomUUID();const state=canAutoApprove?"SCHEDULED":"BLOCKED_APPROVAL";const idempotencyKey=`autopilot:${variantId}:${scheduledAt}`;await sql`insert into public.publication_jobs (id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,updated_at) values (${jobId}::uuid,${profile.id}::uuid,${variantId}::uuid,${provider},${state},${scheduledAt}::timestamptz,${idempotencyKey},0,now()) on conflict (idempotency_key) do nothing`;const response={scheduled:canAutoApprove,blocked:!canAutoApprove};await meter.storeResult(logicalEventId,{response,contentId,variantId});await meter.commit(logicalEventId);logicalCommitted=true;return response;}await refreshProfileEditorialMemory({sql,profileId:profile.id,profileType:profile.profile_type,strategyPillars:stringSignals(strategyAi.contentPillars)});const response={scheduled:false,blocked:false};await meter.storeResult(logicalEventId,{response,contentId,variantId});await meter.commit(logicalEventId);logicalCommitted=true;return response;
  }catch(reason){if(imageEventId&&!imageCommitted){if(imageAssetId)await sql`delete from public.assets where id=${imageAssetId}::uuid and profile_id=${profile.id}::uuid`.catch(()=>undefined);await imageMeter.release(imageEventId,reason instanceof Error?reason.message:"AUTOPILOT_IMAGE_FAILED").catch(()=>undefined);}if(reason instanceof OpenAITextPipelineError)await meter.persistTechnicalEvents(profile.id,logicalEventId,reason.technicalEvents).catch(()=>undefined);if(!logicalCommitted)await meter.release(logicalEventId,reason instanceof Error?reason.message:"AUTOPILOT_GENERATION_FAILED").catch(()=>undefined);throw reason;}
}

export async function runContentAutopilot(env:AutopilotEnv,options:RunOptions={}):Promise<RunResult>{
  const allowImageGeneration=options.allowImageGeneration!==false;
  if(!env.DATABASE_URL)throw new Error("DATABASE_NOT_CONFIGURED");if(!env.OPENAI_API_KEY)throw new Error("OPENAI_NOT_CONFIGURED");const sql=createSql(env.DATABASE_URL);const maxGenerations=Math.min(Math.max(options.maxGenerations??DEFAULT_GENERATIONS_PER_RUN,1),50);
  const profiles=options.profileId?await sql`select id,name,website_url,industry,timezone,profile_type,owner_auth_user_id from public.profiles where id=${options.profileId}::uuid and archived_at is null and onboarding_completed=true limit 1` as unknown as ProfileRow[]:await sql`select id,name,website_url,industry,timezone,profile_type,owner_auth_user_id from public.profiles where archived_at is null and onboarding_completed=true order by created_at asc limit ${MAX_PROFILES_PER_RUN}` as unknown as ProfileRow[];
  const result:RunResult={profilesChecked:0,generated:0,scheduled:0,blockedForReview:0,skipped:0,errors:[]};const now=new Date();const horizon=new Date(now.getTime()+8*DAY_MS).toISOString();
  for(const profile of profiles){if(result.generated>=maxGenerations)break;result.profilesChecked+=1;try{await ensureStrategy(sql,profile.id);await ensureSchedules(sql,profile);const strategies=await sql`select objectives,platform_strategy from public.content_strategies where profile_id=${profile.id}::uuid limit 1` as unknown as StrategyRow[];const strategy=strategies[0];const settings=settingsFromStrategy(strategy?.platform_strategy);if(!settings.enabled){result.skipped+=1;continue;}const schedules=await sql`select provider,timezone,posts_per_week,preferred_slots,auto_choose,enabled from public.schedules where profile_id=${profile.id}::uuid and provider is not null and enabled=true and posts_per_week>0 order by provider asc` as unknown as ScheduleRow[];
    for(const schedule of schedules){if(result.generated>=maxGenerations)break;const desired=Math.min(Math.max(Math.floor(schedule.posts_per_week),0),21);if(!desired)continue;const jobs=await sql`select provider,scheduled_at from public.publication_jobs where profile_id=${profile.id}::uuid and provider=${schedule.provider} and scheduled_at>${now.toISOString()}::timestamptz and scheduled_at<${horizon}::timestamptz and state in ('SCHEDULED','BLOCKED_APPROVAL','QUEUED') order by scheduled_at asc` as unknown as JobRow[];if(jobs.length>=desired)continue;const learning=await activeLearningInsights(sql,profile.id);const learnedTiming=learnedTimingPreference(profile.id,schedule.provider,learning);const usedDates=new Set(jobs.map(job=>localDateKey(new Date(job.scheduled_at),schedule.timezone||profile.timezone||"Europe/Rome")));const candidates=candidateSlots(schedule,now,learnedTiming).filter(slot=>!usedDates.has(localDateKey(new Date(slot.scheduledAt),schedule.timezone||profile.timezone||"Europe/Rome")));const missing=Math.max(desired-jobs.length,0);
      for(const slot of candidates.slice(0,missing)){if(result.generated>=maxGenerations)break;try{const created=await createPlannedContent({sql,env:env as Required<Pick<AutopilotEnv,"OPENAI_API_KEY">>&AutopilotEnv,profile,strategy,provider:schedule.provider,scheduledAt:slot.scheduledAt,timingSource:slot.timingSource,approvalMode:settings.approvalMode,allowImageGeneration});result.generated+=1;if(created.scheduled)result.scheduled+=1;if(created.blocked)result.blockedForReview+=1;}catch(reason){const detail=reason instanceof Error?reason.message:"AUTOPILOT_GENERATION_FAILED";result.errors.push(`${profile.id}:${schedule.provider}:${detail}`);if(detail==="AUTOPILOT_ACTIVITY_BUDGET_STOP")return result;}}
    }
  }catch(reason){result.errors.push(`${profile.id}:${reason instanceof Error?reason.message:"AUTOPILOT_PROFILE_FAILED"}`);}}
  return result;
}
