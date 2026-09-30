import { neon } from "@neondatabase/serverless";
import { crawlWebsite } from "../api/_lib/crawler.js";
import { estimateTextRequestUpperBoundUsd, generateSocialText, type BrandContext, type SocialFormat, type SocialProvider } from "../api/_lib/openai-text.js";
import type { ImageSocialFormat, ImageSocialProvider } from "../api/_lib/openai-image.js";
import { generateRoutedImage } from "../api/_lib/routed-image.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "../api/_lib/image-generation-metering.js";
import { TextGenerationMetering, technicalEventsFromTextResult } from "../api/_lib/text-generation-metering.js";
import { ActivityBudgetEngine } from "../api/_lib/activity-budget.js";
import { AiBudgetRecommendationEngine } from "../api/_lib/ai-budget-recommendation.js";
import { assetContentHashFromBase64, findReusableAsset, visualFingerprint, type ReusableAssetCandidate } from "../api/_lib/asset-intelligence.js";
import { boundedScanPageLimit, SAFE_SCAN_MAX_SITEMAPS, SAFE_SCAN_MAX_STYLESHEETS, SAFE_SCAN_MAX_SITEMAP_SEEDS, SAFE_SCAN_MAX_TOTAL_PAGES } from "../api/_lib/website-scan-policy.js";

const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<SocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<SocialFormat>(["POST", "CAROUSEL", "STORY"]);
const VALID_IMAGE_PROVIDERS = new Set<ImageSocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_IMAGE_FORMATS = new Set<ImageSocialFormat>(["POST", "CAROUSEL", "STORY"]);

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
}

type ProfileRow = { id: string; name: string; website_url: string | null; industry: string | null };
type BrandRow = { description: string | null; business_model: string | null; location: string | null; service_area: string | null; target_audience: unknown; tone_of_voice: unknown; goals: unknown };
type ScanRow = { id: string; state?: string; discovered_pages?: number; analyzed_pages?: number; skipped_pages?: number; failed_pages?: number; root_url?: string; error?: string | null };
type ScanPageStateRow = { url: string; normalized_url: string; status: "DISCOVERED" | "ANALYZED" | "SKIPPED" | "FAILED"; depth: number; discovered_from: string | null };
type PageRow = { url: string; title: string | null; content_text: string | null };
type VariantRow = { id: string; content_id: string; provider: ImageSocialProvider; format: ImageSocialFormat; image_asset_id: string | null };
type CarouselSlideImageRow = { id: string; content_id: string; variant_id: string; visual_brief: string; headline: string; body: string; alt_text: string; asset_id: string | null };
type AssetRow = ReusableAssetCandidate;
type ImageGenerationOperationRow = {
  operation_id: string;
  profile_id: string;
  content_variant_id: string | null;
  carousel_slide_id: string | null;
  state: "RUNNING" | "COMPLETED" | "FAILED";
  phase: string;
  progress: number;
  message: string;
  asset_id: string | null;
  error_code: string | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
};

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

async function writeImageProgress(token: string, input: {
  operationId: string;
  profileId: string;
  contentVariantId?: string | null;
  carouselSlideId?: string | null;
  state?: "RUNNING" | "COMPLETED" | "FAILED";
  phase: string;
  progress: number;
  message: string;
  assetId?: string | null;
  errorCode?: string | null;
}) {
  const now = new Date().toISOString();
  const response = await dataApi("image_generation_operations?on_conflict=operation_id", token, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      operation_id: input.operationId,
      profile_id: input.profileId,
      content_variant_id: input.contentVariantId ?? null,
      carousel_slide_id: input.carouselSlideId ?? null,
      state: input.state ?? "RUNNING",
      phase: input.phase,
      progress: Math.max(0, Math.min(100, Math.round(input.progress))),
      message: input.message.slice(0, 500),
      asset_id: input.assetId ?? null,
      error_code: input.errorCode ?? null,
      updated_at: now,
      completed_at: input.state === "COMPLETED" || input.state === "FAILED" ? now : null,
    }),
  });
  if (!response.ok) throw new Error(`IMAGE_PROGRESS_WRITE_${response.status}`);
}

