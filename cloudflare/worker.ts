import { neon } from "@neondatabase/serverless";
import { crawlWebsite } from "../api/_lib/crawler.js";
import { analyzeBrandFromWebsite, type WebsiteVisualHints } from "../api/_lib/brand-analysis.js";
import { estimateTextRequestUpperBoundUsd, generateSocialText, type BrandContext, type SocialFormat, type SocialProvider } from "../api/_lib/openai-text.js";
import { generateOpenAIImage, type ImageSocialFormat, type ImageSocialProvider } from "../api/_lib/openai-image.js";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<SocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<SocialFormat>(["POST", "CAROUSEL", "STORY"]);
const VALID_IMAGE_PROVIDERS = new Set<ImageSocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_IMAGE_FORMATS = new Set<ImageSocialFormat>(["POST", "CAROUSEL", "STORY"]);
const DEFAULT_MONTHLY_TEXT_BUDGET_USD = 5;
const DEFAULT_MONTHLY_IMAGE_LIMIT = 20;

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MONTHLY_BUDGET_USD?: string;
  OPENAI_IMAGE_MONTHLY_LIMIT?: string;
}

type ProfileRow = { id: string; name: string; website_url: string | null; industry: string | null };
type BrandRow = { description: string | null; business_model: string | null; location: string | null; service_area: string | null; target_audience: unknown; tone_of_voice: unknown; goals: unknown };
type ExistingBrandRow = { profile_id: string; social_links: unknown };
type ScanRow = { id: string };
type PageRow = { url: string; title: string | null; content_text: string | null };
type CostRow = { cost_usd: number | string | null };
type UsageRow = { id: string };
type VariantRow = { id: string; content_id: string; provider: ImageSocialProvider; format: ImageSocialFormat; image_asset_id: string | null };
type AssetRow = { id: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function bearer(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

async function readBody(request: Request) {
  try { return await request.json() as Record<string, unknown>; }
  catch { return {}; }
}

async function dataApi(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${DATA_API}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function rows<T>(path: string, token: string): Promise<T[]> {
  const response = await dataApi(path, token);
  if (!response.ok) throw new Error(`DATA_API_${response.status}`);
  return response.json() as Promise<T[]>;
}

async function deleteRow(path: string, token: string) {
  const response = await dataApi(path, token, { method: "DELETE" });
  if (!response.ok) console.error("data-api-delete", { path, status: response.status });
}

function summaryField(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const summary = (value as Record<string, unknown>).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
}

function sanitizeVisualHints(value: unknown): WebsiteVisualHints {
  if (!value || typeof value !== "object") return { colors: [], socialLinks: {}, logoUrl: null };
  const input = value as Record<string, unknown>;
  const colors = Array.isArray(input.colors) ? input.colors.filter((item): item is string => typeof item === "string").slice(0, 10) : [];
  const socialLinks = input.socialLinks && typeof input.socialLinks === "object" ? Object.fromEntries(Object.entries(input.socialLinks as Record<string, unknown>).filter(([, item]) => typeof item === "string").map(([key, item]) => [key, String(item)])) : {};
  const logoUrl = typeof input.logoUrl === "string" ? input.logoUrl : null;
  return { colors, socialLinks, logoUrl };
}

function currentMonthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function monthlyTextBudgetUsd(env: Env) {
  const configured = Number(env.OPENAI_TEXT_MONTHLY_BUDGET_USD ?? DEFAULT_MONTHLY_TEXT_BUDGET_USD);
  if (!Number.isFinite(configured)) return DEFAULT_MONTHLY_TEXT_BUDGET_USD;
  return Math.min(Math.max(configured, 0.1), 100);
}

function monthlyImageLimit(env: Env) {
  const parsed = Number(env.OPENAI_IMAGE_MONTHLY_LIMIT ?? DEFAULT_MONTHLY_IMAGE_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_MONTHLY_IMAGE_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), 200);
}

async function ownerTextSpendUsd(token: string) {
  const spendRows = await rows<CostRow>(`ai_usage_events?created_at=gte.${encodeURIComponent(currentMonthStartIso())}&operation=eq.GENERATE_SOCIAL_TEXT&select=cost_usd&limit=5000`, token);
  return spendRows.reduce((total, row) => total + (Number(row.cost_usd) || 0), 0);
}

function privateIp(address: string) {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ipv4)) return false;
  const [a, b] = ipv4.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function literalIp(hostname: string) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":");
}

