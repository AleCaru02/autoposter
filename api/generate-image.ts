import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ImageSocialFormat, ImageSocialProvider } from "./_lib/openai-image.js";
import { generateRoutedImage } from "./_lib/routed-image.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "./_lib/image-generation-metering.js";
import { ActivityBudgetEngine } from "./_lib/activity-budget.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<ImageSocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<ImageSocialFormat>(["POST", "CAROUSEL", "STORY"]);

type ProfileRow = { id: string; name: string; industry: string | null };
type BrandRow = { tone_of_voice: unknown };
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

    const activityBudget = await new ActivityBudgetEngine(process.env.DATABASE_URL).preflight({
      profileId,
      task: "IMAGE_STANDARD",
      importance: "STANDARD",
      projectedOperationCostUsd: 0.25,
    });
    if (!activityBudget.allowed) {
      await meter.release(eventId, activityBudget.reason ?? "AI_BUDGET_HARD_STOP");
      return res.status(429).json({ error: activityBudget.reason ?? "AI_BUDGET_HARD_STOP", budget: activityBudget });
    }

    const routeImportance = req.body?.importance === "PREMIUM" || req.body?.importance === "CRITICAL" ? req.body.importance : "STANDARD";
    await meter.markProviderStarted(eventId);
    const result = await generateRoutedImage({
      env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY },
      budget: activityBudget,
      importance: routeImportance,
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
      source: "MANUAL", provider: requestedProvider, format: requestedFormat,
    }));

    let asset: AssetRow | null = null;
    if (savedVariant) {
      const assetWrite = await dataApi("assets", token, {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          profile_id: profileId,
          source: result.provider === "GOOGLE" ? "GOOGLE_GEMINI_IMAGE" : "AI_IMAGE",
          kind: "IMAGE",
          name: `${requestedProvider}-${requestedFormat}-${savedVariant.id}.png`,
          storage_url: dataUrl,
          mime_type: result.mimeType,
          tags: [requestedProvider, requestedFormat, "AI_GENERATED"],
          metadata: { provider: result.provider, model: result.model, quality: result.quality, size: result.size, aspect_ratio: result.aspectRatio, provider_request_id: result.requestId, storage_mode: "DATABASE_DATA_URL_V1" },
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

    const responseBody = { image: { dataUrl, mimeType: result.mimeType, model: result.model, size: result.size, quality: result.quality, provider: result.provider, aspectRatio: result.aspectRatio }, asset, usage: result.usage, budget: { currency: "EUR", band: activityBudget.band, hardCapEur: activityBudget.hardCapEur, spendEur: activityBudget.spendEur, remainingEur: activityBudget.remainingEur, forecastEndOfMonthEur: activityBudget.forecastEndOfMonthEur } };
    const cachedResponse = { image: { dataUrl: null, mimeType: result.mimeType, model: result.model, size: result.size, quality: result.quality, provider: result.provider, aspectRatio: result.aspectRatio }, asset, usage: result.usage, budget: responseBody.budget, duplicate: true };
    await meter.storeResult(eventId, { response: cachedResponse, assetId: asset?.id ?? null, variantId: savedVariant?.id ?? null });
    await meter.commit(eventId);
    logicalCommitted = true;
    return res.status(200).json(responseBody);
  } catch (reason) {
    if (activeMeter && activeEventId && !logicalCommitted) await activeMeter.release(activeEventId, reason instanceof Error ? reason.message : "IMAGE_GENERATION_FAILED").catch(() => undefined);
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_IMAGE_ERROR";
    console.error("generate-image", { profileId, detail });
    if (detail === "PROVIDER_COST_BUDGET_REACHED") return res.status(429).json({ error: detail });
    if (detail.startsWith("MODEL_ROUTER_BLOCKED_PROVIDER") || detail.startsWith("GEMINI_NOT_CONFIGURED")) return res.status(503).json({ error: "BLOCKED_PROVIDER" });
    const status = detail.startsWith("GEMINI_") ? 502 : detail.startsWith("METERING_FAILED") ? 503 : 500;
    return res.status(status).json({ error: detail.startsWith("METERING_FAILED") ? "METERING_FAILED" : "IMAGE_GENERATION_FAILED" });
  }
}
