import { neon } from "@neondatabase/serverless";
import { ActivityBudgetEngine } from "./activity-budget.js";
import { findNearDuplicate, type ContentDedupeCandidate } from "./content-dedupe.js";
import { EntitlementUsageService } from "./entitlement-usage.js";
import { estimateTerraCostUsd, type GeneratedSocialContent, type GeneratedVariant, type SocialFormat, type SocialProvider } from "./openai-text.js";
import { runOpenAIEditorialQA } from "./openai-editorial-qa.js";
import { runOpenAIFactCheckAgent, type FactCheckAgentResult, type FactCheckClaim } from "./openai-research-factcheck.js";
import { runOpenAIVisualQa, type OpenAIVisualQaResult } from "./openai-visual-qa.js";
import { loadEditorialProfile, loadProfileBrandContext } from "./personal-brand-sources.js";
import { normalizeBrandVisualIdentity } from "./brand-visual-identity.js";

export type ContentQaDimensionStatus = "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
export type ContentQaOverallStatus = "PASS" | "FAIL" | "NEEDS_SOURCE";

export type CarouselSlideQaResult = {
  slideId: string;
  slideNumber: number;
  copyStatus: ContentQaDimensionStatus;
  visualStatus: ContentQaDimensionStatus;
  factStatus: ContentQaDimensionStatus;
  brandStatus: ContentQaDimensionStatus;
  qualityStatus: ContentQaOverallStatus;
  reason: string;
};

export type ContentQaRunResult = {
  runId: string;
  profileId: string;
  contentId: string;
  variantId: string;
  contentFingerprint: string;
  overallStatus: ContentQaOverallStatus;
  brandStatus: ContentQaDimensionStatus;
  copyStatus: ContentQaDimensionStatus;
  visualStatus: ContentQaDimensionStatus;
  factStatus: ContentQaDimensionStatus;
  platformStatus: ContentQaDimensionStatus;
  duplicateStatus: ContentQaDimensionStatus;
  budgetStatus: ContentQaDimensionStatus;
  reasons: string[];
  factCheck: {
    verdict: FactCheckAgentResult["verdict"] | "SKIPPED";
    claims: FactCheckClaim[];
    sources: string[];
  };
  visual: {
    assetId: string | null;
    identityStatus: ContentQaDimensionStatus;
    result: OpenAIVisualQaResult | null;
  };
  slides: CarouselSlideQaResult[];
  checkedAt: string;
  reused: boolean;
};

type ItemRow = {
  id: string;
  profile_id: string;
  topic: string;
  objective: string | null;
  title: string | null;
  pillar: string | null;
  source_refs: unknown;
  fact_provenance: unknown;
  decision_record: unknown;
};

type VariantRow = {
  id: string;
  content_id: string;
  profile_id: string;
  provider: SocialProvider;
  format: SocialFormat;
  eligible: boolean;
  hook: string | null;
  caption: string | null;
  cta: string | null;
  hashtags: unknown;
  visual_brief: string | null;
  image_asset_id: string | null;
  alt_text: string | null;
  factual_basis: unknown;
  qa_status: ContentQaOverallStatus | "PENDING";
  qa_fingerprint: string | null;
  qa_result: unknown;
  qa_checked_at: string | null;
};

type SlideRow = {
  id: string;
  profile_id: string;
  content_id: string;
  variant_id: string;
  position: number;
  purpose: string;
  headline: string;
  body: string;
  hierarchy: string;
  visual_brief: string;
  alt_text: string;
  asset_id: string | null;
  width: number;
  height: number;
};

type AssetRow = {
  id: string;
  profile_id: string;
  provider: "REAL_ASSET" | "OPENAI" | "HIGGSFIELD" | null;
  model: string | null;
  storage_url: string;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  format: string | null;
  quality_status: "PENDING" | "PASS" | "BLOCK" | "FAILED";
  identity_status: "NOT_REQUIRED" | "PENDING" | "PASS" | "BLOCK";
};

type RecentRow = {
  id: string;
  topic: string;
  title: string | null;
  hook: string | null;
  caption: string | null;
};