async function resolvePublicDns(hostname: string) {
  const query = async (type: "A" | "AAAA") => {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, { headers: { accept: "application/dns-json" } });
    if (!response.ok) throw new Error("DNS_LOOKUP_FAILED");
    const payload = await response.json() as { Answer?: Array<{ data?: string }> };
    return (payload.Answer ?? []).map((entry) => entry.data).filter((value): value is string => typeof value === "string");
  };
  const addresses = [...await query("A"), ...await query("AAAA")];
  if (!addresses.length || addresses.some(privateIp)) throw new Error("PRIVATE_TARGET");
}

async function assertPublicTarget(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("PRIVATE_TARGET");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("UNSAFE_PORT");
  if (literalIp(hostname)) {
    if (privateIp(hostname)) throw new Error("PRIVATE_TARGET");
    return;
  }
  await resolvePublicDns(hostname);
}

async function handleHealth(env: Env) {
  if (!env.DATABASE_URL) return json({ service: "post-automatici", ready: false, database: "not_configured", provider: "cloudflare" }, 503);
  try {
    const sql = neon(env.DATABASE_URL);
    await sql`select 1 as ok`;
    return json({ service: "post-automatici", ready: true, database: "reachable", provider: "cloudflare" });
  } catch (reason) {
    console.error("health-db", reason instanceof Error ? reason.message : "unknown");
    return json({ service: "post-automatici", ready: false, database: "unreachable", provider: "cloudflare" }, 503);
  }
}

async function handleAuthAccountExists(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const body = await readBody(request);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "VALID_EMAIL_REQUIRED" }, 400);

  try {
    const sql = neon(env.DATABASE_URL);
    const result = await sql`select id from neon_auth."user" where lower(email) = ${email} limit 1`;
    return json({ exists: result.length > 0 });
  } catch (reason) {
    console.error("auth-account-exists", reason instanceof Error ? reason.message : "unknown");
    return json({ error: "ACCOUNT_CHECK_FAILED" }, 503);
  }
}

