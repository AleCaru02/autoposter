import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ActivityBudgetEngine } from "./_lib/activity-budget.js";
import { findReusableAsset, rankReusableAssets, visualFingerprint, type ReusableAsset } from "./_lib/asset-intelligence.js";
import { generateGeminiImage } from "./_lib/gemini-image.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "./_lib/image-generation-metering.js";
import { routeAiTask } from "./_lib/model-router.js";
import type { ContentImportance } from "./_lib/ai-brain-policy.js";
import type { ImageSocialFormat, ImageSocialProvider } from "./_lib/openai-image.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<ImageSocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<ImageSocialFormat>(["POST", "CAROUSEL", "STORY"]);
const VALID_IMPORTANCE = new Set<ContentImportance>(["STANDARD", "IMPORTANT", "PREMIUM", "CRITICAL"]);

type ProfileRow = { id: string; name: string; industry: string | null };
type BrandRow = { tone_of_voice: unknown };
type VariantRow = {
  id: string;
  content_id: string;
  provider: ImageSocialProvider;
  format: ImageSocialFormat;
  image_asset_id: string | null;
};
type AssetRow = ReusableAsset & { name?: string };

function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
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

async function readRows<T>(path: string, token: string): Promise<T[]> {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });

  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const requestedProvider = typeof req.body?.provider === "string" && VALID_PROVIDERS.has(req.body.provider as ImageSocialProvider) ? req.body.provider as ImageSocialProvider : null;
  const requestedFormat = typeof req.body?.format === "string" && VALID_FORMATS.has(req.body.format as ImageSocialFormat) ? req.body.format as ImageSocialFormat : null;
  const contentVariantId = typeof req.body?.contentVariantId === "string" ? req.body.contentVariantId : null;
  const visualBrief = typeof req.body?.visualBrief === "string" ? req.body.visualBrief.trim().slice(0, 2_000) : "";
  const caption = typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 1_500) : null;
  const additionalDirection = typeof req.body?.additionalDirection === "string" ? req.body.additionalDirection.trim().slice(0, 700) : null;
  const importance = typeof req.body?.importance === "string" && VALID_IMPORTANCE.has(req.body.importance as ContentImportance)
    ? req.body.importance as ContentImportance
    : "STANDARD";
  const operationIdentityHeader = req.headers["x-post-automatici-operation-id"];
  const operationIdentity = (Array.isArray(operationIdentityHeader) ? operationIdentityHeader[0] : operationIdentityHeader || "").trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(operationIdentity)) return res.status(400).json({ error: "OPERATION_ID_REQUIRED" });
  if (!profileId || !requestedProvider || !requestedFormat || !visualBrief) return res.status(400).json({ error: "IMAGE_INPUT_REQUIRED" });

  let activeMeter: ImageGenerationMetering | null = null;
  let activeEventId: string | null = null;
  let logicalCommitted = false;
  try {
    const profiles = await readRows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,industry&limit=1`, token);
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    const brands = await readRows<BrandRow>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=tone_of_voice&limit=1`, token);

    let savedVariant: VariantRow | null = null;
    if (contentVariantId) {
      const rows = await readRows<VariantRow>(`content_variants?id=eq.${encodeURIComponent(contentVariantId)}&profile_id=eq.${encodeURIComponent(profileId)}&select=id,content_id,provider,format,image_asset_id&limit=1`, token);
      savedVariant = rows[0] ?? null;
      if (!savedVariant) return res.status(404).json({ error: "CONTENT_VARIANT_NOT_FOUND" });
      if (savedVariant.provider !== requestedProvider || savedVariant.format !== requestedFormat) return res.status(409).json({ error: "CONTENT_VARIANT_MISMATCH" });
    }

    const fingerprint = await visualFingerprint({
      profileId,
      provider: requestedProvider,
      format: requestedFormat,
      visualBrief,
      additionalDirection,
    });
    const candidateAssets = await readRows<AssetRow>(
      `assets?profile_id=eq.${encodeURIComponent(profileId)}&kind=eq.IMAGE&select=id,profile_id,source,kind,name,storage_url,mime_type,metadata,created_at&order=created_at.desc&limit=80`,
      token,
    );
    const reusable = findReusableAsset(rankReusableAssets(candidateAssets), fingerprint);
    if (reusable) {
      if (savedVariant) await linkAsset(token, profileId, savedVariant, reusable.id);
      return res.status(200).json({
        image: { dataUrl: reusable.storage_url.startsWith("data:") ? reusable.storage_url : null, mimeType: reusable.mime_type, model: "ASSET_REUSE", size: null, quality: "reused", revisedPrompt: null },
        asset: { id: reusable.id },
        usage: { estimatedCostUsd: 0 },
        reused: true,
        route: { status: "REUSE_ASSET" },
      });
    }

    const budget = await new ActivityBudgetEngine(process.env.DATABASE_URL).snapshot(profileId);
    const requestedTask = importance === "PREMIUM" || importance === "CRITICAL" ? "IMAGE_PREMIUM" : "IMAGE_STANDARD";
    const route = routeAiTask({
      task: requestedTask,
      importance,
      budget,
      env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY },
    });
    if (route.status === "BLOCKED_BUDGET") {
      return res.status(429).json({ error: "AI_BUDGET_HARD_STOP", message: "Budget AI mensile dell'attività raggiunto.", budget });
    }
    if (route.status !== "READY" || !route.model?.apiModelId || route.model.provider !== "GOOGLE") {
      return res.status(503).json({
        error: "BLOCKED_PROVIDER",
        message: "Il provider visual richiesto non è configurato o non è disponibile.",
        requestedModel: route.model?.requestedName ?? null,
        reason: route.reason,
      });
    }

    const meter = new ImageGenerationMetering(process.env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({
      profileId,
      source: "MANUAL",
      operationIdentity,
      referenceId: savedVariant?.id ?? null,
      requestFingerprint: { contentVariantId, provider: requestedProvider, format: requestedFormat, visualBrief, caption, additionalDirection, importance, model: route.model.apiModelId },
    });
    if (reservation.status === "DENIED") return res.status(429).json({ error: reservation.code });
    if (reservation.status === "COMPLETED") return res.status(200).json(reservation.cached.response);
    if (reservation.status === "IN_PROGRESS") return res.status(409).json({ error: "IMAGE_GENERATION_IN_PROGRESS" });
    if (reservation.status === "RELEASED") return res.status(409).json({ error: "METERING_FAILED" });
    const eventId = reservation.eventId;
    activeEventId = eventId;

    await meter.markProviderStarted(eventId);
    const tier = route.model.apiModelId === "gemini-3-pro-image" ? "PREMIUM" : "STANDARD";
    const result = await generateGeminiImage({
      apiKey: process.env.GEMINI_API_KEY!,
      tier,
      profileName: profile.name,
      industry: profile.industry,
      tone: summary(brands[0]?.tone_of_voice),
      provider: requestedProvider,
      format: requestedFormat,
      visualBrief,
      caption,
      additionalDirection,
    });
    const dataUrl = `data:${result.mimeType};base64,${result.base64}`;
    await meter.persistTechnicalEvents(profileId, eventId, technicalEventsFromImageResult(result, {
      source: "MANUAL",
      provider: requestedProvider,
      format: requestedFormat,
      task: requestedTask,
      importance,
      visual_fingerprint: fingerprint,
      budget_band: budget.band,
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
          name: `${requestedProvider}-${requestedFormat}-${savedVariant.id}.${result.mimeType.includes("jpeg") ? "jpg" : "png"}`,
          storage_url: dataUrl,
          mime_type: result.mimeType,
          tags: [requestedProvider, requestedFormat, "AI_GENERATED", "MASTER_VISUAL"],
          metadata: {
            provider: "GOOGLE",
            model: result.model,
            tier: result.tier,
            aspect_ratio: result.aspectRatio,
            image_size: result.imageSize,
            request_id: result.requestId,
            visual_fingerprint: fingerprint,
            reuse_allowed: true,
            storage_mode: "DATABASE_DATA_URL_V1",
          },
        }),
      });
      if (!assetWrite.ok) throw new Error(`ASSET_WRITE_${assetWrite.status}`);
      const assetRows = await assetWrite.json() as AssetRow[];
      asset = assetRows[0] ?? null;
      if (!asset) throw new Error("ASSET_WRITE_EMPTY");
      await linkAsset(token, profileId, savedVariant, asset.id);
    }

    const responseBody = {
      image: { dataUrl, mimeType: result.mimeType, model: result.model, size: result.imageSize, quality: result.tier, revisedPrompt: result.prompt },
      asset,
      usage: result.usage,
      budget,
      route: { status: route.status, model: route.model.apiModelId, reason: route.reason },
      reused: false,
    };
    const cachedResponse = {
      image: { dataUrl: null, mimeType: result.mimeType, model: result.model, size: result.imageSize, quality: result.tier, revisedPrompt: result.prompt },
      asset,
      usage: result.usage,
      budget,
      route: responseBody.route,
      reused: false,
      duplicate: true,
    };
    await meter.storeResult(eventId, { response: cachedResponse, assetId: asset?.id ?? null, variantId: savedVariant?.id ?? null });
    await meter.commit(eventId);
    logicalCommitted = true;
    return res.status(200).json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "IMAGE_GENERATION_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_IMAGE_ERROR";
    console.error("generate-image", { profileId, detail });
    if (detail === "PROVIDER_COST_BUDGET_REACHED") return res.status(429).json({ error: "AI_BUDGET_HARD_STOP" });
    const status = detail.startsWith("GEMINI_") ? 502 : detail.startsWith("METERING_FAILED") ? 503 : 500;
    return res.status(status).json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "IMAGE_GENERATION_FAILED" });
  }
}