async function handleImageGenerationStatus(request: Request) {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  const url = new URL(request.url);
  const operationId = (url.searchParams.get("operationId") || "").trim();
  const profileId = (url.searchParams.get("profileId") || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(operationId) || !profileId) return json({ error: "PROGRESS_INPUT_REQUIRED" }, 400);
  const result = await rows<ImageGenerationOperationRow>(
    `image_generation_operations?operation_id=eq.${encodeURIComponent(operationId)}&profile_id=eq.${encodeURIComponent(profileId)}&select=operation_id,profile_id,content_variant_id,carousel_slide_id,state,phase,progress,message,asset_id,error_code,started_at,updated_at,completed_at&limit=1`,
    token,
  );
  const operation = result[0];
  if (!operation) return json({ error: "PROGRESS_NOT_FOUND" }, 404);
  return json({
    operationId: operation.operation_id,
    state: operation.state,
    phase: operation.phase,
    progress: operation.progress,
    message: operation.message,
    assetId: operation.asset_id,
    errorCode: operation.error_code,
    startedAt: operation.started_at,
    updatedAt: operation.updated_at,
    completedAt: operation.completed_at,
  });
}

function summaryField(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const summary = (value as Record<string, unknown>).summary;
  return typeof summary === "string" && summary.trim() ? summary.trim() : null;
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

function createPublicTargetValidator() {
  const dnsChecks = new Map<string, Promise<void>>();
  return async (url: URL) => {
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("PRIVATE_TARGET");
    if (url.port && url.port !== "80" && url.port !== "443") throw new Error("UNSAFE_PORT");
    if (literalIp(hostname)) {
      if (privateIp(hostname)) throw new Error("PRIVATE_TARGET");
      return;
    }
    let check = dnsChecks.get(hostname);
    if (!check) {
      check = resolvePublicDns(hostname);
      dnsChecks.set(hostname, check);
    }
    await check;
  };
}

async function handleHealth(env: Env) {
  if (!env.DATABASE_URL) return json({ service: "post-automatici", ready: false, database: "not_configured", provider: "cloudflare" }, 503);
  try {
    const sql = neon(env.DATABASE_URL);
    await sql`select 1 as ok`;
    return json({ service: "post-automatici", ready: true, database: "reachable", provider: "cloudflare", aiProviders: { openai: env.OPENAI_API_KEY ? "configured" : "blocked_provider" } });
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

async function handleAiBudgetRecommendation(request: Request, env: Env) {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const profileId = new URL(request.url).searchParams.get("profileId") || "";
  if (!profileId) return json({ error: "PROFILE_REQUIRED" }, 400);
  try {
    const profiles = await rows<Pick<ProfileRow, "id">>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, token);
    if (!profiles[0]) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const recommendation = await new AiBudgetRecommendationEngine(env.DATABASE_URL).recommend(profileId);
    return json({ recommendation });
  } catch (reason) {
    console.error("ai-budget-recommendation", reason instanceof Error ? reason.message : "unknown");
    return json({ error: "AI_BUDGET_RECOMMENDATION_FAILED" }, 500);
  }
}

async function handleGenerateText(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_NOT_CONFIGURED", message: "Configura OPENAI_API_KEY nel deployment Cloudflare." }, 503);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 1_000) : "";
  const objective = typeof body.objective === "string" ? body.objective.trim().slice(0, 500) : null;
  const providers = Array.isArray(body.providers) ? body.providers.filter((value): value is SocialProvider => typeof value === "string" && VALID_PROVIDERS.has(value as SocialProvider)) : [];
  const formats = Array.isArray(body.formats) ? body.formats.filter((value): value is SocialFormat => typeof value === "string" && VALID_FORMATS.has(value as SocialFormat)) : [];
  const operationIdentity = (request.headers.get("x-post-automatici-operation-id") || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(operationIdentity)) return json({ error: "OPERATION_ID_REQUIRED" }, 400);
  if (!profileId || !topic) return json({ error: "PROFILE_AND_TOPIC_REQUIRED" }, 400);
  if (!providers.length || !formats.length) return json({ error: "PROVIDERS_AND_FORMATS_REQUIRED" }, 400);

  let activeMeter: TextGenerationMetering | null = null;
  let activeEventId: string | null = null;
  let logicalCommitted = false;
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
    const meter = new TextGenerationMetering(env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({
      profileId,
      source: "MANUAL",
      operationIdentity,
      requestFingerprint: { topic, objective, providers, formats },
    });
    if (reservation.status === "DENIED") return json({ error: reservation.code }, 429);
    if (reservation.status === "COMPLETED") return json(reservation.cached.response);
    if (reservation.status === "IN_PROGRESS") return json({ error: "GENERATION_IN_PROGRESS" }, 409);
    if (reservation.status === "RELEASED") return json({ error: "METERING_FAILED" }, 409);
    const eventId = reservation.eventId;
    activeEventId = eventId;

    const upperUsd = estimateTextRequestUpperBoundUsd({ topic, objective, providers, formats, brand: context });
    const activityBudget = await new ActivityBudgetEngine(env.DATABASE_URL).preflight({
      profileId,
      task: "COPY_FINAL",
      importance: "STANDARD",
      projectedOperationCostUsd: upperUsd,
    });
    if (!activityBudget.allowed) {
      await meter.release(eventId, activityBudget.reason ?? "AI_BUDGET_HARD_STOP");
      return json({ error: activityBudget.reason ?? "AI_BUDGET_HARD_STOP", budget: activityBudget }, 429);
    }

    await meter.markProviderStarted(eventId, upperUsd);
    const result = await generateSocialText({ apiKey: env.OPENAI_API_KEY, topic, objective, providers, formats, brand: context, cacheKey: `post-automatici:${profileId}` });
    await meter.persistTechnicalEvents(profileId, eventId, technicalEventsFromTextResult(result, { source: "MANUAL", topic }));
    const responseBody = {
      content: result.content,
      model: result.model,
      responseId: result.responseId,
      usage: result.usage,
      budget: {
        currency: "EUR",
        band: activityBudget.band,
        hardCapEur: activityBudget.hardCapEur,
        spendEur: activityBudget.spendEur,
        remainingEur: activityBudget.remainingEur,
        forecastEndOfMonthEur: activityBudget.forecastEndOfMonthEur,
      },
    };
    await meter.storeResult(eventId, { response: responseBody });
    await meter.commit(eventId);
    logicalCommitted = true;
    return json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "GENERATION_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_GENERATION_ERROR";
    console.error("cloudflare-generate-text", { profileId, detail });
    if (detail === "PROVIDER_COST_BUDGET_REACHED") return json({ error: detail }, 429);
    return json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "GENERATION_FAILED" }, detail.startsWith("OPENAI_") ? 502 : detail.startsWith("METERING_FAILED") ? 503 : 500);
  }
}

