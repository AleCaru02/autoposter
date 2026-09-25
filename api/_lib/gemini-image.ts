import type { ImageSocialFormat, ImageSocialProvider } from "./openai-image.js";

export type GeminiImageTier = "STANDARD" | "PREMIUM";
export type GeminiImageModel = "gemini-3.1-flash-image" | "gemini-3-pro-image";

export type GeminiImageTechnicalEvent = {
  operation: "GENERATE_SOCIAL_IMAGE";
  model: GeminiImageModel;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  metadata: Record<string, unknown>;
};

export type GeminiImageResult = {
  model: GeminiImageModel;
  provider: "GOOGLE";
  mimeType: string;
  base64: string;
  requestId: string | null;
  aspectRatio: string;
  imageSize: "1K" | "2K";
  tier: GeminiImageTier;
  prompt: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
  };
  technicalEvents: GeminiImageTechnicalEvent[];
};

type GenerateGeminiImageOptions = {
  apiKey: string;
  tier: GeminiImageTier;
  profileName: string;
  industry: string | null;
  tone: string | null;
  provider: ImageSocialProvider;
  format: ImageSocialFormat;
  visualBrief: string;
  caption?: string | null;
  additionalDirection?: string | null;
  fetcher?: typeof fetch;
};

function n(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function geminiImagePlacement(provider: ImageSocialProvider, format: ImageSocialFormat) {
  if (format === "STORY") return { aspectRatio: "9:16", imageSize: "1K" as const };
  if (provider === "LINKEDIN" || provider === "GBP") return { aspectRatio: "1:1", imageSize: "1K" as const };
  return { aspectRatio: "4:5", imageSize: "1K" as const };
}

export function geminiImageModelForTier(tier: GeminiImageTier): GeminiImageModel {
  return tier === "PREMIUM" ? "gemini-3-pro-image" : "gemini-3.1-flash-image";
}

export function buildGeminiImagePrompt(input: Omit<GenerateGeminiImageOptions, "apiKey" | "fetcher">) {
  return [
    "Crea il visual master per un contenuto social professionale.",
    `Brand: ${input.profileName}.`,
    input.industry ? `Settore: ${input.industry}.` : "",
    input.tone ? `Tono visivo coerente con: ${input.tone}.` : "",
    `Piattaforma: ${input.provider}. Formato: ${input.format}.`,
    `Brief confermato: ${input.visualBrief.trim()}.`,
    input.caption ? `Contesto editoriale: ${input.caption.trim()}.` : "",
    input.additionalDirection ? `Direzione aggiuntiva: ${input.additionalDirection.trim()}.` : "",
    "Non inventare loghi, persone reali, prodotti, sedi, prezzi, risultati, certificazioni o dettagli specifici del brand non presenti nel brief.",
    "Non incorporare testo, slogan, watermark o loghi dentro l'immagine: testo, logo e CTA vengono composti dal Template Engine software.",
    "Evita marchi di terzi e interfacce riconoscibili salvo che siano esplicitamente necessarie e fornite come asset.",
    "Composizione pulita, credibile e utilizzabile come base per layout social responsive.",
  ].filter(Boolean).join("\n");
}

function imageCost(model: GeminiImageModel, imageSize: "1K" | "2K") {
  if (model === "gemini-3-pro-image") return 0.134;
  return imageSize === "2K" ? 0.101 : 0.067;
}

function textTokenCost(model: GeminiImageModel, inputTokens: number | null, outputTokens: number | null) {
  if (inputTokens === null && outputTokens === null) return 0;
  const inputPerMillion = model === "gemini-3-pro-image" ? 2 : 0.5;
  const outputPerMillion = model === "gemini-3-pro-image" ? 12 : 3;
  return ((inputTokens ?? 0) * inputPerMillion + (outputTokens ?? 0) * outputPerMillion) / 1_000_000;
}

function outputImage(body: Record<string, unknown>) {
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") continue;
    const parts = Array.isArray((content as { parts?: unknown }).parts) ? (content as { parts: unknown[] }).parts : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const inlineData = (part as { inlineData?: unknown }).inlineData;
      if (!inlineData || typeof inlineData !== "object") continue;
      const data = (inlineData as { data?: unknown }).data;
      const mimeType = (inlineData as { mimeType?: unknown }).mimeType;
      if (typeof data === "string" && data.length > 100 && typeof mimeType === "string" && mimeType.startsWith("image/")) {
        return { data, mimeType };
      }
    }
  }
  return null;
}

export async function generateGeminiImage(options: GenerateGeminiImageOptions): Promise<GeminiImageResult> {
  if (!options.apiKey.trim()) throw new Error("GEMINI_NOT_CONFIGURED");
  const model = geminiImageModelForTier(options.tier);
  const placement = geminiImagePlacement(options.provider, options.format);
  const imageSize = options.tier === "PREMIUM" ? "2K" as const : placement.imageSize;
  const prompt = buildGeminiImagePrompt(options);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": options.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio: placement.aspectRatio,
          imageSize,
        },
      },
    }),
  });
  const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id");
  const raw = await response.text();
  if (!response.ok) {
    let detail = `GEMINI_IMAGE_HTTP_${response.status}`;
    try {
      const parsed = JSON.parse(raw) as { error?: { status?: string; message?: string } };
      detail = parsed.error?.status || parsed.error?.message || detail;
    } catch { /* keep generic status */ }
    throw new Error(detail);
  }
  const body = JSON.parse(raw) as Record<string, unknown>;
  const image = outputImage(body);
  if (!image) throw new Error("GEMINI_IMAGE_EMPTY_OUTPUT");
  const usage = body.usageMetadata && typeof body.usageMetadata === "object" ? body.usageMetadata as Record<string, unknown> : {};
  const inputTokens = n(usage.promptTokenCount);
  const outputTokens = n(usage.candidatesTokenCount);
  const totalTokens = n(usage.totalTokenCount);
  const estimatedCostUsd = imageCost(model, imageSize) + textTokenCost(model, inputTokens, outputTokens);
  const event: GeminiImageTechnicalEvent = {
    operation: "GENERATE_SOCIAL_IMAGE",
    model,
    inputTokens,
    outputTokens,
    costUsd: estimatedCostUsd,
    metadata: {
      provider: "GOOGLE",
      request_id: requestId,
      tier: options.tier,
      aspect_ratio: placement.aspectRatio,
      image_size: imageSize,
    },
  };
  return {
    model,
    provider: "GOOGLE",
    mimeType: image.mimeType,
    base64: image.data,
    requestId,
    aspectRatio: placement.aspectRatio,
    imageSize,
    tier: options.tier,
    prompt,
    usage: { inputTokens, outputTokens, totalTokens, estimatedCostUsd },
    technicalEvents: [event],
  };
}
