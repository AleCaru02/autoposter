import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { findNearDuplicate, type ContentDedupeCandidate } from "./_lib/content-dedupe.js";
import { enrichRequestedTopicWithPillars } from "./_lib/editorial-intelligence.js";
import { normalizeEditorialResearchMode } from "./_lib/editorial-research.js";
import { estimateTextRequestUpperBoundUsd, generateSocialText, OpenAITextPipelineError, type BrandContext, type SocialFormat, type SocialProvider } from "./_lib/openai-text.js";
import { ActivityBudgetEngine } from "./_lib/activity-budget.js";
import { TextGenerationMetering, technicalEventsFromTextResult } from "./_lib/text-generation-metering.js";
import { verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";
import { buildPersonalBrandEditorialContext, loadEditorialProfile, loadProfileBrandContext, resolvePersonalBrandSource } from "./_lib/personal-brand-sources.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<SocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<SocialFormat>(["POST", "CAROUSEL", "STORY"]);


type RecentItemRow = { id: string; topic: string; title: string | null };
type RecentVariantRow = { content_id: string; hook: string | null; caption: string | null };

function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

async function dataApi(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${DATA_API}/${path}`, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });
}

async function readJsonRows<T>(path: string, token: string): Promise<T[]> {
  const response = await dataApi(path, token);
  if (!response.ok) throw new Error(`DATA_API_${response.status}`);
  return response.json() as Promise<T[]>;
}


async function recentContentForDedupe(profileId: string, token: string): Promise<ContentDedupeCandidate[]> {
  const items = await readJsonRows<RecentItemRow>(`content_items?profile_id=eq.${encodeURIComponent(profileId)}&select=id,topic,title&order=created_at.desc&limit=40`, token);
  if (!items.length) return [];
  const variants = await readJsonRows<RecentVariantRow>(`content_variants?profile_id=eq.${encodeURIComponent(profileId)}&select=content_id,hook,caption&order=updated_at.desc&limit=160`, token);
  const firstVariant = new Map<string, RecentVariantRow>();
  for (const variant of variants) if (!firstVariant.has(variant.content_id)) firstVariant.set(variant.content_id, variant);
  return items.map((item) => {
    const variant = firstVariant.get(item.id);
    return { id: item.id, topic: item.topic ?? "", angle: item.title, hook: variant?.hook ?? null, caption: variant?.caption ?? null };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_NOT_CONFIGURED", message: "Configura OPENAI_API_KEY nel deployment server-side." });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });

  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim().slice(0, 1_000) : "";
  const objective = typeof req.body?.objective === "string" ? req.body.objective.trim().slice(0, 500) : null;
  const researchMode = normalizeEditorialResearchMode(req.body?.researchMode);
  const requestedSourceProfileId = typeof req.body?.sourceProfileId === "string" ? req.body.sourceProfileId.trim() || null : null;
  const requestedPillar = typeof req.body?.pillar === "string" ? req.body.pillar.trim().slice(0, 160) || null : null;
  const operationIdentityHeader = req.headers["x-post-automatici-operation-id"];
  const operationIdentity = (Array.isArray(operationIdentityHeader) ? operationIdentityHeader[0] : operationIdentityHeader || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(operationIdentity)) return res.status(400).json({ error: "OPERATION_ID_REQUIRED" });
  const providers = Array.isArray(req.body?.providers) ? req.body.providers.filter((value: unknown): value is SocialProvider => typeof value === "string" && VALID_PROVIDERS.has(value as SocialProvider)) : [];
  const formats = Array.isArray(req.body?.formats) ? req.body.formats.filter((value: unknown): value is SocialFormat => typeof value === "string" && VALID_FORMATS.has(value as SocialFormat)) : [];
  if (!profileId || !topic) return res.status(400).json({ error: "PROFILE_AND_TOPIC_REQUIRED" });
  if (!providers.length || !formats.length) return res.status(400).json({ error: "PROVIDERS_AND_FORMATS_REQUIRED" });

  let activeMeter: TextGenerationMetering | null = null;
  let activeEventId: string | null = null;
  let logicalCommitted = false;
  try {
    const authUserId = await verifiedCustomerAuthUserId(token, process.env.DATABASE_URL);
    if (!authUserId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    const sql = neon(process.env.DATABASE_URL);
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
      if (!objective) return res.status(400).json({ error: "PERSONAL_BRAND_OBJECTIVE_REQUIRED" });
      const relation = await resolvePersonalBrandSource(sql, profileId, requestedSourceProfileId, requestedPillar);
      const resolved = await buildPersonalBrandEditorialContext(sql, profile, relation);
      if (!Object.keys(resolved.audience).length) return res.status(400).json({ error: "PERSONAL_BRAND_AUDIENCE_REQUIRED" });
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
    }
    const enriched = enrichRequestedTopicWithPillars(topic, ownContext.visualIdentity);

    const meter = new TextGenerationMetering(process.env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({
      profileId,
      source: "MANUAL",
      operationIdentity,
      requestFingerprint: { topic, objective, providers, formats, researchMode, sourceProfileId: editorialContext.sourceProfileId, pillar: editorialContext.pillar },
    });
    if (reservation.status === "DENIED") return res.status(429).json({ error: reservation.code });
    if (reservation.status === "COMPLETED") return res.status(200).json(reservation.cached.response);
    if (reservation.status === "IN_PROGRESS") return res.status(409).json({ error: "GENERATION_IN_PROGRESS" });
    if (reservation.status === "RELEASED") return res.status(409).json({ error: "METERING_FAILED" });
    const eventId = reservation.eventId;
    activeEventId = eventId;

    const requestUpperBoundUsd = estimateTextRequestUpperBoundUsd({ topic: enriched.topic, objective, providers, formats, brand: context, researchMode });
    const activityBudget = await new ActivityBudgetEngine(process.env.DATABASE_URL).preflight({
      profileId,
      task: "COPY_FINAL",
      importance: "STANDARD",
      projectedOperationCostUsd: requestUpperBoundUsd,
    });
    if (!activityBudget.allowed) {
      await meter.release(eventId, activityBudget.reason ?? "AI_BUDGET_HARD_STOP");
      return res.status(429).json({ error: activityBudget.reason ?? "AI_BUDGET_HARD_STOP", budget: activityBudget });
    }

    await meter.markProviderStarted(eventId, requestUpperBoundUsd);
    const result = await generateSocialText({ apiKey: process.env.OPENAI_API_KEY, topic: enriched.topic, objective, providers, formats, brand: context, researchMode, cacheKey: `post-automatici:${profileId}` });
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
      return res.status(409).json({
        error: "DUPLICATE_CONTENT",
        message: "Il contenuto generato è troppo simile a un contenuto recente dello stesso profilo e non viene restituito come nuovo contenuto.",
        duplicate: { score: Number(bestDuplicate.score.toFixed(3)), matchedContentId: bestDuplicate.candidate.id ?? null },
      });
    }

    const responseBody = {
      content: result.content,
      model: result.model,
      responseId: result.responseId,
      research: { mode: result.researchMode, externalSources: result.externalSources, webSearchCalls: result.usage.webSearchCalls },
      usage: result.usage,
      budget: { currency: "EUR", band: activityBudget.band, hardCapEur: activityBudget.hardCapEur, spendEur: activityBudget.spendEur, remainingEur: activityBudget.remainingEur, forecastEndOfMonthEur: activityBudget.forecastEndOfMonthEur },
      editorialContext: {
        ...editorialContext,
        externalSources: result.externalSources,
      },
    };
    await meter.storeResult(eventId, { response: responseBody });
    await meter.commit(eventId);
    logicalCommitted = true;
    return res.status(200).json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && reason instanceof OpenAITextPipelineError) await activeMeter.persistTechnicalEvents(profileId, activeEventId, reason.technicalEvents).catch(() => undefined);
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "GENERATION_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_GENERATION_ERROR";
    console.error("generate-text", { profileId, detail });
    if (detail === "PROVIDER_COST_BUDGET_REACHED") return res.status(429).json({ error: detail });
    if (detail === "PERSONAL_BRAND_SOURCE_NOT_AUTHORIZED") return res.status(403).json({ error: detail });
    if (detail === "PROFILE_NOT_FOUND") return res.status(404).json({ error: detail });
    const status = detail.startsWith("OPENAI_") ? 502 : detail.startsWith("METERING_FAILED") ? 503 : 500;
    return res.status(status).json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "GENERATION_FAILED" });
  }
}
