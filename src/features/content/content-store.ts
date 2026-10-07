import { neonClient } from "../../lib/neon-client";
import { authenticatedApiToken } from "../../lib/auth-token";
import type { GeneratedSocialContent } from "../../../api/_lib/openai-text";
import type { ManualEditorialContext } from "./manual-content-generation";
import { normalizeHashtags, variantKey, type ApprovalStatus } from "./content-workflow";

export type { ApprovalStatus, ContentStatus } from "./content-workflow";

export type ContentItemRow = {
  id: string;
  profile_id: string;
  topic: string;
  objective: string | null;
  title: string | null;
  status: string;
  pillar: string | null;
  source_profile_id: string | null;
  source_profile_ids: string[];
  source_refs: unknown[];
  audience: Record<string, unknown>;
  fact_provenance: unknown[];
  editorial_cta: string | null;
  source_mix_approved: boolean;
  decision_record: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ContentVariantRow = {
  id: string;
  content_id: string;
  profile_id: string;
  provider: string;
  format: string;
  eligible: boolean;
  hook: string | null;
  caption: string;
  cta: string | null;
  hashtags: string[];
  visual_brief: string | null;
  image_asset_id: string | null;
  visual_generation_status: "NOT_STARTED" | "GENERATING" | "PASS" | "FAIL";
  visual_generation_error: string | null;
  visual_generation_operation_id: string | null;
  visual_generation_started_at: string | null;
  visual_generation_updated_at: string | null;
  alt_text: string | null;
  approval_status: ApprovalStatus;
  approval_mode: "MANUAL" | "AUTO";
  workflow_status: "DRAFT" | "REVIEW" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED";
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  approved_fingerprint: string | null;
  factual_basis: string[];
  qa_status: "PENDING" | "PASS" | "FAIL" | "NEEDS_SOURCE";
  qa_fingerprint: string | null;
  qa_result: Record<string, unknown>;
  qa_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentCarouselSlideRow = {
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
  visual_generation_status: "NOT_STARTED" | "GENERATING" | "PASS" | "FAIL";
  visual_generation_error: string | null;
  visual_generation_operation_id: string | null;
  visual_generation_started_at: string | null;
  visual_generation_updated_at: string | null;
  width: number;
  height: number;
  qa_status: "PENDING" | "PASS" | "BLOCK" | "FAILED";
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  profile_id: string;
  source: string;
  kind: string;
  name: string;
  storage_url: string;
  mime_type: string | null;
  metadata: Record<string, unknown>;
  content_id?: string | null;
  provider?: "REAL_ASSET" | "OPENAI" | "HIGGSFIELD" | null;
  model?: string | null;
  cost_eur?: number;
  width?: number | null;
  height?: number | null;
  format?: string | null;
  quality_status?: "PENDING" | "PASS" | "BLOCK" | "FAILED";
  identity_status?: "NOT_REQUIRED" | "PENDING" | "PASS" | "BLOCK";
  publication_usage?: number;
  reuse_count?: number;
  created_at: string;
};
export type StoredMasterDecision = { contentId?: string; rationale?: string; channels?: unknown };

export type SavedGeneration = {
  contentId: string;
  variantIds: Record<string, string>;
};

export type ContentQaApiResult = {
  runId: string;
  profileId: string;
  contentId: string;
  variantId: string;
  contentFingerprint: string;
  overallStatus: "PASS" | "FAIL" | "NEEDS_SOURCE";
  brandStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
  copyStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
  visualStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
  factStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
  platformStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
  duplicateStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
  budgetStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
  reasons: string[];
  slides: Array<{
    slideId: string;
    slideNumber: number;
    copyStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
    visualStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
    factStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
    brandStatus: "PASS" | "FAIL" | "NEEDS_SOURCE" | "SKIP";
    qualityStatus: "PASS" | "FAIL" | "NEEDS_SOURCE";
    reason: string;
  }>;
  checkedAt: string;
  reused: boolean;
};

type ReviewResponse = {
  variantId?: string;
  approvalStatus?: ApprovalStatus;
  workflowStatus?: "DRAFT" | "REVIEW" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED";
  contentStatus?: "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED";
  updatedAt?: string;
  error?: string;
};

export async function saveGeneratedContent(input: {
  profileId: string;
  topic: string;
  objective: string | null;
  content: GeneratedSocialContent;
  editorialContext?: ManualEditorialContext | null;
}): Promise<SavedGeneration> {
  const contentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const variantRows = input.content.variants.map((variant, index) => ({
    id: crypto.randomUUID(),
    content_id: contentId,
    profile_id: input.profileId,
    provider: variant.provider,
    format: variant.format,
    eligible: variant.eligible,
    hook: variant.hook,
    caption: variant.caption,
    cta: variant.cta,
    hashtags: variant.hashtags,
    visual_brief: variant.visualBrief,
    alt_text: variant.altText,
    factual_basis: variant.factualBasis,
    approval_status: "PENDING" as ApprovalStatus,
    approval_mode: "MANUAL" as const,
    workflow_status: "DRAFT" as const,
    updated_at: now,
    _key: variantKey(variant.provider, variant.format, index),
  }));

  const editorial = input.editorialContext;
  const sourceRefs = editorial ? [
    ...editorial.sourceRefs,
    ...editorial.externalSources.map((url) => ({ type: "EXTERNAL_SOURCE", url })),
  ] : [];
  const factProvenance = editorial ? [
    ...editorial.factProvenance,
    ...editorial.externalSources.map((url) => ({ source_type: "EXTERNAL_SOURCE", url })),
  ] : [];
  const ctas = input.content.variants.map((variant) => variant.cta?.trim()).filter((value): value is string => Boolean(value));
  const itemPayload = {
    id: contentId,
    profile_id: input.profileId,
    topic: input.content.editorialTopic.trim(),
    objective: input.objective?.trim() || null,
    title: input.content.editorialAngle.slice(0, 240),
    status: "IN_REVIEW",
    pillar: input.content.pillar?.trim() || editorial?.pillar || null,
    decision_record: {
      source: "MANUAL",
      requestedTopic: input.topic.trim(),
      editorialTopic: input.content.editorialTopic,
      editorialAngle: input.content.editorialAngle,
      pillar: input.content.pillar?.trim() || editorial?.pillar || null,
      strategySummary: input.content.strategySummary,
      generatedAt: now,
      variants: input.content.variants.map((variant) => ({
        provider: variant.provider,
        format: variant.format,
        eligible: variant.eligible,
        carouselSlideCount: variant.carouselSlides?.length ?? 0,
      })),
    },
    updated_at: now,
    ...(editorial?.profileType === "PERSONAL_BRAND" ? {
      source_profile_id: editorial.sourceProfileId,
      source_profile_ids: editorial.sourceProfileIds,
      source_refs: sourceRefs,
      audience: editorial.audience,
      fact_provenance: factProvenance,
      editorial_cta: ctas[0] ?? "NONE",
      source_mix_approved: false,
    } : {}),
  };
  const item = await neonClient.from("content_items").insert(itemPayload).select("id").single();
  if (item.error || !item.data) throw new Error("Impossibile salvare il contenuto. Riprova.");

  const payload = variantRows.map(({ _key, ...row }) => row);
  const variants = await neonClient.from("content_variants").insert(payload).select("id,provider,format");
  if (variants.error) {
    await neonClient.from("content_items").delete().eq("id", contentId).eq("profile_id", input.profileId);
    throw new Error("Impossibile salvare il contenuto. Riprova.");
  }

  const carouselRows = input.content.variants.flatMap((variant, variantIndex) =>
    (variant.format === "CAROUSEL" ? (variant.carouselSlides ?? []) : []).map((slide) => ({
      id: crypto.randomUUID(),
      profile_id: input.profileId,
      content_id: contentId,
      variant_id: variantRows[variantIndex].id,
      position: slide.position,
      purpose: slide.purpose.trim(),
      headline: slide.headline.trim(),
      body: slide.body.trim(),
      hierarchy: slide.hierarchy.trim(),
      visual_brief: slide.visualBrief.trim(),
      alt_text: slide.altText.trim(),
      asset_id: null,
      width: 1080,
      height: 1080,
      qa_status: "PENDING",
      updated_at: now,
    })),
  );
  if (carouselRows.length) {
    const slides = await neonClient.from("content_carousel_slides").insert(carouselRows).select("id");
    if (slides.error) {
      await neonClient.from("content_items").delete().eq("id", contentId).eq("profile_id", input.profileId);
      throw new Error("Impossibile salvare le slide del carosello. Riprova.");
    }
  }

  return {
    contentId,
    variantIds: Object.fromEntries(variantRows.map((row) => [row._key, row.id])),
  };
}

export async function loadContentWorkflow(profileId: string) {
  const itemsResult = await neonClient.from("content_items")
    .select("id,profile_id,topic,objective,title,status,pillar,source_profile_id,source_profile_ids,source_refs,audience,fact_provenance,editorial_cta,source_mix_approved,decision_record,created_at,updated_at")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (itemsResult.error) throw new Error("Impossibile caricare i contenuti. Riprova.");
  const items = (itemsResult.data ?? []) as ContentItemRow[];
  if (!items.length) return { items: [], variants: [] as ContentVariantRow[], carouselSlides: [] as ContentCarouselSlideRow[], assets: [] as AssetRow[], masterDecisions: {} as Record<string, StoredMasterDecision> };

  const contentIds = items.map((item) => item.id);
  const variantsResult = await neonClient.from("content_variants")
    .select("id,content_id,profile_id,provider,format,eligible,hook,caption,cta,hashtags,visual_brief,image_asset_id,visual_generation_status,visual_generation_error,visual_generation_operation_id,visual_generation_started_at,visual_generation_updated_at,alt_text,approval_status,approval_mode,workflow_status,approved_by,approved_at,rejected_reason,approved_fingerprint,factual_basis,qa_status,qa_fingerprint,qa_result,qa_checked_at,created_at,updated_at")
    .eq("profile_id", profileId)
    .in("content_id", contentIds)
    .order("created_at", { ascending: true });
  if (variantsResult.error) throw new Error("Impossibile caricare i contenuti. Riprova.");
  const rawVariants = (variantsResult.data ?? []) as Array<Omit<ContentVariantRow, "hashtags"> & { hashtags: unknown }>;
  const variants = rawVariants.map((row) => ({ ...row, hashtags: normalizeHashtags(row.hashtags) })) as ContentVariantRow[];

  const variantIds = variants.map((variant) => variant.id);
  let carouselSlides: ContentCarouselSlideRow[] = [];
  if (variantIds.length) {
    const slidesResult = await neonClient.from("content_carousel_slides")
      .select("id,profile_id,content_id,variant_id,position,purpose,headline,body,hierarchy,visual_brief,alt_text,asset_id,visual_generation_status,visual_generation_error,visual_generation_operation_id,visual_generation_started_at,visual_generation_updated_at,width,height,qa_status,created_at,updated_at")
      .eq("profile_id", profileId)
      .in("variant_id", variantIds)
      .order("position", { ascending: true });
    if (slidesResult.error) throw new Error("Impossibile caricare le slide dei caroselli. Riprova.");
    carouselSlides = (slidesResult.data ?? []) as ContentCarouselSlideRow[];
  }

  const assetIds = Array.from(new Set([
    ...variants.map((variant) => variant.image_asset_id),
    ...carouselSlides.map((slide) => slide.asset_id),
  ].filter((id): id is string => typeof id === "string" && Boolean(id))));
  let assets: AssetRow[] = [];
  if (assetIds.length) {
    const assetsResult = await neonClient.from("assets")
      .select("id,profile_id,source,kind,name,storage_url,mime_type,metadata,created_at")
      .eq("profile_id", profileId)
      .in("id", assetIds);
    if (assetsResult.error) throw new Error("Impossibile caricare i contenuti. Riprova.");
    assets = (assetsResult.data ?? []) as AssetRow[];
  }

  const strategyResult = await neonClient.from("content_strategies").select("platform_strategy").eq("profile_id", profileId).maybeSingle();
  const platformStrategy = strategyResult.data?.platform_strategy;
  const rawDecisions = platformStrategy && typeof platformStrategy === "object" && !Array.isArray(platformStrategy) ? (platformStrategy as Record<string, unknown>).masterEditorialDecisions : null;
  const masterDecisions = rawDecisions && typeof rawDecisions === "object" && !Array.isArray(rawDecisions) ? Object.values(rawDecisions as Record<string, StoredMasterDecision>).reduce<Record<string, StoredMasterDecision>>((map, decision) => { if (decision && typeof decision.contentId === "string") map[decision.contentId] = decision; return map; }, {}) : {};
  return { items, variants, carouselSlides, assets, masterDecisions };
}

export async function reviewVariant(input: {
  profileId: string;
  variantId: string;
  contentId: string;
  expectedUpdatedAt: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  visualBrief: string;
  altText: string;
  approvalStatus: ApprovalStatus;
  rejectedReason?: string | null;
}) {
  const token = await authenticatedApiToken();
  const response = await fetch("/api/content-review", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...input, hashtags: normalizeHashtags(input.hashtags) }),
  });
  const body = await response.json() as ReviewResponse;
  if (!response.ok || !body.variantId || !body.approvalStatus || !body.workflowStatus || !body.contentStatus || !body.updatedAt) {
    if (response.status === 409) throw new Error("Il contenuto è stato modificato in un’altra sessione. Aggiorna la pagina prima di continuare.");
    if (response.status === 403 || response.status === 404) throw new Error("Non puoi modificare questo contenuto.");
    throw new Error("Revisione non salvata. Riprova.");
  }
  return { approvalStatus: body.approvalStatus, workflowStatus: body.workflowStatus, contentStatus: body.contentStatus, updatedAt: body.updatedAt };
}

export async function deleteContent(profileId: string, contentId: string) {
  const result = await neonClient.from("content_items").delete().eq("id", contentId).eq("profile_id", profileId).select("id");
  if (result.error) throw new Error("Impossibile eliminare il contenuto. Riprova.");
  // Gli asset restano nella Libreria: content_id usa ON DELETE SET NULL e l'immagine
  // può essere riutilizzata da contenuti futuri invece di essere distrutta col post.
}


export async function runVariantQa(input: { profileId: string; contentId: string; variantId: string; force?: boolean }) {
  const token = await authenticatedApiToken();
  const response = await fetch("/api/content-qa", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json() as ContentQaApiResult & { error?: string };
  if (!response.ok || !body.runId || !body.overallStatus) {
    if (response.status === 409) throw new Error("Il QA è già in corso o deve essere riavviato.");
    if (response.status === 429) throw new Error("Budget o limite QA raggiunto per questa attività.");
    if (body.error === "CONTENT_QA_PROVIDER_RATE_LIMITED") throw new Error("OpenAI è momentaneamente saturo: il QA non è fallito. Riprova tra pochi minuti.");
    if (response.status === 404) throw new Error("Contenuto non trovato.");
    throw new Error("Content QA non completato. Riprova.");
  }
  return body;
}
