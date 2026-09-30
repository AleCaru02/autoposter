import { neon } from "@neondatabase/serverless";
import { findNearDuplicate, type ContentDedupeCandidate } from "../api/_lib/content-dedupe.js";
import { enrichRequestedTopicWithPillars } from "../api/_lib/editorial-intelligence.js";
import { normalizeEditorialResearchMode } from "../api/_lib/editorial-research.js";
import { estimateTextRequestUpperBoundUsd, generateSocialText, OpenAITextPipelineError, type BrandContext, type SocialFormat, type SocialProvider } from "../api/_lib/openai-text.js";
import { ActivityBudgetEngine } from "../api/_lib/activity-budget.js";
import { TextGenerationMetering, technicalEventsFromTextResult } from "../api/_lib/text-generation-metering.js";
import { verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";
import { buildPersonalBrandEditorialContext, loadEditorialProfile, loadProfileBrandContext, resolvePersonalBrandSource } from "../api/_lib/personal-brand-sources.js";

const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<SocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<SocialFormat>(["POST", "CAROUSEL", "STORY"]);

type Env = {
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
};
type ProfileRow = { id: string; name: string; website_url: string | null; industry: string | null };
type BrandRow = { description: string | null; business_model: string | null; location: string | null; service_area: string | null; target_audience: unknown; tone_of_voice: unknown; goals: unknown; visual_identity: unknown; user_context: string | null };
type ScanRow = { id: string };
type PageRow = { url: string; title: string | null; content_text: string | null };

type RecentItemRow = { id: string; topic: string; title: string | null };
type RecentVariantRow = { content_id: string; hook: string | null; caption: string | null };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function bearer(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

async function dataApi(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${DATA_API}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
}

async function rows<T>(path: string, token: string): Promise<T[]> {
  const response = await dataApi(path, token);
  if (!response.ok) throw new Error(`DATA_API_${response.status}`);
  return response.json() as Promise<T[]>;
}

function summaryField(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const summary = (value as Record<string, unknown>).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

function publicGenerationError(detail: string) {
  if (detail === "OPENAI_FACTCHECK_NEEDS_SOURCE") return "FACTCHECK_NEEDS_SOURCE";
  if (detail === "OPENAI_FACTCHECK_BLOCK") return "FACTCHECK_BLOCKED";
  if (detail === "OPENAI_RESEARCH_BLOCKED" || detail === "AI_BRAIN_INSUFFICIENT_SOURCES") return "RESEARCH_INSUFFICIENT";
  if (detail.startsWith("METERING_FAILED")) return "METERING_FAILED";
  if (detail.startsWith("OPENAI_")) return "AI_PROVIDER_ERROR";
  return "GENERATION_FAILED";
}


export async function handleWorkerGenerateTextStatus(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { /* validated below */ }
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const operationIdentity = (request.headers.get("x-post-automatici-operation-id") || "").trim();
  if (!profileId || !/^[A-Za-z0-9._:-]{16,128}$/.test(operationIdentity)) return json({ error: "OPERATION_ID_REQUIRED" }, 400);
  let accessible: Array<{ id: string }> = [];
  try {
    accessible = await rows<{ id: string }>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, token);
  } catch (reason) {
    console.error("generate-text-status-profile", { profileId, detail: reason instanceof Error ? reason.message : "UNKNOWN" });
    return json({ error: "STATUS_UNAVAILABLE" }, 503);
  }
  if (!accessible.some((profile) => profile.id === profileId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);
  const meter = new TextGenerationMetering(env.DATABASE_URL);
  let status;
  try {
    status = await meter.getOperationStatus(profileId, "MANUAL", operationIdentity);
  } catch (reason) {
    console.error("generate-text-status", { profileId, detail: reason instanceof Error ? reason.message : "UNKNOWN" });
    return json({ error: "STATUS_UNAVAILABLE" }, 503);
  }
  if (!status) return json({ state: "NOT_FOUND", percent: 0, stage: "PREPARING" }, 200);
  const result = status.cached?.response && typeof status.cached.response === "object" ? status.cached.response : null;
  return json({
    state: status.state === "COMMITTED" ? "COMPLETED" : status.state === "RELEASED" ? "FAILED" : "IN_PROGRESS",
    percent: status.percent,
    stage: status.stage,
    error: status.releaseReason ? publicGenerationError(status.releaseReason) : null,
    result,
    createdAt: status.createdAt,
  });
}

async function recentContentForDedupe(profileId: string, token: string): Promise<ContentDedupeCandidate[]> {
  const items = await rows<RecentItemRow>(`content_items?profile_id=eq.${encodeURIComponent(profileId)}&select=id,topic,title&order=created_at.desc&limit=40`, token);
  if (!items.length) return [];
  const variants = await rows<RecentVariantRow>(`content_variants?profile_id=eq.${encodeURIComponent(profileId)}&select=content_id,hook,caption&order=updated_at.desc&limit=160`, token);
  const firstVariant = new Map<string, RecentVariantRow>();
  for (const variant of variants) if (!firstVariant.has(variant.content_id)) firstVariant.set(variant.content_id, variant);
  return items.map((item) => {
    const variant = firstVariant.get(item.id);
    return { id: item.id, topic: item.topic ?? "", angle: item.title, hook: variant?.hook ?? null, caption: variant?.caption ?? null };
  });
}

export async function handleWorkerGenerateText(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_NOT_CONFIGURED", message: "Configura OPENAI_API_KEY nel deployment Cloudflare." }, 503);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { /* validated below */ }
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 1_000) : "";
  const objective = typeof body.objective === "string" ? body.objective.trim().slice(0, 500) : null;
  const researchMode = normalizeEditorialResearchMode(body.researchMode);
  const requestedSourceProfileId = typeof body.sourceProfileId === "string" ? body.sourceProfileId.trim() || null : null;
  const requestedPillar = typeof body.pillar === "string" ? body.pillar.trim().slice(0, 160) || null : null;
  const operationIdentity = (request.headers.get("x-post-automatici-operation-id") || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(operationIdentity)) return json({ error: "OPERATION_ID_REQUIRED" }, 400);
  const providers = Array.isArray(body.providers) ? body.providers.filter((value): value is SocialProvider => typeof value === "string" && VALID_PROVIDERS.has(value as SocialProvider)) : [];
  const formats = Array.isArray(body.formats) ? body.formats.filter((value): value is SocialFormat => typeof value === "string" && VALID_FORMATS.has(value as SocialFormat)) : [];
  if (!profileId || !topic) return json({ error: "PROFILE_AND_TOPIC_REQUIRED" }, 400);
  if (!providers.length || !formats.length) return json({ error: "PROVIDERS_AND_FORMATS_REQUIRED" }, 400);

  let activeMeter: TextGenerationMetering | null = null;
  let activeEventId: string | null = null;
  let logicalCommitted = false;
  try {
    const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
    if (!authUserId) return json({ error: "AUTH_REQUIRED" }, 401);
    const sql = neon(env.DATABASE_URL);
    const profile = await loadEditorialProfile(sql, profileId, authUserId);
    const ownContext = await loadProfileBrandContext(sql, profile);
    let context: BrandContext = ownContext.brand;
    let editorialContext: {
      profileType: "BUSINESS" | "PERSONAL_BRAND";
      pillar: string | null;
      sourceProfileId: string | null;
      sourceProfileIds: string[];
      sourceRefs: unknown[];
      audience: Record<string, unknown>;
      factProvenance: unknown[];
    } = {
      profileType: profile.profile_type,
      pillar: null,
      sourceProfileId: null,
      sourceProfileIds: [],
      sourceRefs: [],
      audience: ownContext.audience,
      factProvenance: [],
    };

    if (profile.profile_type === "PERSONAL_BRAND") {
      if (!objective) return json({ error: "PERSONAL_BRAND_OBJECTIVE_REQUIRED" }, 400);
      const relation = await resolvePersonalBrandSource(sql, profileId, requestedSourceProfileId, requestedPillar);
      if (relation) {
        const resolved = await buildPersonalBrandEditorialContext(sql, profile, relation);
        if (!Object.keys(resolved.audience).length) return json({ error: "PERSONAL_BRAND_AUDIENCE_REQUIRED" }, 400);
        context = resolved.brand;
        editorialContext = {
          profileType: "PERSONAL_BRAND",
          pillar: relation.pillar,
          sourceProfileId: relation.source_profile_id,
          sourceProfileIds: [relation.source_profile_id],
          sourceRefs: resolved.sourceRefs,
          audience: resolved.audience,
          factProvenance: resolved.factProvenance,
        };
      } else {
        if (!Object.keys(ownContext.audience).length) return json({ error: "PERSONAL_BRAND_AUDIENCE_REQUIRED" }, 400);
        const ownPillar = profile.industry?.trim() || "Personal Brand";
        editorialContext = {
          profileType: "PERSONAL_BRAND",
          pillar: ownPillar,
          sourceProfileId: null,
          sourceProfileIds: [],
          sourceRefs: ownContext.brand.confirmedWebsiteContent.map((page) => ({
            type: "OWN_WEBSITE_PAGE",
            url: page.url,
            title: page.title,
          })),
          audience: ownContext.audience,
          factProvenance: [{
            source_type: "OWN_PROFILE",
            profile_id: profile.id,
            pillar: ownPillar,
            verified_at: new Date().toISOString(),
          }],
        };
      }
    }
    const enriched = enrichRequestedTopicWithPillars(topic, ownContext.visualIdentity);

    const meter = new TextGenerationMetering(env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({
      profileId,
      source: "MANUAL",
      operationIdentity,
      requestFingerprint: { topic, objective, providers, formats, researchMode, sourceProfileId: editorialContext.sourceProfileId, pillar: editorialContext.pillar },
    });
    if (reservation.status === "DENIED") return json({ error: reservation.code }, 429);
    if (reservation.status === "COMPLETED") return json(reservation.cached.response, 200);
    if (reservation.status === "IN_PROGRESS") return json({ error: "GENERATION_IN_PROGRESS" }, 409);
    if (reservation.status === "RELEASED") return json({ error: "METERING_FAILED" }, 409);
    const eventId = reservation.eventId;
    activeEventId = eventId;
    await meter.setProgress(eventId, 15, "ANALYZING");

    const requestUpperBoundUsd = estimateTextRequestUpperBoundUsd({ topic: enriched.topic, objective, providers, formats, brand: context, researchMode });
    const activityBudget = await new ActivityBudgetEngine(env.DATABASE_URL!).preflight({
      profileId,
      task: "COPY_FINAL",
      importance: "STANDARD",
      projectedOperationCostUsd: requestUpperBoundUsd,
    });
    if (!activityBudget.allowed) {
      await meter.release(eventId, activityBudget.reason ?? "AI_BUDGET_HARD_STOP");
      return json({ error: activityBudget.reason ?? "AI_BUDGET_HARD_STOP", budget: activityBudget }, 429);
    }

    await meter.markProviderStarted(eventId);
    const result = await generateSocialText({
      apiKey: env.OPENAI_API_KEY,
      topic: enriched.topic,
      objective,
      providers,
      formats,
      brand: context,
      researchMode,
      cacheKey: `post-automatici:${profileId}`,
      onProgress: async ({ percent, stage }) => { await meter.setProgress(eventId, percent, stage); },
    });
    await meter.setProgress(eventId, 95, "FINALIZING");
    await meter.persistTechnicalEvents(profileId, eventId, technicalEventsFromTextResult(result, {
      source: "MANUAL",
      requested_topic: topic,
      editorial_pillars_used: enriched.pillarCount,
      editorial_topic: result.content.editorialTopic,
      editorial_angle: result.content.editorialAngle,
      external_sources: result.externalSources,
      verification: result.verification,
      personal_brand_source_profile_id: editorialContext.sourceProfileId,
      personal_brand_pillar: editorialContext.pillar,
    }));

    const recent = await recentContentForDedupe(profileId, token);
    let bestDuplicate: ReturnType<typeof findNearDuplicate> = null;
    for (const variant of result.content.variants) {
      const duplicate = findNearDuplicate({ topic: result.content.editorialTopic, angle: result.content.editorialAngle, hook: variant.hook, caption: variant.caption }, recent);
      if (duplicate && (!bestDuplicate || duplicate.score > bestDuplicate.score)) bestDuplicate = duplicate;
    }


    if (bestDuplicate) {
      await meter.release(eventId, "DUPLICATE_CONTENT");
      return json({ error: "DUPLICATE_CONTENT", duplicate: { score: Number(bestDuplicate.score.toFixed(3)), matchedContentId: bestDuplicate.candidate.id ?? null } }, 409);
    }

    const responseBody = {
      content: result.content,
      model: result.model,
      responseId: result.responseId,
      research: { mode: result.researchMode, externalSources: result.externalSources, webSearchCalls: result.usage.webSearchCalls },
      usage: result.usage,
      budget: { currency: "EUR", band: activityBudget.band, hardCapEur: activityBudget.hardCapEur, spendEur: activityBudget.spendEur, remainingEur: activityBudget.remainingEur, forecastEndOfMonthEur: activityBudget.forecastEndOfMonthEur },
      editorialContext: { ...editorialContext, externalSources: result.externalSources },
    };
    await meter.storeResult(eventId, { response: responseBody });
    await meter.commit(eventId);
    logicalCommitted = true;
    return json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && reason instanceof OpenAITextPipelineError) await activeMeter.persistTechnicalEvents(profileId, activeEventId, reason.technicalEvents).catch(() => undefined);
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "GENERATION_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_GENERATION_ERROR";
    console.error("cloudflare-generate-text", { profileId, detail });
    if (detail === "PROVIDER_COST_BUDGET_REACHED") return json({ error: detail }, 429);
    if (detail === "PERSONAL_BRAND_SOURCE_NOT_AUTHORIZED") return json({ error: detail }, 403);
    if (detail === "PROFILE_NOT_FOUND") return json({ error: detail }, 404);
    const publicError = publicGenerationError(detail);
    const status = detail.startsWith("OPENAI_") || detail === "AI_BRAIN_INSUFFICIENT_SOURCES" ? 422 : detail.startsWith("METERING_FAILED") ? 503 : 500;
    return json({ error: publicError }, status);
  }
}
