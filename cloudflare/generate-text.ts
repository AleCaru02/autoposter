import { findNearDuplicate, type ContentDedupeCandidate } from "../api/_lib/content-dedupe.js";
import { enrichRequestedTopicWithPillars } from "../api/_lib/editorial-intelligence.js";
import { normalizeEditorialResearchMode } from "../api/_lib/editorial-research.js";
import { estimateTextRequestUpperBoundUsd, generateSocialText, OpenAITextPipelineError, type BrandContext, type SocialFormat, type SocialProvider } from "../api/_lib/openai-text.js";
import { ActivityBudgetEngine } from "../api/_lib/activity-budget.js";
import { routeAiTask } from "../api/_lib/model-router.js";
import { TextGenerationMetering, technicalEventsFromTextResult } from "../api/_lib/text-generation-metering.js";

const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<SocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<SocialFormat>(["POST", "CAROUSEL", "STORY"]);

type Env = {
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
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
    const profile = (await rows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,website_url,industry&limit=1`, token))[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const brand = (await rows<BrandRow>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=description,business_model,location,service_area,target_audience,tone_of_voice,goals,visual_identity,user_context&limit=1`, token))[0] ?? null;
    const scan = (await rows<ScanRow>(`website_scans?profile_id=eq.${encodeURIComponent(profileId)}&state=in.(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL)&select=id&order=created_at.desc&limit=1`, token))[0];
    const pages = scan ? await rows<PageRow>(`website_pages?scan_id=eq.${encodeURIComponent(scan.id)}&profile_id=eq.${encodeURIComponent(profileId)}&status=eq.ANALYZED&select=url,title,content_text&order=depth.asc&limit=160`, token) : [];
    const context: BrandContext = {
      profileName: profile.name,
      industry: profile.industry,
      websiteUrl: profile.website_url,
      description: brand?.description ?? null,
      businessModel: brand?.business_model ?? null,
      location: brand?.location ?? null,
      serviceArea: brand?.service_area ?? null,
      target: summaryField(brand?.target_audience),
      tone: summaryField(brand?.tone_of_voice),
      goals: Array.isArray(brand?.goals) ? brand.goals.filter((value): value is string => typeof value === "string") : [],
      userContext: brand?.user_context ?? null,
      confirmedWebsiteContent: pages.filter((page) => Boolean(page.content_text)).map((page) => ({ url: page.url, title: page.title, text: page.content_text ?? "" })),
    };
    const enriched = enrichRequestedTopicWithPillars(topic, brand?.visual_identity);

    const meter = new TextGenerationMetering(env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({
      profileId,
      source: "MANUAL",
      operationIdentity,
      requestFingerprint: { topic, objective, providers, formats, researchMode },
    });
    if (reservation.status === "DENIED") return json({ error: reservation.code }, 429);
    if (reservation.status === "COMPLETED") return json(reservation.cached.response, 200);
    if (reservation.status === "IN_PROGRESS") return json({ error: "GENERATION_IN_PROGRESS" }, 409);
    if (reservation.status === "RELEASED") return json({ error: "METERING_FAILED" }, 409);
    const eventId = reservation.eventId;
    activeEventId = eventId;

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
    const modelRoute = routeAiTask({
      task: "COPY_DRAFT",
      importance: "STANDARD",
      budget: activityBudget,
      env: { OPENAI_API_KEY: env.OPENAI_API_KEY, GEMINI_API_KEY: env.GEMINI_API_KEY },
    });
    if (modelRoute.status !== "READY" || !modelRoute.model?.apiModelId) {
      await meter.release(eventId, "BLOCKED_PROVIDER");
      return json({ error: "BLOCKED_PROVIDER", provider: modelRoute.model?.provider ?? null, reason: modelRoute.reason }, 503);
    }

    await meter.markProviderStarted(eventId);
    const result = await generateSocialText({ apiKey: env.OPENAI_API_KEY, geminiApiKey: env.GEMINI_API_KEY, model: modelRoute.model.apiModelId, topic: enriched.topic, objective, providers, formats, brand: context, researchMode, cacheKey: `post-automatici:${profileId}` });
    await meter.persistTechnicalEvents(profileId, eventId, technicalEventsFromTextResult(result, {
      source: "MANUAL",
      requested_topic: topic,
      editorial_pillars_used: enriched.pillarCount,
      editorial_topic: result.content.editorialTopic,
      editorial_angle: result.content.editorialAngle,
      external_sources: result.externalSources,
      verification: result.verification,
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

    const responseBody = { content: result.content, model: result.model, responseId: result.responseId, usage: result.usage, budget: { currency: "EUR", band: activityBudget.band, hardCapEur: activityBudget.hardCapEur, spendEur: activityBudget.spendEur, remainingEur: activityBudget.remainingEur, forecastEndOfMonthEur: activityBudget.forecastEndOfMonthEur } };
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
    return json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "GENERATION_FAILED" }, detail.startsWith("OPENAI_") ? 502 : detail.startsWith("METERING_FAILED") ? 503 : 500);
  }
}
