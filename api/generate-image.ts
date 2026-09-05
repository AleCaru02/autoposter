import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateOpenAIImage, OpenAIImagePipelineError, type ImageSocialFormat, type ImageSocialProvider } from "./_lib/openai-image.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "./_lib/image-generation-metering.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<ImageSocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<ImageSocialFormat>(["POST", "CAROUSEL", "STORY"]);
const DEFAULT_MONTHLY_IMAGE_LIMIT = 20;

type ProfileRow = { id: string; name: string; industry: string | null };
type BrandRow = { tone_of_voice: unknown };
type UsageRow = { id: string };
type VariantRow = {
  id: string;
  content_id: string;
  provider: ImageSocialProvider;
  format: ImageSocialFormat;
  image_asset_id: string | null;
};
type AssetRow = { id: string };

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

async function deleteRow(path: string, token: string) {
  const response = await dataApi(path, token, { method: "DELETE" });
  if (!response.ok) console.error("data-api-delete", { path, status: response.status });
}

function summary(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>).summary;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function monthlyImageLimit() {
  const parsed = Number(process.env.OPENAI_IMAGE_MONTHLY_LIMIT ?? DEFAULT_MONTHLY_IMAGE_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_MONTHLY_IMAGE_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), 200);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_NOT_CONFIGURED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });

  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const requestedProvider = typeof req.body?.provider === "string" && VALID_PROVIDERS.has(req.body.provider as ImageSocialProvider) ? req.body.provider as ImageSocialProvider : null;
  const requestedFormat = typeof req.body?.format === "string" && VALID_FORMATS.has(req.body.format as ImageSocialFormat) ? req.body.format as ImageSocialFormat : null;
  const contentVariantId = typeof req.body?.contentVariantId === "string" ? req.body.contentVariantId : null;
  const visualBrief = typeof req.body?.visualBrief === "string" ? req.body.visualBrief.trim().slice(0, 2_000) : "";
  const caption = typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 1_500) : null;
  const additionalDirection = typeof req.body?.additionalDirection === "string" ? req.body.additionalDirection.trim().slice(0, 700) : null;
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

    const meter = new ImageGenerationMetering(process.env.DATABASE_URL);
    activeMeter = meter;
    const reservation = await meter.reserve({
      profileId,
      source: "MANUAL",
      operationIdentity,
      referenceId: savedVariant?.id ?? null,
      requestFingerprint: { contentVariantId, provider: requestedProvider, format: requestedFormat, visualBrief, caption, additionalDirection },
    });
    if (reservation.status === "DENIED") return res.status(429).json({ error: reservation.code });
    if (reservation.status === "COMPLETED") return res.status(200).json(reservation.cached.response);
    if (reservation.status === "IN_PROGRESS") return res.status(409).json({ error: "IMAGE_GENERATION_IN_PROGRESS" });
    if (reservation.status === "RELEASED") return res.status(409).json({ error: "METERING_FAILED" });
    const eventId = reservation.eventId;
    activeEventId = eventId;

    const limit = monthlyImageLimit();
    const used = await readRows<UsageRow>(`ai_usage_events?profile_id=eq.${encodeURIComponent(profileId)}&created_at=gte.${encodeURIComponent(monthStartIso())}&operation=eq.GENERATE_SOCIAL_IMAGE&select=id&limit=${limit + 1}`, token);
    if (used.length >= limit) {
      await meter.release(eventId, "OPENAI_IMAGE_MONTHLY_LIMIT_REACHED");
      return res.status(429).json({ error: "OPENAI_IMAGE_MONTHLY_LIMIT_REACHED", message: "Limite mensile immagini raggiunto. Nessuna chiamata OpenAI è stata eseguita.", quota: { used: used.length, limit, remaining: 0 } });
    }

    await meter.markProviderStarted(eventId);
    const result = await generateOpenAIImage({ apiKey: process.env.OPENAI_API_KEY, profileName: profile.name, industry: profile.industry, tone: summary(brands[0]?.tone_of_voice), provider: requestedProvider, format: requestedFormat, visualBrief, caption, additionalDirection });
    const dataUrl = `data:${result.mimeType};base64,${result.base64}`;
    await meter.persistTechnicalEvents(profileId, eventId, technicalEventsFromImageResult(result, {
      source: "MANUAL", provider: requestedProvider, format: requestedFormat,
    }));

    let asset: AssetRow | null = null;
    if (savedVariant) {
      const assetWrite = await dataApi("assets", token, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          profile_id: profileId,
          source: "OPENAI_GPT_IMAGE_2",
          kind: "IMAGE",
          name: `${requestedProvider}-${requestedFormat}-${savedVariant.id}.png`,
          storage_url: dataUrl,
          mime_type: result.mimeType,
          tags: [requestedProvider, requestedFormat, "AI_GENERATED"],
          metadata: { model: result.model, quality: result.quality, size: result.size, openai_request_id: result.requestId, storage_mode: "DATABASE_DATA_URL_V1" },
        }),
      });
      if (!assetWrite.ok) throw new Error(`ASSET_WRITE_${assetWrite.status}`);
      const assetRows = await assetWrite.json() as AssetRow[];
      asset = assetRows[0] ?? null;
      if (!asset) throw new Error("ASSET_WRITE_EMPTY");

      const now = new Date().toISOString();
      const variantWrite = await dataApi(`content_variants?id=eq.${encodeURIComponent(savedVariant.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ image_asset_id: asset.id, approval_status: "PENDING", updated_at: now }),
      });
      if (!variantWrite.ok) {
        await deleteRow(`assets?id=eq.${encodeURIComponent(asset.id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token);
        throw new Error(`CONTENT_VARIANT_IMAGE_LINK_${variantWrite.status}`);
      }
      const parentWrite = await dataApi(`content_items?id=eq.${encodeURIComponent(savedVariant.content_id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ status: "IN_REVIEW", updated_at: now }),
      });
      if (!parentWrite.ok) console.error("content-parent-reopen", { contentId: savedVariant.content_id, status: parentWrite.status });
      if (savedVariant.image_asset_id && savedVariant.image_asset_id !== asset.id) {
        await deleteRow(`assets?id=eq.${encodeURIComponent(savedVariant.image_asset_id)}&profile_id=eq.${encodeURIComponent(profileId)}`, token);
      }
    }

    const responseBody = { image: { dataUrl, mimeType: result.mimeType, model: result.model, size: result.size, quality: result.quality, revisedPrompt: result.revisedPrompt }, asset, usage: result.usage, quota: { used: used.length + 1, limit, remaining: Math.max(limit - used.length - 1, 0) } };
    const cachedResponse = { image: { dataUrl: null, mimeType: result.mimeType, model: result.model, size: result.size, quality: result.quality, revisedPrompt: result.revisedPrompt }, asset, usage: result.usage, quota: responseBody.quota, duplicate: true };
    await meter.storeResult(eventId, { response: cachedResponse, assetId: asset?.id ?? null, variantId: savedVariant?.id ?? null });
    await meter.commit(eventId);
    logicalCommitted = true;
    return res.status(200).json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && reason instanceof OpenAIImagePipelineError) await activeMeter.persistTechnicalEvents(profileId, activeEventId, reason.technicalEvents).catch(() => undefined);
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "IMAGE_GENERATION_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_IMAGE_ERROR";
    console.error("generate-image", { profileId, detail });
    if (detail === "PROVIDER_COST_BUDGET_REACHED") return res.status(429).json({ error: detail });
    const status = detail.startsWith("OPENAI_") ? 502 : detail.startsWith("METERING_FAILED") ? 503 : 500;
    return res.status(status).json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "IMAGE_GENERATION_FAILED", detail });
  }
}
