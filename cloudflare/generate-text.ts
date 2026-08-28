import { findNearDuplicate, type ContentDedupeCandidate } from "../api/_lib/content-dedupe.js";
import { estimateTextRequestUpperBoundUsd, generateSocialText, type BrandContext, type SocialFormat, type SocialProvider } from "../api/_lib/openai-text.js";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<SocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<SocialFormat>(["POST", "CAROUSEL", "STORY"]);
const DEFAULT_MONTHLY_TEXT_BUDGET_USD = 5;

type Env = {
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MONTHLY_BUDGET_USD?: string;
};
type ProfileRow = { id: string; name: string; website_url: string | null; industry: string | null };
type BrandRow = { description: string | null; business_model: string | null; location: string | null; service_area: string | null; target_audience: unknown; tone_of_voice: unknown; goals: unknown };
type ScanRow = { id: string };
type PageRow = { url: string; title: string | null; content_text: string | null };
type CostRow = { cost_usd: number | string | null };
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

function monthlyBudgetUsd(env: Env) {
  const configured = Number(env.OPENAI_TEXT_MONTHLY_BUDGET_USD ?? DEFAULT_MONTHLY_TEXT_BUDGET_USD);
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 0.1), 100) : DEFAULT_MONTHLY_TEXT_BUDGET_USD;
}

function currentMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

async function currentOwnerTextSpendUsd(token: string) {
  const costRows = await rows<CostRow>(`ai_usage_events?created_at=gte.${encodeURIComponent(currentMonthStartIso())}&operation=eq.GENERATE_SOCIAL_TEXT&select=cost_usd&limit=5000`, token);
  return costRows.reduce((total, row) => total + (Number(row.cost_usd) || 0), 0);
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

  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { /* validated below */ }
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 1_000) : "";
  const objective = typeof body.objective === "string" ? body.objective.trim().slice(0, 500) : null;
  const providers = Array.isArray(body.providers) ? body.providers.filter((value): value is SocialProvider => typeof value === "string" && VALID_PROVIDERS.has(value as SocialProvider)) : [];
  const formats = Array.isArray(body.formats) ? body.formats.filter((value): value is SocialFormat => typeof value === "string" && VALID_FORMATS.has(value as SocialFormat)) : [];
  if (!profileId || !topic) return json({ error: "PROFILE_AND_TOPIC_REQUIRED" }, 400);
  if (!providers.length || !formats.length) return json({ error: "PROVIDERS_AND_FORMATS_REQUIRED" }, 400);

  try {
    const profile = (await rows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,website_url,industry&limit=1`, token))[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const brand = (await rows<BrandRow>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=description,business_model,location,service_area,target_audience,tone_of_voice,goals&limit=1`, token))[0] ?? null;
    const scan = (await rows<ScanRow>(`website_scans?profile_id=eq.${encodeURIComponent(profileId)}&state=in.(COMPLETE,PARTIAL)&select=id&order=created_at.desc&limit=1`, token))[0];
    const pages = scan ? await rows<PageRow>(`website_pages?scan_id=eq.${encodeURIComponent(scan.id)}&profile_id=eq.${encodeURIComponent(profileId)}&status=eq.ANALYZED&select=url,title,content_text&order=depth.asc&limit=60`, token) : [];
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

    const budgetUsd = monthlyBudgetUsd(env);
    const spentBeforeUsd = await currentOwnerTextSpendUsd(token);
    const requestUpperBoundUsd = estimateTextRequestUpperBoundUsd({ topic, objective, providers, formats, brand: context });
    if (spentBeforeUsd >= budgetUsd || spentBeforeUsd + requestUpperBoundUsd > budgetUsd) return json({ error: "OPENAI_TEXT_BUDGET_REACHED", message: "Budget mensile testi raggiunto. Nessuna chiamata OpenAI è stata eseguita.", budget: { monthlyUsd: budgetUsd, spentUsd: Number(spentBeforeUsd.toFixed(6)), estimatedNextMaxUsd: Number(requestUpperBoundUsd.toFixed(6)) } }, 429);

    const result = await generateSocialText({ apiKey: env.OPENAI_API_KEY, topic, objective, providers, formats, brand: context, cacheKey: `post-automatici:${profileId}` });
    const actualCostUsd = result.usage.estimatedCostUsd;
    await dataApi("ai_usage_events", token, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ profile_id: profileId, operation: "GENERATE_SOCIAL_TEXT", model: result.model, input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, cost_usd: actualCostUsd, metadata: { openai_response_id: result.responseId, openai_request_id: result.requestId, cached_input_tokens: result.usage.cachedInputTokens, cache_write_tokens: result.usage.cacheWriteTokens, requested_topic: topic, editorial_topic: result.content.editorialTopic, editorial_angle: result.content.editorialAngle } }),
    });

    const recent = await recentContentForDedupe(profileId, token);
    let bestDuplicate: ReturnType<typeof findNearDuplicate> = null;
    for (const variant of result.content.variants) {
      const duplicate = findNearDuplicate({ topic: result.content.editorialTopic, angle: result.content.editorialAngle, hook: variant.hook, caption: variant.caption }, recent);
      if (duplicate && (!bestDuplicate || duplicate.score > bestDuplicate.score)) bestDuplicate = duplicate;
    }

    const spentAfterUsd = spentBeforeUsd + (actualCostUsd ?? 0);
    if (bestDuplicate) return json({ error: "DUPLICATE_CONTENT", message: "Il contenuto generato è troppo simile a un contenuto recente dello stesso profilo e non viene restituito come nuovo contenuto.", duplicate: { score: Number(bestDuplicate.score.toFixed(3)), matchedContentId: bestDuplicate.candidate.id ?? null }, budget: { monthlyUsd: budgetUsd, spentUsd: Number(spentAfterUsd.toFixed(6)), remainingUsd: Number(Math.max(budgetUsd - spentAfterUsd, 0).toFixed(6)) } }, 409);

    return json({ content: result.content, model: result.model, responseId: result.responseId, usage: result.usage, budget: { monthlyUsd: budgetUsd, spentUsd: Number(spentAfterUsd.toFixed(6)), remainingUsd: Number(Math.max(budgetUsd - spentAfterUsd, 0).toFixed(6)) } });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_GENERATION_ERROR";
    console.error("cloudflare-generate-text", { profileId, detail });
    return json({ error: "GENERATION_FAILED", detail }, detail.startsWith("OPENAI_") ? 502 : 500);
  }
}