type QaActor = "MANUAL" | "AUTOPILOT" | "SYSTEM";
type Sql = ReturnType<typeof neon>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEB_SEARCH_COST_USD = 0.01;

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function urlsFrom(value: unknown, found = new Set<string>(), depth = 0): string[] {
  if (depth > 4 || found.size >= 20 || value == null) return [...found];
  if (typeof value === "string") {
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") found.add(parsed.toString());
    } catch { /* not a URL */ }
    return [...found];
  }
  if (Array.isArray(value)) {
    for (const entry of value) urlsFrom(entry, found, depth + 1);
    return [...found];
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) urlsFrom(entry, found, depth + 1);
  }
  return [...found];
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

async function sha256(value: unknown) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function overallFrom(statuses: ContentQaDimensionStatus[]): ContentQaOverallStatus {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("NEEDS_SOURCE")) return "NEEDS_SOURCE";
  return "PASS";
}

function factClaimStatus(claim: FactCheckClaim): ContentQaDimensionStatus {
  if (claim.status === "VERIFIED" || claim.status === "NOT_FACTUAL") return "PASS";
  if (claim.status === "CONTRADICTED") return "FAIL";
  if (claim.status === "TIME_SENSITIVE") return "NEEDS_SOURCE";
  if (claim.status === "UNSUPPORTED") {
    return claim.claimType === "EXTERNAL" && claim.sourceRequired ? "NEEDS_SOURCE" : "FAIL";
  }
  return "FAIL";
}

function factStatus(result: FactCheckAgentResult): ContentQaDimensionStatus {
  if (result.verdict === "PASS") return "PASS";
  if (result.verdict === "NEEDS_SOURCE") return "NEEDS_SOURCE";
  return "FAIL";
}

function editorialCopyStatus(checks: Awaited<ReturnType<typeof runOpenAIEditorialQA>>["checks"]): ContentQaDimensionStatus {
  return checks.copyQuality === "PASS"
    && checks.grammar === "PASS"
    && checks.ctaFit === "PASS"
    && checks.hashtagFit === "PASS"
    ? "PASS" : "FAIL";
}

function editorialPlatformStatus(checks: Awaited<ReturnType<typeof runOpenAIEditorialQA>>["checks"]): ContentQaDimensionStatus {
  return checks.platformFit === "PASS" && checks.formatFit === "PASS" ? "PASS" : "FAIL";
}

function expectedAspect(format: SocialFormat) {
  return format === "STORY" ? 2 / 3 : 1;
}

function assetDimensionsFit(asset: AssetRow, format: SocialFormat) {
  if (!asset.width || !asset.height) return false;
  return Math.abs(asset.width / asset.height - expectedAspect(format)) <= 0.08;
}

function identityStatus(profileType: "BUSINESS" | "PERSONAL_BRAND", asset: AssetRow): ContentQaDimensionStatus {
  if (profileType !== "PERSONAL_BRAND") return "PASS";
  if (asset.provider === "REAL_ASSET") return "PASS";
  return asset.identity_status === "PASS" ? "PASS" : "FAIL";
}

function variantFrom(variant: VariantRow, slides: SlideRow[]): GeneratedVariant {
  return {
    provider: variant.provider,
    format: variant.format,
    eligible: variant.eligible,
    hook: variant.hook ?? "",
    caption: variant.caption ?? "",
    cta: variant.cta,
    hashtags: strings(variant.hashtags),
    visualBrief: variant.visual_brief ?? "",
    altText: variant.alt_text ?? "",
    factualBasis: strings(variant.factual_basis),
    carouselSlides: variant.format === "CAROUSEL" ? slides.map((slide) => ({
      position: slide.position,
      purpose: slide.purpose,
      headline: slide.headline,
      body: slide.body,
      hierarchy: slide.hierarchy,
      visualBrief: slide.visual_brief,
      altText: slide.alt_text,
    })) : [],
  };
}

function generatedContent(item: ItemRow, variant: GeneratedVariant): GeneratedSocialContent {
  const decision = object(item.decision_record);
  return {
    editorialTopic: item.topic,
    pillar: item.pillar ?? undefined,
    editorialAngle: item.title ?? item.topic,
    strategySummary: typeof decision.strategySummary === "string" ? decision.strategySummary : "",
    variants: [variant],
  };
}

function projectedQaCostUsd(format: SocialFormat, slideCount: number) {
  const visualCalls = format === "CAROUSEL" ? Math.max(slideCount, 1) : 1;
  return Math.max(0.12, Math.min(0.75, 0.12 + visualCalls * 0.05));
}

