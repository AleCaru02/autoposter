import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateOpenAIImage, type ImageSocialFormat, type ImageSocialProvider } from "./_lib/openai-image.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";
const VALID_PROVIDERS = new Set<ImageSocialProvider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
const VALID_FORMATS = new Set<ImageSocialFormat>(["POST", "CAROUSEL", "STORY"]);
const DEFAULT_MONTHLY_IMAGE_LIMIT = 20;

type ProfileRow = { id: string; name: string; industry: string | null };
type BrandRow = { tone_of_voice: unknown };
type UsageRow = { id: string };

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

  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const provider = typeof req.body?.provider === "string" && VALID_PROVIDERS.has(req.body.provider as ImageSocialProvider) ? req.body.provider as ImageSocialProvider : null;
  const format = typeof req.body?.format === "string" && VALID_FORMATS.has(req.body.format as ImageSocialFormat) ? req.body.format as ImageSocialFormat : null;
  const visualBrief = typeof req.body?.visualBrief === "string" ? req.body.visualBrief.trim().slice(0, 2_000) : "";
  const caption = typeof req.body?.caption === "string" ? req.body.caption.trim().slice(0, 1_500) : null;
  const additionalDirection = typeof req.body?.additionalDirection === "string" ? req.body.additionalDirection.trim().slice(0, 700) : null;
  if (!profileId || !provider || !format || !visualBrief) return res.status(400).json({ error: "IMAGE_INPUT_REQUIRED" });

  try {
    const profiles = await readRows<ProfileRow>(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,name,industry&limit=1`, token);
    const profile = profiles[0];
    if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    const brands = await readRows<BrandRow>(`brand_profiles?profile_id=eq.${encodeURIComponent(profileId)}&select=tone_of_voice&limit=1`, token);

    const limit = monthlyImageLimit();
    const used = await readRows<UsageRow>(`ai_usage_events?created_at=gte.${encodeURIComponent(monthStartIso())}&operation=eq.GENERATE_SOCIAL_IMAGE&select=id&limit=${limit + 1}`, token);
    if (used.length >= limit) {
      return res.status(429).json({ error: "OPENAI_IMAGE_MONTHLY_LIMIT_REACHED", message: "Limite mensile immagini raggiunto. Nessuna chiamata OpenAI è stata eseguita.", quota: { used: used.length, limit, remaining: 0 } });
    }

    const result = await generateOpenAIImage({ apiKey: process.env.OPENAI_API_KEY, profileName: profile.name, industry: profile.industry, tone: summary(brands[0]?.tone_of_voice), provider, format, visualBrief, caption, additionalDirection });

    const usageWrite = await dataApi("ai_usage_events", token, {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        profile_id: profileId,
        operation: "GENERATE_SOCIAL_IMAGE",
        model: result.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cost_usd: result.usage.estimatedCostUsd,
        metadata: { openai_request_id: result.requestId, quality: result.quality, size: result.size, provider, format, cost_status: result.usage.estimatedCostUsd == null ? "usage_not_returned" : "estimated_from_openai_usage" },
      }),
    });
    if (!usageWrite.ok) console.error("ai-image-usage-write", { profileId, status: usageWrite.status });

    return res.status(200).json({ image: { dataUrl: `data:${result.mimeType};base64,${result.base64}`, mimeType: result.mimeType, model: result.model, size: result.size, quality: result.quality, revisedPrompt: result.revisedPrompt }, usage: result.usage, quota: { used: used.length + 1, limit, remaining: Math.max(limit - used.length - 1, 0) } });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "UNKNOWN_IMAGE_ERROR";
    console.error("generate-image", { profileId, detail });
    const status = detail.startsWith("OPENAI_IMAGE_") ? 502 : 500;
    return res.status(status).json({ error: "IMAGE_GENERATION_FAILED", detail });
  }
}
