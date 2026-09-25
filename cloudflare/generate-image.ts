import { ActivityBudgetEngine } from "../api/_lib/activity-budget.js";
import { findReusableAsset, rankReusableAssets, visualFingerprint, type ReusableAsset } from "../api/_lib/asset-intelligence.js";
import { generateGeminiImage } from "../api/_lib/gemini-image.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "../api/_lib/image-generation-metering.js";
import { routeAiTask } from "../api/_lib/model-router.js";
import type { ContentImportance } from "../api/_lib/ai-brain-policy.js";
import type { ImageSocialFormat, ImageSocialProvider } from "../api/_lib/openai-image.js";

const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<ImageSocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<ImageSocialFormat>(["POST", "CAROUSEL", "STORY"]);
const VALID_IMPORTANCE = new Set<ContentImportance>(["STANDARD", "IMPORTANT", "PREMIUM", "CRITICAL"]);

export type GeminiImageEnv = {
  DATABASE_URL?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
};

type ProfileRow = { id: string; name: string; industry: string | null };
type BrandRow = { tone_of_voice: unknown };
type VariantRow = { id: string; content_id: string; provider: ImageSocialProvider; format: ImageSocialFormat; image_asset_id: string | null };
type AssetRow = ReusableAsset & { name?: string };

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

function summary(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>).summary;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

async function linkAsset(token: string, profileId: string, variant: VariantRow, assetId: string) {
  const now = new Date().toISOString();
  const variantWrite = await dataApi(`content_variants?id=eq.${encodeURIComponent(variant.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ image_asset_id: assetId, approval_status: "PENDING", updated_at: now }),
  });
  if (!variantWrite.ok) throw new Error(`CONTENT_VARIANT_IMAGE_LINK_${variantWrite.status}`);
  const parentWrite = await dataApi(`content_items?id=eq.${encodeURIComponent(variant.content_id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ status: "IN_REVIEW", updated_at: now }),
  });
  if (!parentWrite.ok) console.error("content-parent-reopen", { contentId: variant.content_id, status: parentWrite.status });
}