async function recentContent(sql: Sql, profileId: string, contentId: string): Promise<ContentDedupeCandidate[]> {
  const rows = await sql`
    select ci.id::text,ci.topic,ci.title,cv.hook,cv.caption
    from public.content_items ci
    join lateral (
      select hook,caption
      from public.content_variants
      where content_id=ci.id and profile_id=ci.profile_id
      order by created_at asc
      limit 1
    ) cv on true
    where ci.profile_id=${profileId}::uuid
      and ci.id<>${contentId}::uuid
    order by ci.created_at desc
    limit 60
  ` as unknown as RecentRow[];
  return rows.map((row) => ({ id: row.id, topic: row.topic, angle: row.title, hook: row.hook, caption: row.caption }));
}

async function persistTechnicalUsage(sql: Sql, profileId: string, usageEventId: string, events: Array<{
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  metadata?: Record<string, unknown>;
}>) {
  if (!events.length) return;
  const payload = events.map((event) => ({
    operation: event.operation,
    model: event.model,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    cost_usd: event.costUsd,
    metadata: { ...(event.metadata ?? {}), logical_usage_event_id: usageEventId, logical_capability: "content.qa.run" },
  }));
  await sql`
    insert into public.ai_usage_events(profile_id,operation,model,input_tokens,output_tokens,cost_usd,metadata)
    select
      ${profileId}::uuid,
      event->>'operation',
      event->>'model',
      nullif(event->>'input_tokens','')::int,
      nullif(event->>'output_tokens','')::int,
      nullif(event->>'cost_usd','')::numeric,
      coalesce(event->'metadata','{}'::jsonb)
    from jsonb_array_elements(${JSON.stringify(payload)}::jsonb) event
    where not exists (
      select 1 from public.ai_usage_events existing
      where existing.profile_id=${profileId}::uuid
        and existing.operation=event->>'operation'
        and existing.metadata->>'logical_usage_event_id'=${usageEventId}
        and coalesce(existing.metadata->>'asset_id','')=coalesce(event->'metadata'->>'asset_id','')
        and coalesce(existing.metadata->>'slide_id','')=coalesce(event->'metadata'->>'slide_id','')
    )
  `;
}

async function persistResult(sql: Sql, result: ContentQaRunResult, actorType: QaActor) {
  await sql`select public.persist_content_qa_result(
    ${result.profileId}::uuid,
    ${result.contentId}::uuid,
    ${result.variantId}::uuid,
    ${result.runId}::uuid,
    ${result.contentFingerprint},
    ${result.overallStatus},
    ${result.brandStatus},
    ${result.copyStatus},
    ${result.visualStatus},
    ${result.factStatus},
    ${result.platformStatus},
    ${result.duplicateStatus},
    ${result.budgetStatus},
    ${result.reasons.join(" | ").slice(0,1500)},
    ${JSON.stringify(result)}::jsonb,
    ${actorType},
    ${JSON.stringify(result.slides)}::jsonb
  )`;
}

async function loadInputs(sql: Sql, profileId: string, contentId: string, variantId: string) {
  const items = await sql`
    select id::text,profile_id::text,topic,objective,title,pillar,source_refs,fact_provenance,decision_record
    from public.content_items
    where id=${contentId}::uuid and profile_id=${profileId}::uuid
    limit 1
  ` as unknown as ItemRow[];
  const variants = await sql`
    select id::text,content_id::text,profile_id::text,provider,format,eligible,hook,caption,cta,hashtags,
           visual_brief,image_asset_id::text,alt_text,factual_basis,qa_status,qa_fingerprint,qa_result,qa_checked_at::text
    from public.content_variants
    where id=${variantId}::uuid and content_id=${contentId}::uuid and profile_id=${profileId}::uuid
    limit 1
  ` as unknown as VariantRow[];
  if (!items[0] || !variants[0]) throw new Error("CONTENT_QA_NOT_FOUND");

  const slides = variants[0].format === "CAROUSEL" ? await sql`
    select id::text,profile_id::text,content_id::text,variant_id::text,position,purpose,headline,body,hierarchy,
           visual_brief,alt_text,asset_id::text,width,height
    from public.content_carousel_slides
    where profile_id=${profileId}::uuid and variant_id=${variantId}::uuid
    order by position asc
  ` as unknown as SlideRow[] : [];

  const assetIds = [...new Set([
    variants[0].image_asset_id,
    ...slides.map((slide) => slide.asset_id),
  ].filter((id): id is string => Boolean(id)))];
  const assets = assetIds.length ? await sql`
    select id::text,profile_id::text,provider,model,storage_url,mime_type,width,height,format,quality_status,identity_status
    from public.assets
    where profile_id=${profileId}::uuid and id = any(${assetIds}::uuid[])
  ` as unknown as AssetRow[] : [];

  return { item: items[0], variant: variants[0], slides, assets };
}