async function handleOnboardingAnalyze(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_NOT_CONFIGURED" }, 503);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  if (!profileId) return json({ error: "PROFILE_REQUIRED" }, 400);
  const visualHints = sanitizeVisualHints(body.visualHints);

  try {
    const profiles = await rows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,website_url,industry&limit=1`, token);
    const profile = profiles[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const scans = await rows<ScanRow>(`website_scans?profile_id=eq.${encodeURIComponent(profileId)}&state=in.(COMPLETE,PARTIAL)&select=id&order=created_at.desc&limit=1`, token);
    if (!scans[0]) return json({ error: "WEBSITE_SCAN_REQUIRED" }, 409);
    const pageRows = await rows<PageRow>(`website_pages?scan_id=eq.${encodeURIComponent(scans[0].id)}&profile_id=eq.${encodeURIComponent(profileId)}&status=eq.ANALYZED&select=url,title,content_text&order=depth.asc&limit=100`, token);
    const pages = pageRows.filter((page) => Boolean(page.content_text)).map((page) => ({ url: page.url, title: page.title, text: page.content_text ?? "" }));
    if (!pages.length) return json({ error: "NO_ANALYZED_WEBSITE_PAGES" }, 409);

    const result = await analyzeBrandFromWebsite({ apiKey: env.OPENAI_API_KEY, profileName: profile.name, websiteUrl: profile.website_url, industry: profile.industry, pages, visualHints });
    const existingRows = await rows<ExistingBrandRow>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=profile_id,social_links&limit=1`, token);
    const existingSocials = existingRows[0]?.social_links && typeof existingRows[0].social_links === "object" ? existingRows[0].social_links as Record<string, unknown> : {};
    const socialLinks = { ...visualHints.socialLinks, ...Object.fromEntries(Object.entries(existingSocials).filter(([, value]) => typeof value === "string" && value)) };
    const now = new Date().toISOString();
    const payload = {
      profile_id: profileId,
      description: result.analysis.description,
      business_model: result.analysis.businessModel,
      location: result.analysis.location,
      service_area: result.analysis.serviceArea,
      target_audience: result.analysis.targetAudience,
      services: result.analysis.services,
      differentiators: result.analysis.differentiators,
      value_propositions: result.analysis.valuePropositions,
      visual_identity: { observedColors: visualHints.colors, logoUrl: visualHints.logoUrl, summary: result.analysis.visualStyleSummary, source: "website_scan" },
      tone_of_voice: result.analysis.toneOfVoice,
      social_links: socialLinks,
      goals: result.analysis.goals,
      updated_at: now,
    };

    const write = existingRows[0]
      ? await dataApi(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(payload) })
      : await dataApi("brand_profiles", token, { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(payload) });
    if (!write.ok) throw new Error(`BRAND_PROFILE_WRITE_${write.status}`);

    const profilePatch: Record<string, unknown> = { onboarding_completed: true, updated_at: now };
    if (!profile.industry && result.analysis.industry) profilePatch.industry = result.analysis.industry;
    const profileWrite = await dataApi(`profiles?id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(profilePatch) });
    if (!profileWrite.ok) throw new Error(`PROFILE_ONBOARDING_WRITE_${profileWrite.status}`);

    const usageWrite = await dataApi("ai_usage_events", token, { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ profile_id: profileId, operation: "ANALYZE_BRAND_ONBOARDING", model: result.model, input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, cost_usd: result.usage.estimatedCostUsd, metadata: { openai_response_id: result.responseId, openai_request_id: result.requestId, pages_analyzed: pages.length } }) });
    if (!usageWrite.ok) console.error("onboarding-usage-write", { profileId, status: usageWrite.status });
    return json({ analysis: result.analysis, visualHints, pagesAnalyzed: pages.length, model: result.model });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_ONBOARDING_ANALYSIS_ERROR";
    console.error("cloudflare-onboarding-analyze", { profileId, detail });
    return json({ error: "ONBOARDING_ANALYSIS_FAILED", detail }, detail.startsWith("OPENAI_") ? 502 : 500);
  }
}

async function handleGenerateText(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_NOT_CONFIGURED", message: "Configura OPENAI_API_KEY nel deployment Cloudflare." }, 503);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 1_000) : "";
  const objective = typeof body.objective === "string" ? body.objective.trim().slice(0, 500) : null;
  const providers = Array.isArray(body.providers) ? body.providers.filter((value): value is SocialProvider => typeof value === "string" && VALID_PROVIDERS.has(value as SocialProvider)) : [];
  const formats = Array.isArray(body.formats) ? body.formats.filter((value): value is SocialFormat => typeof value === "string" && VALID_FORMATS.has(value as SocialFormat)) : [];
  if (!profileId || !topic) return json({ error: "PROFILE_AND_TOPIC_REQUIRED" }, 400);
  if (!providers.length || !formats.length) return json({ error: "PROVIDERS_AND_FORMATS_REQUIRED" }, 400);

  try {
    const profiles = await rows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,website_url,industry&limit=1`, token);
    const profile = profiles[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const brands = await rows<BrandRow>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=description,business_model,location,service_area,target_audience,tone_of_voice,goals&limit=1`, token);
    const brand = brands[0] ?? null;
    const scans = await rows<ScanRow>(`website_scans?profile_id=eq.${encodeURIComponent(profileId)}&state=in.(COMPLETE,PARTIAL)&select=id&order=created_at.desc&limit=1`, token);
    const pages = scans[0] ? await rows<PageRow>(`website_pages?scan_id=eq.${encodeURIComponent(scans[0].id)}&profile_id=eq.${encodeURIComponent(profileId)}&status=eq.ANALYZED&select=url,title,content_text&order=depth.asc&limit=60`, token) : [];
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
    const budgetUsd = monthlyTextBudgetUsd(env);
    const spentBeforeUsd = await ownerTextSpendUsd(token);
    const upperUsd = estimateTextRequestUpperBoundUsd({ topic, objective, providers, formats, brand: context });
    if (spentBeforeUsd >= budgetUsd || spentBeforeUsd + upperUsd > budgetUsd) return json({ error: "OPENAI_TEXT_BUDGET_REACHED", message: "Budget mensile testi raggiunto. Nessuna chiamata OpenAI è stata eseguita.", budget: { monthlyUsd: budgetUsd, spentUsd: Number(spentBeforeUsd.toFixed(6)), estimatedNextMaxUsd: Number(upperUsd.toFixed(6)) } }, 429);
    const result = await generateSocialText({ apiKey: env.OPENAI_API_KEY, topic, objective, providers, formats, brand: context, cacheKey: `post-automatici:${profileId}` });
    await dataApi("ai_usage_events", token, { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ profile_id: profileId, operation: "GENERATE_SOCIAL_TEXT", model: result.model, input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, cost_usd: result.usage.estimatedCostUsd, metadata: { openai_response_id: result.responseId, openai_request_id: result.requestId, cached_input_tokens: result.usage.cachedInputTokens, cache_write_tokens: result.usage.cacheWriteTokens, topic } }) });
    const spentAfterUsd = spentBeforeUsd + (result.usage.estimatedCostUsd ?? 0);
    return json({ content: result.content, model: result.model, responseId: result.responseId, usage: result.usage, budget: { monthlyUsd: budgetUsd, spentUsd: Number(spentAfterUsd.toFixed(6)), remainingUsd: Number(Math.max(budgetUsd - spentAfterUsd, 0).toFixed(6)) } });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_GENERATION_ERROR";
    console.error("cloudflare-generate-text", { profileId, detail });
    return json({ error: "GENERATION_FAILED", detail }, detail.startsWith("OPENAI_") ? 502 : 500);
  }
}

async function handleGenerateImage(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_NOT_CONFIGURED" }, 503);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const provider = typeof body.provider === "string" && VALID_IMAGE_PROVIDERS.has(body.provider as ImageSocialProvider) ? body.provider as ImageSocialProvider : null;
  const format = typeof body.format === "string" && VALID_IMAGE_FORMATS.has(body.format as ImageSocialFormat) ? body.format as ImageSocialFormat : null;
  const contentVariantId = typeof body.contentVariantId === "string" ? body.contentVariantId : null;
  const visualBrief = typeof body.visualBrief === "string" ? body.visualBrief.trim().slice(0, 2_000) : "";
  const caption = typeof body.caption === "string" ? body.caption.trim().slice(0, 1_500) : null;
  const additionalDirection = typeof body.additionalDirection === "string" ? body.additionalDirection.trim().slice(0, 700) : null;
  if (!profileId || !provider || !format || !visualBrief) return json({ error: "IMAGE_INPUT_REQUIRED" }, 400);

  try {
    const profiles = await rows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,industry&limit=1`, token);
    const profile = profiles[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const brands = await rows<Pick<BrandRow, "tone_of_voice">>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=tone_of_voice&limit=1`, token);
    let savedVariant: VariantRow | null = null;
    if (contentVariantId) {
      const variantRows = await rows<VariantRow>(`content_variants?id=eq.${encodeURIComponent(contentVariantId)}&profile_id=eq.${encodeURIComponent(profileId)}&select=id,content_id,provider,format,image_asset_id&limit=1`, token);
      savedVariant = variantRows[0] ?? null;
      if (!savedVariant) return json({ error: "CONTENT_VARIANT_NOT_FOUND" }, 404);
      if (savedVariant.provider !== provider || savedVariant.format !== format) return json({ error: "CONTENT_VARIANT_MISMATCH" }, 409);
    }
    const limit = monthlyImageLimit(env);
    const used = await rows<UsageRow>(`ai_usage_events?created_at=gte.${encodeURIComponent(currentMonthStartIso())}&operation=eq.GENERATE_SOCIAL_IMAGE&select=id&limit=${limit + 1}`, token);
    if (used.length >= limit) return json({ error: "OPENAI_IMAGE_MONTHLY_LIMIT_REACHED", message: "Limite mensile immagini raggiunto. Nessuna chiamata OpenAI è stata eseguita.", quota: { used: used.length, limit, remaining: 0 } }, 429);
    const result = await generateOpenAIImage({ apiKey: env.OPENAI_API_KEY, profileName: profile.name, industry: profile.industry, tone: summaryField(brands[0]?.tone_of_voice), provider, format, visualBrief, caption, additionalDirection });
    const dataUrl = `data:${result.mimeType};base64,${result.base64}`;
    await dataApi("ai_usage_events", token, { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ profile_id: profileId, operation: "GENERATE_SOCIAL_IMAGE", model: result.model, input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, cost_usd: result.usage.estimatedCostUsd, metadata: { openai_request_id: result.requestId, quality: result.quality, size: result.size, provider, format, cost_status: result.usage.estimatedCostUsd == null ? "usage_not_returned" : "estimated_from_openai_usage" } }) });
    let asset: AssetRow | null = null;
    if (savedVariant) {
      const assetWrite = await dataApi("assets", token, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ profile_id: profileId, source: "OPENAI_GPT_IMAGE_2", kind: "IMAGE", name: `${provider}-${format}-${savedVariant.id}.png`, storage_url: dataUrl, mime_type: result.mimeType, tags: [provider, format, "AI_GENERATED"], metadata: { model: result.model, quality: result.quality, size: result.size, openai_request_id: result.requestId, storage_mode: "DATABASE_DATA_URL_V1" } }) });
      if (!assetWrite.ok) throw new Error(`ASSET_WRITE_${assetWrite.status}`);
      asset = ((await assetWrite.json()) as AssetRow[])[0] ?? null;
      if (!asset) throw new Error("ASSET_WRITE_EMPTY");
      const now = new Date().toISOString();
      const link = await dataApi(`content_variants?id=eq.${encodeURIComponent(savedVariant.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ image_asset_id: asset.id, approval_status: "PENDING", updated_at: now }) });
      if (!link.ok) {
        await deleteRow(`assets?id=eq.${encodeURIComponent(asset.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token);
        throw new Error(`CONTENT_VARIANT_IMAGE_LINK_${link.status}`);
      }
      await dataApi(`content_items?id=eq.${encodeURIComponent(savedVariant.content_id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ status: "IN_REVIEW", updated_at: now }) });
      if (savedVariant.image_asset_id && savedVariant.image_asset_id !== asset.id) await deleteRow(`assets?id=eq.${encodeURIComponent(savedVariant.image_asset_id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token);
    }
    return json({ image: { dataUrl, mimeType: result.mimeType, model: result.model, size: result.size, quality: result.quality, revisedPrompt: result.revisedPrompt }, asset, usage: result.usage, quota: { used: used.length + 1, limit, remaining: Math.max(limit - used.length - 1, 0) } });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_IMAGE_ERROR";
    console.error("cloudflare-generate-image", { profileId, detail });
    return json({ error: "IMAGE_GENERATION_FAILED", detail }, detail.startsWith("OPENAI_IMAGE_") ? 502 : 500);
  }
}

async function handleWebsiteScan(request: Request) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const requestedLimit = Number(body.pageLimit ?? 500);
  const pageLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 2_000) : 500;
  if (!profileId) return json({ error: "PROFILE_REQUIRED" }, 400);
  let scanId: string | null = null;
  try {
    const profileRows = await rows<Pick<ProfileRow, "id" | "website_url">>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,website_url&limit=1`, token);
    const profile = profileRows[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    if (!profile.website_url) return json({ error: "WEBSITE_NOT_CONFIGURED" }, 409);
    const root = new URL(profile.website_url);
    if (root.protocol !== "http:" && root.protocol !== "https:") return json({ error: "INVALID_WEBSITE" }, 400);
    await assertPublicTarget(root);
    const create = await dataApi("website_scans", token, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({ profile_id: profileId, root_url: root.toString(), state: "RUNNING", page_limit: pageLimit, max_depth: 12, started_at: new Date().toISOString(), last_progress_at: new Date().toISOString() }) });
    if (!create.ok) throw new Error(`DATA_API_CREATE_SCAN_${create.status}`);
    scanId = ((await create.json()) as ScanRow[])[0]?.id ?? null;
    if (!scanId) throw new Error("SCAN_ID_MISSING");
    const result = await crawlWebsite(root.toString(), { maxPages: pageLimit, maxDepth: 12, maxDurationMs: 48_000, validateTarget: assertPublicTarget, includeSitemap: true });
    for (let index = 0; index < result.pages.length; index += 25) {
      const chunk = result.pages.slice(index, index + 25).map((page) => ({ scan_id: scanId, profile_id: profileId, url: page.url, normalized_url: page.normalizedUrl, status: page.status, depth: page.depth, title: page.title, meta_description: page.metaDescription, content_text: page.contentText, content_hash: page.contentHash, discovered_from: page.discoveredFrom, skip_reason: page.skipReason, error: page.error, scanned_at: new Date().toISOString() }));
      const write = await dataApi("website_pages", token, { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(chunk) });
      if (!write.ok) throw new Error(`DATA_API_WRITE_PAGES_${write.status}`);
    }
    const state = result.completeCoverage && result.failedPages === 0 ? "COMPLETE" : "PARTIAL";
    const finish = await dataApi(`website_scans?id=eq.${encodeURIComponent(scanId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ state, discovered_pages: result.discoveredPages, analyzed_pages: result.analyzedPages, skipped_pages: result.skippedPages, failed_pages: result.failedPages, finished_at: new Date().toISOString(), last_progress_at: new Date().toISOString(), error: result.stopReason === "COMPLETE" ? null : result.stopReason }) });
    if (!finish.ok) throw new Error(`DATA_API_FINISH_SCAN_${finish.status}`);
    return json({ scanId, state, discoveredPages: result.discoveredPages, analyzedPages: result.analyzedPages, skippedPages: result.skippedPages, failedPages: result.failedPages, completeCoverage: result.completeCoverage, stopReason: result.stopReason, visualHints: result.visualHints });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_SCAN_ERROR";
    if (scanId) await dataApi(`website_scans?id=eq.${encodeURIComponent(scanId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ state: "FAILED", finished_at: new Date().toISOString(), error: detail.slice(0, 500) }) }).catch(() => undefined);
    console.error("cloudflare-website-scan", { profileId, scanId, detail });
    return json({ error: "SCAN_FAILED", detail }, 500);
  }
}

async function routeApi(request: Request, env: Env) {
  const path = new URL(request.url).pathname;
  if (path === "/api/health") return handleHealth(env);
  if (path === "/api/auth/account-exists") return handleAuthAccountExists(request, env);
  if (path === "/api/onboarding-analyze") return handleOnboardingAnalyze(request, env);
  if (path === "/api/generate-text") return handleGenerateText(request, env);
  if (path === "/api/generate-image") return handleGenerateImage(request, env);
  if (path === "/api/website-scan") return handleWebsiteScan(request);
  return json({ error: "API_NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return routeApi(request, env);
    return env.ASSETS.fetch(request);
  },
};