export async function handleWorkerGenerateImage(request: Request, env: GeminiImageEnv) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = bearer(request);
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  const body = await readBody(request);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const provider = typeof body.provider === "string" && VALID_PROVIDERS.has(body.provider as ImageSocialProvider) ? body.provider as ImageSocialProvider : null;
  const format = typeof body.format === "string" && VALID_FORMATS.has(body.format as ImageSocialFormat) ? body.format as ImageSocialFormat : null;
  const contentVariantId = typeof body.contentVariantId === "string" ? body.contentVariantId : null;
  const visualBrief = typeof body.visualBrief === "string" ? body.visualBrief.trim().slice(0, 2_000) : "";
  const caption = typeof body.caption === "string" ? body.caption.trim().slice(0, 1_500) : null;
  const additionalDirection = typeof body.additionalDirection === "string" ? body.additionalDirection.trim().slice(0, 700) : null;
  const importance = typeof body.importance === "string" && VALID_IMPORTANCE.has(body.importance as ContentImportance)
    ? body.importance as ContentImportance
    : "STANDARD";
  const operationIdentity = (request.headers.get("x-post-automatici-operation-id") || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(operationIdentity)) return json({ error: "OPERATION_ID_REQUIRED" }, 400);
  if (!profileId || !provider || !format || !visualBrief) return json({ error: "IMAGE_INPUT_REQUIRED" }, 400);

  let activeMeter: ImageGenerationMetering | null = null;
  let activeEventId: string | null = null;
  let logicalCommitted = false;
  try {
    const profile = (await rows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,industry&limit=1`, token))[0];
    if (!profile) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const brand = (await rows<BrandRow>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=tone_of_voice&limit=1`, token))[0] ?? null;

    let savedVariant: VariantRow | null = null;
    if (contentVariantId) {
      savedVariant = (await rows<VariantRow>(`content_variants?id=eq.${encodeURIComponent(contentVariantId)}&profile_id=eq.${encodeURIComponent(profileId)}&select=id,content_id,provider,format,image_asset_id&limit=1`, token))[0] ?? null;
      if (!savedVariant) return json({ error: "CONTENT_VARIANT_NOT_FOUND" }, 404);
      if (savedVariant.provider !== provider || savedVariant.format !== format) return json({ error: "CONTENT_VARIANT_MISMATCH" }, 409);
    }

    const fingerprint = await visualFingerprint({ profileId, provider, format, visualBrief, additionalDirection });
    const candidateAssets = await rows<AssetRow>(
      `assets?profile_id=eq.${encodeURIComponent(profileId)}&kind=eq.IMAGE&select=id,profile_id,source,kind,name,storage_url,mime_type,metadata,created_at&order=created_at.desc&limit=80`,
      token,
    );
    const reusable = findReusableAsset(rankReusableAssets(candidateAssets), fingerprint);
    if (reusable) {
      if (savedVariant) await linkAsset(token, profileId, savedVariant, reusable.id);
      return json({
        image: { dataUrl: reusable.storage_url.startsWith("data:") ? reusable.storage_url : null, mimeType: reusable.mime_type, model: "ASSET_REUSE", size: null, quality: "reused", revisedPrompt: null },
        asset: { id: reusable.id },
        usage: { estimatedCostUsd: 0 },
        reused: true,
        route: { status: "REUSE_ASSET" },
      });
    }

    const budget = await new ActivityBudgetEngine(env.DATABASE_URL).snapshot(profileId);
    const task = importance === "PREMIUM" || importance === "CRITICAL" ? "IMAGE_PREMIUM" : "IMAGE_STANDARD";
    const route = routeAiTask({ task, importance, budget, env: { GEMINI_API_KEY: env.GEMINI_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY } });
    if (route.status === "BLOCKED_BUDGET") return json({ error: "AI_BUDGET_HARD_STOP", message: "Budget AI mensile dell'attività raggiunto.", budget }, 429);
    if (route.status !== "READY" || !route.model?.apiModelId || route.model.provider !== "GOOGLE") {
      return json({
        error: "BLOCKED_PROVIDER",
        message: "Il provider visual richiesto non è configurato o non è disponibile.",
        requestedModel: route.model?.requestedName ?? null,
        reason: route.reason,
      }, 503);
    }

    const meter = new ImageGenerationMetering(env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({
      profileId,
      source: "MANUAL",
      operationIdentity,
      referenceId: savedVariant?.id ?? null,
      requestFingerprint: { contentVariantId, provider, format, visualBrief, caption, additionalDirection, importance, model: route.model.apiModelId },
    });
    if (reservation.status === "DENIED") return json({ error: reservation.code }, 429);
    if (reservation.status === "COMPLETED") return json(reservation.cached.response);
    if (reservation.status === "IN_PROGRESS") return json({ error: "IMAGE_GENERATION_IN_PROGRESS" }, 409);
    if (reservation.status === "RELEASED") return json({ error: "METERING_FAILED" }, 409);
    const eventId = reservation.eventId;
    activeEventId = eventId;

    await meter.markProviderStarted(eventId);
    const tier = route.model.apiModelId === "gemini-3-pro-image" ? "PREMIUM" : "STANDARD";
    const result = await generateGeminiImage({
      apiKey: env.GEMINI_API_KEY!,
      tier,
      profileName: profile.name,
      industry: profile.industry,
      tone: summary(brand?.tone_of_voice),
      provider,
      format,
      visualBrief,
      caption,
      additionalDirection,
    });
    const dataUrl = `data:${result.mimeType};base64,${result.base64}`;
    await meter.persistTechnicalEvents(profileId, eventId, technicalEventsFromImageResult(result, {
      source: "MANUAL", provider, format, task, importance, visual_fingerprint: fingerprint, budget_band: budget.band,
    }));

    let asset: AssetRow | null = null;
    if (savedVariant) {
      const source = tier === "PREMIUM" ? "GEMINI_3_PRO_IMAGE" : "GEMINI_3_1_FLASH_IMAGE";
      const assetWrite = await dataApi("assets", token, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          profile_id: profileId,
          source,
          kind: "IMAGE",
          name: `${provider}-${format}-${savedVariant.id}.${result.mimeType.includes("jpeg") ? "jpg" : "png"}`,
          storage_url: dataUrl,
          mime_type: result.mimeType,
          tags: [provider, format, "AI_GENERATED", "MASTER_VISUAL"],
          metadata: {
            provider: "GOOGLE", model: result.model, tier: result.tier,
            aspect_ratio: result.aspectRatio, image_size: result.imageSize,
            request_id: result.requestId, visual_fingerprint: fingerprint,
            reuse_allowed: true, storage_mode: "DATABASE_DATA_URL_V1",
          },
        }),
      });
      if (!assetWrite.ok) throw new Error(`ASSET_WRITE_${assetWrite.status}`);
      asset = ((await assetWrite.json()) as AssetRow[])[0] ?? null;
      if (!asset) throw new Error("ASSET_WRITE_EMPTY");
      await linkAsset(token, profileId, savedVariant, asset.id);
    }

    const routeMeta = { status: route.status, model: route.model.apiModelId, reason: route.reason };
    const responseBody = {
      image: { dataUrl, mimeType: result.mimeType, model: result.model, size: result.imageSize, quality: result.tier, revisedPrompt: result.prompt },
      asset, usage: result.usage, budget, route: routeMeta, reused: false,
    };
    const cachedResponse = {
      image: { dataUrl: null, mimeType: result.mimeType, model: result.model, size: result.imageSize, quality: result.tier, revisedPrompt: result.prompt },
      asset, usage: result.usage, budget, route: routeMeta, reused: false, duplicate: true,
    };
    await meter.storeResult(eventId, { response: cachedResponse, assetId: asset?.id ?? null, variantId: savedVariant?.id ?? null });
    await meter.commit(eventId);
    logicalCommitted = true;
    return json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "IMAGE_GENERATION_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_IMAGE_ERROR";
    console.error("cloudflare-generate-image-routed", { profileId, detail });
    if (detail === "PROVIDER_COST_BUDGET_REACHED") return json({ error: "AI_BUDGET_HARD_STOP" }, 429);
    const status = detail.startsWith("GEMINI_") ? 502 : detail.startsWith("METERING_FAILED") ? 503 : 500;
    return json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "IMAGE_GENERATION_FAILED" }, status);
  }
}
