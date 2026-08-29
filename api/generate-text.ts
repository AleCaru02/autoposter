import type { VercelRequest, VercelResponse } from "@vercel/node";
import { findNearDuplicate, type ContentDedupeCandidate } from "./_lib/content-dedupe.js";
import { enrichRequestedTopicWithPillars } from "./_lib/editorial-intelligence.js";
import { normalizeEditorialResearchMode } from "./_lib/editorial-research.js";
import { estimateTextRequestUpperBoundUsd, generateSocialText, type BrandContext, type SocialFormat, type SocialProvider } from "./_lib/openai-text.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<SocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<SocialFormat>(["POST", "CAROUSEL", "STORY"]);
const DEFAULT_MONTHLY_TEXT_BUDGET_USD = 5;

type ProfileRow = { id: string; name: string; website_url: string | null; industry: string | null };
type BrandRow = { description: string | null; business_model: string | null; location: string | null; service_area: string | null; target_audience: unknown; tone_of_voice: unknown; goals: unknown; visual_identity: unknown };
type ScanRow = { id: string };
type PageRow = { url: string; title: string | null; content_text: string | null };
type CostRow = { cost_usd: number | string | null };
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

function summaryField(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const summary = (value as Record<string, unknown>).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

function monthlyBudgetUsd() {
  const configured = Number(process.env.OPENAI_TEXT_MONTHLY_BUDGET_USD ?? DEFAULT_MONTHLY_TEXT_BUDGET_USD);
  if (!Number.isFinite(configured)) return DEFAULT_MONTHLY_TEXT_BUDGET_USD;
  return Math.min(Math.max(configured, 0.1), 100);
}

function currentMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function currentOwnerTextSpendUsd(token: string) {
  const rows = await readJsonRows<CostRow>(`ai_usage_events?created_at=gte.${encodeURIComponent(currentMonthStartIso())}&operation=eq.GENERATE_SOCIAL_TEXT&select=cost_usd&limit=5000`, token);
  return rows.reduce((total, row) => total + (Number(row.cost_usd) || 0), 0);
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

  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const topic = typeof req.body?.topic === "string" ? req.body.topic.trim().slice(0, 1_000) : "";
  const objective = typeof req.body?.objective === "string" ? req.body.objective.trim().slice(0, 500) : null;
  const researchMode = normalizeEditorialResearchMode(req.body?.researchMode);
  const providers = Array.isArray(req.body?.providers) ? req.body.providers.filter((value: unknown): value is SocialProvider => typeof value === "string" && VALID_PROVIDERS.has(value as SocialProvider)) : [];
  const formats = Array.isArray(req.body?.formats) ? req.body.formats.filter((value: unknown): value is SocialFormat => typeof value === "string" && VALID_FORMATS.has(value as SocialFormat)) : [];
  if (!profileId || !topic) return res.status(400).json({ error: "PROFILE_AND_TOPIC_REQUIRED" });
  if (!providers.length || !formats.length) return res.status(400).json({ error: "PROVIDERS_AND_FORMATS_REQUIRED" });

  try {
    const profiles = await readJsonRows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,website_url,industry&limit=1`, token);
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    const brands = await readJsonRows<BrandRow>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=description,business_model,location,service_area,target_audience,tone_of_voice,goals,visual_identity&limit=1`, token);
    const brand = brands[0] ?? null;
    const scans = await readJsonRows<ScanRow>(`website_scans?profile_id=eq.${encodeURIComponent(profileId)}&state=in.(COMPLETE,PARTIAL)&select=id&order=created_at.desc&limit=1`, token);
    const pages = scans[0] ? await readJsonRows<PageRow>(`website_pages?scan_id=eq.${encodeURIComponent(scans[0].id)}&profile_id=eq.${encodeURIComponent(profileId)}&status=eq.ANALYZED&select=url,title,content_text&order=depth.asc&limit=60`, token) : [];

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
      confirmedWebsiteContent: pages.filter((page) => Boolean(page.content_text)).map((page) => ({ url: page.url, title: page.title, text: page.content_text ?? "" })),
    };
    const enriched = enrichRequestedTopicWithPillars(topic, brand?.visual_identity);

    const budgetUsd = monthlyBudgetUsd();
    const spentBeforeUsd = await currentOwnerTextSpendUsd(token);
    const requestUpperBoundUsd = estimateTextRequestUpperBoundUsd({ topic: enriched.topic, objective, providers, formats, brand: context, researchMode });
    if (spentBeforeUsd >= budgetUsd || spentBeforeUsd + requestUpperBoundUsd > budgetUsd) {
      return res.status(429).json({
        error: "OPENAI_TEXT_BUDGET_REACHED",
        message: "Budget mensile testi raggiunto. Nessuna chiamata OpenAI è stata eseguita.",
        budget: { monthlyUsd: budgetUsd, spentUsd: Number(spentBeforeUsd.toFixed(6)), estimatedNextMaxUsd: Number(requestUpperBoundUsd.toFixed(6)) },
      });
    }

    const result = await generateSocialText({ apiKey: process.env.OPENAI_API_KEY, topic: enriched.topic, objective, providers, formats, brand: context, researchMode, cacheKey: `post-automatici:${profileId}` });
    const actualCostUsd = result.usage.estimatedCostUsd;
    const usageWrite = await dataApi("ai_usage_events", token, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        profile_id: profileId,
        operation: "GENERATE_SOCIAL_TEXT",
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cost_usd: actualCostUsd,
        metadata: {
          openai_response_id: result.responseId,
          openai_request_id: result.requestId,
          cached_input_tokens: result.usage.cachedInputTokens,
          cache_write_tokens: result.usage.cacheWriteTokens,
          web_search_calls: result.usage.webSearchCalls,
          research_mode: result.researchMode,
          external_sources: result.externalSources,
          requested_topic: topic,
          editorial_pillars_used: enriched.pillarCount,
          editorial_topic: result.content.editorialTopic,
          editorial_angle: result.content.editorialAngle,
        },
      }),
    });
    if (!usageWrite.ok) console.error("ai-usage-write", { profileId, status: usageWrite.status });

    const recent = await recentContentForDedupe(profileId, token);
    let bestDuplicate: ReturnType<typeof findNearDuplicate> = null;
    for (const variant of result.content.variants) {
      const duplicate = findNearDuplicate({ topic: result.content.editorialTopic, angle: result.content.editorialAngle, hook: variant.hook, caption: variant.caption }, recent);
      if (duplicate && (!bestDuplicate || duplicate.score > bestDuplicate.score)) bestDuplicate = duplicate;
    }

    const spentAfterUsd = spentBeforeUsd + (actualCostUsd ?? 0);
    if (bestDuplicate) {
      return res.status(409).json({
        error: "DUPLICATE_CONTENT",
        message: "Il contenuto generato è troppo simile a un contenuto recente dello stesso profilo e non viene restituito come nuovo contenuto.",
        duplicate: { score: Number(bestDuplicate.score.toFixed(3)), matchedContentId: bestDuplicate.candidate.id ?? null },
        research: { mode: result.researchMode, externalSources: result.externalSources, webSearchCalls: result.usage.webSearchCalls },
        budget: { monthlyUsd: budgetUsd, spentUsd: Number(spentAfterUsd.toFixed(6)), remainingUsd: Number(Math.max(budgetUsd - spentAfterUsd, 0).toFixed(6)) },
      });
    }

    return res.status(200).json({
      content: result.content,
      model: result.model,
      responseId: result.responseId,
      research: { mode: result.researchMode, externalSources: result.externalSources, webSearchCalls: result.usage.webSearchCalls },
      usage: result.usage,
      budget: { monthlyUsd: budgetUsd, spentUsd: Number(spentAfterUsd.toFixed(6)), remainingUsd: Number(Math.max(budgetUsd - spentAfterUsd, 0).toFixed(6)) },
    });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_GENERATION_ERROR";
    console.error("generate-text", { profileId, detail });
    const status = detail.startsWith("OPENAI_") ? 502 : 500;
    return res.status(status).json({ error: "GENERATION_FAILED", detail });
  }
}