async function handleGenerateImage(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const provider = typeof body.provider === "string" && VALID_IMAGE_PROVIDERS.has(body.provider as ImageSocialProvider) ? body.provider as ImageSocialProvider : null;
  const format = typeof body.format === "string" && VALID_IMAGE_FORMATS.has(body.format as ImageSocialFormat) ? body.format as ImageSocialFormat : null;
  const contentVariantId = typeof body.contentVariantId === "string" ? body.contentVariantId : null;
  const carouselSlideId = typeof body.carouselSlideId === "string" ? body.carouselSlideId : null;
  let visualBrief = typeof body.visualBrief === "string" ? body.visualBrief.trim().slice(0, 2_000) : "";
  let caption = typeof body.caption === "string" ? body.caption.trim().slice(0, 1_500) : null;
  const additionalDirection = typeof body.additionalDirection === "string" ? body.additionalDirection.trim().slice(0, 700) : null;
  const operationIdentity = (request.headers.get("x-post-automatici-operation-id") || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(operationIdentity)) return json({ error: "OPERATION_ID_REQUIRED" }, 400);
  if (!profileId || !provider || !format || !visualBrief) return json({ error: "IMAGE_INPUT_REQUIRED" }, 400);

  let activeMeter: ImageGenerationMetering | null = null;
  let activeEventId: string | null = null;
  let logicalCommitted = false;
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
    let savedSlide: CarouselSlideImageRow | null = null;
    if (carouselSlideId) {
      if (!savedVariant || savedVariant.format !== "CAROUSEL") return json({ error: "CAROUSEL_VARIANT_REQUIRED" }, 409);
      const slideRows = await rows<CarouselSlideImageRow>(`content_carousel_slides?id=eq.${encodeURIComponent(carouselSlideId)}&profile_id=eq.${encodeURIComponent(profileId)}&variant_id=eq.${encodeURIComponent(savedVariant.id)}&select=id,content_id,variant_id,visual_brief,headline,body,alt_text,asset_id&limit=1`, token);
      savedSlide = slideRows[0] ?? null;
      if (!savedSlide) return json({ error: "CAROUSEL_SLIDE_NOT_FOUND" }, 404);
      visualBrief = savedSlide.visual_brief.trim().slice(0, 2_000);
      caption = [savedSlide.headline, savedSlide.body].filter(Boolean).join(" — ").slice(0, 1_500);
      if (!visualBrief) return json({ error: "CAROUSEL_SLIDE_VISUAL_BRIEF_REQUIRED" }, 409);
    }
    const aspectRatio = format === "STORY" ? "2:3" : "1:1";
    const candidates = await rows<ReusableAssetCandidate>(`assets?profile_id=eq.${encodeURIComponent(profileId)}&kind=eq.IMAGE&select=id,source,kind,name,storage_url,mime_type,tags,metadata,provider,model,cost_eur,width,height,format,quality_status,identity_status,reuse_count,created_at&order=created_at.desc&limit=100`, token);
    const reusable = await findReusableAsset({ visualBrief, aspectRatio, candidates });
    if (reusable) {
      const asset = reusable.asset;
      if (savedVariant) {
        const now = new Date().toISOString();
        const assetMetadata = asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata) ? asset.metadata as Record<string, unknown> : {};
        const assetWrite = await dataApi(`assets?id=eq.${encodeURIComponent(asset.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ metadata: { ...assetMetadata, reuse_reason: reusable.reason, last_reused_at: now }, reuse_count: Number(asset.reuse_count ?? 0) + 1, last_used_at: now, updated_at: now }) });
        if (!assetWrite.ok) throw new Error(`ASSET_REUSE_TRACE_${assetWrite.status}`);
        const link = savedSlide
          ? await dataApi(`content_carousel_slides?id=eq.${encodeURIComponent(savedSlide.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ asset_id: asset.id, qa_status: "PENDING", updated_at: now }) })
          : await dataApi(`content_variants?id=eq.${encodeURIComponent(savedVariant.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ image_asset_id: asset.id, approval_status: "PENDING", updated_at: now }) });
        if (!link.ok) throw new Error(savedSlide ? `CAROUSEL_SLIDE_IMAGE_LINK_${link.status}` : `CONTENT_VARIANT_IMAGE_LINK_${link.status}`);
        await dataApi(`content_items?id=eq.${encodeURIComponent(savedVariant.content_id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ status: "IN_REVIEW", updated_at: now }) });
      }
      return json({ image: { dataUrl: asset.storage_url, mimeType: asset.mime_type, model: null, size: null, quality: null, provider: "REUSED_ASSET", aspectRatio }, asset, reused: true, reuseReason: reusable.reason, usage: { estimatedCostUsd: 0 }, budget: { currency: "EUR", avoidedCostEur: 0.25 } });
    }
    const meter = new ImageGenerationMetering(env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({
      profileId,
      source: "MANUAL",
      operationIdentity,
      referenceId: savedSlide?.id ?? savedVariant?.id ?? null,
      requestFingerprint: { contentVariantId, carouselSlideId, provider, format, visualBrief, caption, additionalDirection },
    });
    if (reservation.status === "DENIED") return json({ error: reservation.code }, 429);
    if (reservation.status === "COMPLETED") return json(reservation.cached.response);
    if (reservation.status === "IN_PROGRESS") return json({ error: "IMAGE_GENERATION_IN_PROGRESS" }, 409);
    if (reservation.status === "RELEASED") return json({ error: "METERING_FAILED" }, 409);
    const eventId = reservation.eventId;
    activeEventId = eventId;
    const activityBudget = await new ActivityBudgetEngine(env.DATABASE_URL).preflight({
      profileId,
      task: "IMAGE_STANDARD",
      importance: "STANDARD",
      projectedOperationCostUsd: 0.25,
    });
    if (!activityBudget.allowed) {
      await meter.release(eventId, activityBudget.reason ?? "AI_BUDGET_HARD_STOP");
      return json({ error: activityBudget.reason ?? "AI_BUDGET_HARD_STOP", budget: activityBudget }, 429);
    }
    const routeImportance = body.importance === "PREMIUM" || body.importance === "CRITICAL" ? body.importance : "STANDARD";
    await meter.markProviderStarted(eventId, 0.25);
    const result = await generateRoutedImage({
      env: { OPENAI_API_KEY: env.OPENAI_API_KEY },
      budget: activityBudget,
      importance: routeImportance,
      profileName: profile.name,
      industry: profile.industry,
      tone: summaryField(brands[0]?.tone_of_voice),
      provider,
      format,
      visualBrief,
      caption,
      additionalDirection,
    });
    const dataUrl = `data:${result.mimeType};base64,${result.base64}`;
    await meter.persistTechnicalEvents(profileId, eventId, technicalEventsFromImageResult(result, { source: "MANUAL", provider, format }));
    let asset: AssetRow | null = null;
    if (savedVariant) {
      const directSql = neon(env.DATABASE_URL);
      const actualRows = await directSql`select coalesce(actual_usd,reserved_usd)*fx_usd_to_eur_rate as actual_eur from public.provider_cost_attempts where logical_usage_event_id=${eventId}::uuid limit 1` as unknown as Array<{actual_eur:number|string}>;
      const estimatedCostUsd = Number(result.usage.estimatedCostUsd ?? 0.25);
      const actualEur = Number(actualRows[0]?.actual_eur ?? estimatedCostUsd * activityBudget.usdToEurRate);
      const sizeMatch = /^(\\d+)x(\\d+)$/.exec(String(result.size ?? ""));
      const contentHash = await assetContentHashFromBase64(result.base64);
      const assetWrite = await dataApi("assets", token, { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify({
        profile_id: profileId,
        content_id: savedVariant.content_id,
        source: "AI_IMAGE",
        kind: "IMAGE",
        name: savedSlide ? `${provider}-CAROUSEL-${savedSlide.id}.png` : `${provider}-${format}-${savedVariant.id}.png`,
        storage_url: dataUrl,
        mime_type: result.mimeType,
        tags: [provider, format, "AI_GENERATED"],
        metadata: { provider: "OPENAI", model: result.model, quality: result.quality, size: result.size, aspect_ratio: result.aspectRatio, visual_brief: visualBrief, visual_fingerprint: await visualFingerprint({ visualBrief, aspectRatio: result.aspectRatio }), provider_request_id: result.requestId, storage_mode: "DATABASE_DATA_URL_V1" },
        provider: "OPENAI",
        model: result.model,
        cost_eur: actualEur,
        width: sizeMatch ? Number(sizeMatch[1]) : null,
        height: sizeMatch ? Number(sizeMatch[2]) : null,
        format: result.aspectRatio,
        quality_status: "PENDING",
        identity_status: "NOT_REQUIRED",
        content_hash: contentHash,
        updated_at: new Date().toISOString(),
      }) });
      if (!assetWrite.ok) throw new Error(`ASSET_WRITE_${assetWrite.status}`);
      asset = ((await assetWrite.json()) as AssetRow[])[0] ?? null;
      if (!asset) throw new Error("ASSET_WRITE_EMPTY");
      const now = new Date().toISOString();
      const link = savedSlide
        ? await dataApi(`content_carousel_slides?id=eq.${encodeURIComponent(savedSlide.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ asset_id: asset.id, qa_status: "PENDING", updated_at: now }) })
        : await dataApi(`content_variants?id=eq.${encodeURIComponent(savedVariant.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ image_asset_id: asset.id, approval_status: "PENDING", updated_at: now }) });
      if (!link.ok) {
        await deleteRow(`assets?id=eq.${encodeURIComponent(asset.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token);
        throw new Error(savedSlide ? `CAROUSEL_SLIDE_IMAGE_LINK_${link.status}` : `CONTENT_VARIANT_IMAGE_LINK_${link.status}`);
      }
      await dataApi(`content_items?id=eq.${encodeURIComponent(savedVariant.content_id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ status: "IN_REVIEW", updated_at: now }) });
      if (!savedSlide && savedVariant.image_asset_id && savedVariant.image_asset_id !== asset.id) await deleteRow(`assets?id=eq.${encodeURIComponent(savedVariant.image_asset_id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token);
    }
    const responseBody = { image: { dataUrl, mimeType: result.mimeType, model: result.model, size: result.size, quality: result.quality, provider: result.provider, aspectRatio: result.aspectRatio }, asset, usage: result.usage, budget: { currency: "EUR", band: activityBudget.band, hardCapEur: activityBudget.hardCapEur, spendEur: activityBudget.spendEur, remainingEur: activityBudget.remainingEur, forecastEndOfMonthEur: activityBudget.forecastEndOfMonthEur } };
    const cachedResponse = { image: { dataUrl: null, mimeType: result.mimeType, model: result.model, size: result.size, quality: result.quality, provider: result.provider, aspectRatio: result.aspectRatio }, asset, usage: result.usage, budget: responseBody.budget, duplicate: true };
    await meter.storeResult(eventId, { response: cachedResponse, assetId: asset?.id ?? null, variantId: savedVariant?.id ?? null });
    await meter.commit(eventId);
    logicalCommitted = true;
    return json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "IMAGE_GENERATION_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_IMAGE_ERROR";
    console.error("cloudflare-generate-image", { profileId, detail });
    if (detail === "PROVIDER_COST_BUDGET_REACHED") return json({ error: detail }, 429);
    if (detail.startsWith("MODEL_ROUTER_BLOCKED_PROVIDER") || detail.startsWith("OPENAI_")) return json({ error: "BLOCKED_PROVIDER" }, 503);
    const status = detail.startsWith("METERING_FAILED") ? 503 : 500;
    return json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "IMAGE_GENERATION_FAILED" }, status);
  }
}

async function handleWebsiteScan(request: Request) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const pageLimit = boundedScanPageLimit(body.pageLimit);
  const forceNew = body.forceNew === true;
  if (!profileId) return json({ error: "PROFILE_REQUIRED" }, 400);

  let scanId: string | null = null;
  try {
    const validateTarget = createPublicTargetValidator();
    const profileRows = await rows<Pick<ProfileRow, "id" | "website_url">>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,website_url&limit=1`, token);
    const profile = profileRows[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    if (!profile.website_url) return json({ error: "WEBSITE_NOT_CONFIGURED" }, 409);
    const root = new URL(profile.website_url);
    if (root.protocol !== "http:" && root.protocol !== "https:") return json({ error: "INVALID_WEBSITE" }, 400);
    await validateTarget(root);
    const rootUrl = root.toString();

    let existingScan: ScanRow | null = null;
    if (!forceNew) {
      existingScan = (await rows<ScanRow>(
        `website_scans?profile_id=eq.${encodeURIComponent(profileId)}&root_url=eq.${encodeURIComponent(rootUrl)}&state=in.(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL,RUNNING,FAILED)&select=id,state,root_url,discovered_pages,analyzed_pages,skipped_pages,failed_pages,error&order=created_at.desc&limit=1`,
        token,
      ))[0] ?? null;
      if (existingScan?.state === "COMPLETE" || existingScan?.state === "COMPLETE_WITH_WARNINGS") {
        return json({
          scanId: existingScan.id,
          state: existingScan.state,
          discoveredPages: existingScan.discovered_pages ?? 0,
          analyzedPages: existingScan.analyzed_pages ?? 0,
          skippedPages: existingScan.skipped_pages ?? 0,
          failedPages: existingScan.failed_pages ?? 0,
          completeCoverage: existingScan.state === "COMPLETE",
          hasMore: false,
          reused: true,
        });
      }
    }

    if (existingScan) scanId = existingScan.id;
    else {
      const create = await dataApi("website_scans", token, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          profile_id: profileId,
          root_url: rootUrl,
          state: "RUNNING",
          page_limit: pageLimit,
          max_depth: 12,
          started_at: new Date().toISOString(),
          last_progress_at: new Date().toISOString(),
        }),
      });
      if (!create.ok) throw new Error(`DATA_API_CREATE_SCAN_${create.status}`);
      scanId = ((await create.json()) as ScanRow[])[0]?.id ?? null;
      if (!scanId) throw new Error("SCAN_ID_MISSING");
    }

    const storedPages = await rows<ScanPageStateRow>(
      `website_pages?scan_id=eq.${encodeURIComponent(scanId)}&profile_id=eq.${encodeURIComponent(profileId)}&select=url,normalized_url,status,depth,discovered_from&order=created_at.asc&limit=${SAFE_SCAN_MAX_TOTAL_PAGES}`,
      token,
    );
    const terminal = storedPages.filter((page) => page.status !== "DISCOVERED");
    const pending = storedPages.filter((page) => page.status === "DISCOVERED");
    const excludeUrls = terminal.map((page) => page.normalized_url);
    const rootNormalized = new URL(rootUrl).toString();
    if (!pending.length && terminal.length > 0) {
      const rootIndex = excludeUrls.indexOf(rootNormalized);
      if (rootIndex >= 0) excludeUrls.splice(rootIndex, 1);
    }

    const result = await crawlWebsite(rootUrl, {
      maxPages: pageLimit,
      maxDepth: 12,
      maxDurationMs: 48_000,
      validateTarget,
      includeSitemap: pending.length === 0,
      maxSitemapFiles: SAFE_SCAN_MAX_SITEMAPS,
      maxStylesheets: SAFE_SCAN_MAX_STYLESHEETS,
      maxSitemapSeeds: SAFE_SCAN_MAX_SITEMAP_SEEDS,
      maxDiscoveredPages: SAFE_SCAN_MAX_TOTAL_PAGES,
      excludeUrls,
      seedUrls: pending.map((page) => ({ url: page.normalized_url, depth: page.depth, discoveredFrom: page.discovered_from })),
    });

    for (let index = 0; index < result.pages.length; index += 25) {
      const chunk = result.pages.slice(index, index + 25).map((page) => ({
        scan_id: scanId,
        profile_id: profileId,
        url: page.url,
        normalized_url: page.normalizedUrl,
        status: page.status,
        depth: page.depth,
        title: page.title,
        meta_description: page.metaDescription,
        content_text: page.contentText,
        content_hash: page.contentHash,
        discovered_from: page.discoveredFrom,
        skip_reason: page.skipReason,
        error: page.error,
        scanned_at: page.status === "DISCOVERED" ? null : new Date().toISOString(),
      }));
      const write = await dataApi(
        `website_pages?on_conflict=scan_id,normalized_url`,
        token,
        { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(chunk) },
      );
      if (!write.ok) throw new Error(`DATA_API_WRITE_PAGES_${write.status}`);
    }

    const totals = new Map<string, ScanPageStateRow>();
    for (const page of storedPages) totals.set(page.normalized_url, page);
    for (const page of result.pages) {
      totals.set(page.normalizedUrl, {
        url: page.url,
        normalized_url: page.normalizedUrl,
        status: page.status,
        depth: page.depth,
        discovered_from: page.discoveredFrom,
      });
    }
    const all = [...totals.values()];
    const discoveredPages = all.length;
    const analyzedPages = all.filter((page) => page.status === "ANALYZED").length;
    const skippedPages = all.filter((page) => page.status === "SKIPPED").length;
    const failedPages = all.filter((page) => page.status === "FAILED").length;
    const pendingPages = all.filter((page) => page.status === "DISCOVERED").length;
    const hasMore = pendingPages > 0;
    const state = hasMore ? "PARTIAL" : failedPages > 0 ? "COMPLETE_WITH_WARNINGS" : "COMPLETE";
    const now = new Date().toISOString();
    const finish = await dataApi(`website_scans?id=eq.${encodeURIComponent(scanId)}`, token, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        state,
        discovered_pages: discoveredPages,
        analyzed_pages: analyzedPages,
        skipped_pages: skippedPages,
        failed_pages: failedPages,
        finished_at: hasMore ? null : now,
        last_progress_at: now,
        error: hasMore ? "BATCH_PENDING" : failedPages > 0 ? "PAGE_ERRORS" : null,
      }),
    });
    if (!finish.ok) throw new Error(`DATA_API_FINISH_SCAN_${finish.status}`);

    return json({
      scanId,
      state,
      discoveredPages,
      analyzedPages,
      skippedPages,
      failedPages,
      pendingPages,
      completeCoverage: !hasMore,
      hasMore,
      stopReason: hasMore ? result.stopReason : "COMPLETE",
      visualHints: result.visualHints,
    });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_SCAN_ERROR";
    if (scanId) {
      await dataApi(`website_scans?id=eq.${encodeURIComponent(scanId)}`, token, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          state: "PARTIAL",
          finished_at: null,
          last_progress_at: new Date().toISOString(),
          error: "BATCH_RETRY_REQUIRED",
        }),
      }).catch(() => undefined);
    }
    console.error("cloudflare-website-scan", { profileId, scanId, detail });
    return json({ error: "SCAN_FAILED", message: "Non riesco a completare l'analisi del sito in questo momento. Riprova tra poco." }, 500);
  }
}

async function routeApi(request: Request, env: Env) {
  const path = new URL(request.url).pathname;
  if (path === "/api/health") return handleHealth(env);
  if (path === "/api/auth/account-exists") return handleAuthAccountExists(request, env);
  if (path === "/api/ai-budget-recommendation") return handleAiBudgetRecommendation(request, env);
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