export async function runContentQa(input: {
  databaseUrl: string;
  apiKey: string;
  profileId: string;
  contentId: string;
  variantId: string;
  actorType: QaActor;
  authUserId?: string | null;
  force?: boolean;
  fetcher?: typeof fetch;
}): Promise<ContentQaRunResult> {
  if (!input.databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  if (!input.apiKey) throw new Error("OPENAI_NOT_CONFIGURED");
  if (![input.profileId,input.contentId,input.variantId].every((value) => UUID.test(value))) throw new Error("CONTENT_QA_INPUT_INVALID");

  const sql = neon(input.databaseUrl);
  const profile = await loadEditorialProfile(sql,input.profileId,input.authUserId ?? null);
  const brandContext = await loadProfileBrandContext(sql,profile);
  const brandVisual = normalizeBrandVisualIdentity(brandContext.visualIdentity);
  const { item,variant,slides,assets } = await loadInputs(sql,input.profileId,input.contentId,input.variantId);
  const generatedVariant = variantFrom(variant,slides);
  const content = generatedContent(item,generatedVariant);
  const assetMap = new Map(assets.map((asset)=>[asset.id,asset]));
  const fingerprint = await sha256({
    item:{topic:item.topic,objective:item.objective,title:item.title,pillar:item.pillar,sourceRefs:item.source_refs,factProvenance:item.fact_provenance},
    variant:generatedVariant,
    imageAssetId:variant.image_asset_id,
    slides,
    assets:assets.map((asset)=>({id:asset.id,provider:asset.provider,model:asset.model,width:asset.width,height:asset.height,format:asset.format,identityStatus:asset.identity_status})),
    brandVisual,
  });

  if (!input.force && variant.qa_fingerprint===fingerprint && variant.qa_status!=="PENDING") {
    const cached = object(variant.qa_result) as unknown as ContentQaRunResult;
    if (cached?.contentFingerprint===fingerprint && cached.variantId===variant.id) return {...cached,reused:true};
  }

  const usage = new EntitlementUsageService(input.databaseUrl);
  const idempotencyKey = input.force
    ? `content-qa:v1:${input.variantId}:${fingerprint}:${crypto.randomUUID()}`
    : `content-qa:v1:${input.variantId}:${fingerprint}`;
  const reservation = await usage.reserveUsage({
    profileId:input.profileId,
    capabilityKey:"content.qa.run",
    quantity:1,
    idempotencyKey,
    source:`CONTENT_QA_${input.actorType}`,
    referenceId:input.variantId,
    metadata:{content_id:input.contentId,variant_id:input.variantId,fingerprint},
  });
  if (!reservation.allowed) throw new Error(reservation.reason==="ENTITLEMENT_DISABLED"?"CONTENT_QA_DISABLED":"CONTENT_QA_LIMIT_REACHED");
  const usageEventId = reservation.result?.event_id;
  if (!usageEventId) throw new Error("CONTENT_QA_METERING_FAILED");

  if (reservation.result?.duplicate) {
    const existing = await usage.getUsageEvent(usageEventId);
    const cached = object(variant.qa_result) as unknown as ContentQaRunResult;
    if (existing?.state==="COMMITTED" && cached?.contentFingerprint===fingerprint) return {...cached,reused:true};
    if (existing?.state==="RESERVED") throw new Error("CONTENT_QA_IN_PROGRESS");
    throw new Error("CONTENT_QA_RETRY_REQUIRED");
  }

  let committed=false;
  try {
    const budget = await new ActivityBudgetEngine(input.databaseUrl).preflight({
      profileId:input.profileId,
      task:"COPY_FINAL",
      importance:"STANDARD",
      projectedOperationCostUsd:projectedQaCostUsd(variant.format,slides.length),
      costBucket:"OTHER_AI",
    });

    const runId=crypto.randomUUID();
    const checkedAt=new Date().toISOString();

    if (!budget.allowed) {
      const blocked:ContentQaRunResult={
        runId,profileId:input.profileId,contentId:input.contentId,variantId:input.variantId,contentFingerprint:fingerprint,
        overallStatus:"FAIL",
        brandStatus:"SKIP",copyStatus:"SKIP",visualStatus:"SKIP",factStatus:"SKIP",platformStatus:"SKIP",duplicateStatus:"SKIP",budgetStatus:"FAIL",
        reasons:[budget.reason??"AI_BUDGET_HARD_STOP"],
        factCheck:{verdict:"SKIPPED",claims:[],sources:[]},
        visual:{assetId:variant.image_asset_id,identityStatus:"SKIP",result:null},
        slides:slides.map((slide)=>({slideId:slide.id,slideNumber:slide.position,copyStatus:"SKIP",visualStatus:"SKIP",factStatus:"SKIP",brandStatus:"SKIP",qualityStatus:"FAIL",reason:"Budget QA FAIL"})),
        checkedAt,reused:false,
      };
      await persistResult(sql,blocked,input.actorType);
      if (input.actorType === "MANUAL") await sql`select public.mark_content_variant_in_review(${input.profileId}::uuid,${input.variantId}::uuid)`;
      await usage.releaseUsage(usageEventId);
      return blocked;
    }

    await usage.markProviderStarted(usageEventId);

    const duplicate=findNearDuplicate(
      {id:item.id,topic:item.topic,angle:item.title,hook:variant.hook,caption:variant.caption},
      await recentContent(sql,input.profileId,input.contentId),
    );
    const duplicateStatus:ContentQaDimensionStatus=duplicate?"FAIL":"PASS";

    const existingSources=urlsFrom(item.source_refs);
    const factCheck=await runOpenAIFactCheckAgent({
      apiKey:input.apiKey,
      topic:item.topic,
      content:{
        generated:content,
        brandFacts:{
          name:brandContext.brand.profileName,
          industry:brandContext.brand.industry,
          websiteUrl:brandContext.brand.websiteUrl,
          description:brandContext.brand.description,
          businessModel:brandContext.brand.businessModel,
          location:brandContext.brand.location,
          serviceArea:brandContext.brand.serviceArea,
          target:brandContext.brand.target,
          tone:brandContext.brand.tone,
          goals:brandContext.brand.goals,
          userProvidedContext:brandContext.brand.userContext??null,
        },
        confirmedWebsiteSources:brandContext.brand.confirmedWebsiteContent,
        factualBasis:generatedVariant.factualBasis,
        factProvenance:item.fact_provenance,
      },
      research:null,
      existingSources,
      allowWebSearch:true,
      fetcher:input.fetcher,
    });

    const editorialQa=await runOpenAIEditorialQA({
      apiKey:input.apiKey,
      profileName:profile.name,
      industry:profile.industry,
      tone:brandContext.brand.tone,
      provider:variant.provider,
      format:variant.format,
      objective:item.objective,
      content,
      variant:generatedVariant,
      verification:{researchAgentRan:false,factCheckAgentRan:true,factCheckVerdict:factCheck.verdict==="PASS"?"PASS":null},
      externalSources:factCheck.sources,
      fetcher:input.fetcher,
    });

    const visualEvents:Array<{operation:string;model:string;inputTokens:number;outputTokens:number;costUsd:number;metadata?:Record<string,unknown>}>= [];
    let globalVisualStatus:ContentQaDimensionStatus="FAIL";
    let variantVisualResult:OpenAIVisualQaResult|null=null;
    let variantIdentityStatus:ContentQaDimensionStatus="SKIP";

    if (variant.format!=="CAROUSEL") {
      const asset=variant.image_asset_id?assetMap.get(variant.image_asset_id):null;
      if (asset && assetDimensionsFit(asset,variant.format)) {
        variantIdentityStatus=identityStatus(profile.profile_type,asset);
        variantVisualResult=await runOpenAIVisualQa({
          apiKey:input.apiKey,
          imageUrl:asset.storage_url,
          profileName:profile.name,
          industry:profile.industry,
          provider:variant.provider,
          format:variant.format,
          visualBrief:variant.visual_brief??"",
          altText:variant.alt_text,
          brandColors:brandVisual.colors,
          brandFonts:brandVisual.fonts,
          brandVisualStyle:brandVisual.visualStyle,
          fetcher:input.fetcher,
        });
        globalVisualStatus=variantVisualResult.verdict==="PASS"&&variantIdentityStatus==="PASS"?"PASS":"FAIL";
        await sql`update public.assets set quality_status=${variantVisualResult.verdict==="PASS"?"PASS":"BLOCK"},updated_at=now() where id=${asset.id}::uuid and profile_id=${input.profileId}::uuid`;
        visualEvents.push({
          operation:"CONTENT_QA_VISUAL",
          model:variantVisualResult.model,
          inputTokens:variantVisualResult.usage.inputTokens,
          outputTokens:variantVisualResult.usage.outputTokens,
          costUsd:variantVisualResult.usage.estimatedCostUsd,
          metadata:{asset_id:asset.id,scope:"GLOBAL",verdict:variantVisualResult.verdict,identity_status:variantIdentityStatus},
        });
      }
    }

    const editorialSlides=new Map(editorialQa.slideChecks.map((slide)=>[slide.slideNumber,slide]));
    const slideResults:CarouselSlideQaResult[]=[];

    if (variant.format==="CAROUSEL") {
      for (const slide of slides) {
        const semantic=editorialSlides.get(slide.position);
        const claims=factCheck.checkedClaims.filter((claim)=>claim.slideNumber===slide.position);
        const slideFactStatus=claims.length?overallFrom(claims.map(factClaimStatus)):"PASS";
        const asset=slide.asset_id?assetMap.get(slide.asset_id):null;
        let slideVisualStatus:ContentQaDimensionStatus="FAIL";
        let visualReason=asset?"":"Asset mancante";

        if (asset && assetDimensionsFit(asset,"CAROUSEL")) {
          const identity=identityStatus(profile.profile_type,asset);
          const visualQa=await runOpenAIVisualQa({
            apiKey:input.apiKey,
            imageUrl:asset.storage_url,
            profileName:profile.name,
            industry:profile.industry,
            provider:variant.provider,
            format:"CAROUSEL",
            visualBrief:slide.visual_brief,
            altText:slide.alt_text,
            brandColors:brandVisual.colors,
            brandFonts:brandVisual.fonts,
            brandVisualStyle:brandVisual.visualStyle,
            fetcher:input.fetcher,
          });
          slideVisualStatus=visualQa.verdict==="PASS"&&identity==="PASS"?"PASS":"FAIL";
          visualReason=[visualQa.reason,identity==="FAIL"?"Identity QA non valida":""].filter(Boolean).join(" · ");
          await sql`update public.assets set quality_status=${visualQa.verdict==="PASS"?"PASS":"BLOCK"},updated_at=now() where id=${asset.id}::uuid and profile_id=${input.profileId}::uuid`;
          visualEvents.push({
            operation:"CONTENT_QA_VISUAL",
            model:visualQa.model,
            inputTokens:visualQa.usage.inputTokens,
            outputTokens:visualQa.usage.outputTokens,
            costUsd:visualQa.usage.estimatedCostUsd,
            metadata:{asset_id:asset.id,slide_id:slide.id,slide_number:slide.position,scope:"SLIDE",verdict:visualQa.verdict,identity_status:identity},
          });
        } else if (asset) {
          visualReason="Dimensioni o rapporto immagine non coerenti con il carosello.";
        }

        const copyStatus:ContentQaDimensionStatus=semantic?.copyStatus==="PASS"?"PASS":"FAIL";
        const brandStatus:ContentQaDimensionStatus=semantic?.brandStatus==="PASS"?"PASS":"FAIL";
        const qualityStatus=overallFrom([copyStatus,slideVisualStatus,slideFactStatus,brandStatus]);
        slideResults.push({
          slideId:slide.id,
          slideNumber:slide.position,
          copyStatus,
          visualStatus:slideVisualStatus,
          factStatus:slideFactStatus,
          brandStatus,
          qualityStatus,
          reason:[
            semantic?.reason,
            visualReason,
            claims.filter((claim)=>factClaimStatus(claim)!=="PASS").map((claim)=>claim.reason).join(" · "),
          ].filter(Boolean).join(" · ").slice(0,800),
        });
      }

      const structurallyComplete=slides.length>=4&&slides.length<=10
        && slides.every((slide,index)=>slide.position===index+1&&Boolean(slide.headline.trim())&&Boolean(slide.visual_brief.trim())&&Boolean(slide.alt_text.trim())&&Boolean(slide.asset_id));
      globalVisualStatus=structurallyComplete&&slideResults.every((slide)=>slide.visualStatus==="PASS")?"PASS":"FAIL";
    }

    const brandStatus:ContentQaDimensionStatus=editorialQa.checks.brandConsistency==="PASS"?"PASS":"FAIL";
    const copyStatus=editorialCopyStatus(editorialQa.checks);
    const globalFactStatus=factStatus(factCheck);
    const platformStatus=editorialPlatformStatus(editorialQa.checks);
    const budgetStatus:ContentQaDimensionStatus="PASS";
    const required:ContentQaDimensionStatus[]=[brandStatus,copyStatus,globalVisualStatus,globalFactStatus,platformStatus,duplicateStatus,budgetStatus];
    if (variant.format==="CAROUSEL") required.push(...slideResults.map((slide)=>slide.qualityStatus));
    const overallStatus=overallFrom(required);

    const reasons=[
      ...editorialQa.reasons,
      duplicate?`Duplicate QA: similarità ${duplicate.score.toFixed(3)} con contenuto precedente`:"",
      globalVisualStatus!=="PASS"?"Visual QA non superato o asset/formato non valido.":"",
      globalFactStatus==="NEEDS_SOURCE"?"Fact QA: una o più claim richiedono una fonte verificabile.":"",
      globalFactStatus==="FAIL"?"Fact QA: una o più claim risultano non supportate o contraddette.":"",
      ...slideResults.filter((slide)=>slide.qualityStatus!=="PASS").map((slide)=>`Slide ${slide.slideNumber}: ${slide.reason||"QA non superato"}`),
    ].filter(Boolean).slice(0,20);

    const result:ContentQaRunResult={
      runId,profileId:input.profileId,contentId:input.contentId,variantId:input.variantId,contentFingerprint:fingerprint,
      overallStatus,
      brandStatus,
      copyStatus,
      visualStatus:globalVisualStatus,
      factStatus:globalFactStatus,
      platformStatus,
      duplicateStatus,
      budgetStatus,
      reasons,
      factCheck:{verdict:factCheck.verdict,claims:factCheck.checkedClaims,sources:factCheck.sources},
      visual:{assetId:variant.image_asset_id,identityStatus:variantIdentityStatus,result:variantVisualResult},
      slides:slideResults,
      checkedAt,
      reused:false,
    };

    await persistResult(sql,result,input.actorType);
    if (input.actorType === "MANUAL") await sql`select public.mark_content_variant_in_review(${input.profileId}::uuid,${input.variantId}::uuid)`;

    const factCost=estimateTerraCostUsd(factCheck.usage.inputTokens,factCheck.usage.outputTokens)+factCheck.usage.webSearchCalls*WEB_SEARCH_COST_USD;
    await persistTechnicalUsage(sql,input.profileId,usageEventId,[
      {
        operation:"CONTENT_QA_FACT",
        model:factCheck.model,
        inputTokens:factCheck.usage.inputTokens,
        outputTokens:factCheck.usage.outputTokens,
        costUsd:factCost,
        metadata:{verdict:factCheck.verdict,sources:factCheck.sources},
      },
      {
        operation:"CONTENT_QA_EDITORIAL",
        model:editorialQa.model,
        inputTokens:editorialQa.usage.inputTokens,
        outputTokens:editorialQa.usage.outputTokens,
        costUsd:editorialQa.usage.estimatedCostUsd,
        metadata:{verdict:editorialQa.verdict,checks:editorialQa.checks},
      },
      ...visualEvents,
    ]);
    await usage.reconcileProviderCostAttempt(usageEventId);
    await usage.commitUsage(usageEventId);
    committed=true;
    return result;
  } catch (reason) {
    if (!committed) await usage.releaseUsage(usageEventId).catch(()=>undefined);
    throw reason;
  }
}
