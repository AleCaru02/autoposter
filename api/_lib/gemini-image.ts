import type { ImageSocialFormat, ImageSocialProvider } from "./openai-image.js";

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
  provider: "GOOGLE";
  model: GeminiImageModel;
  mimeType: "image/png" | "image/jpeg";
  base64: string;
  requestId: string | null;
  size: "1K";
  aspectRatio: "1:1" | "9:16";
  quality: "standard" | "premium";
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    estimatedCostUsd: number | null;
  };
  technicalEvents: GeminiImageTechnicalEvent[];
};

export type GenerateGeminiImageOptions = {
  apiKey: string;
  model: GeminiImageModel;
  profileName: string;
  industry?: string | null;
  tone?: string | null;
  provider: ImageSocialProvider;
  format: ImageSocialFormat;
  visualBrief: string;
  caption?: string | null;
  additionalDirection?: string | null;
  fetcher?: typeof fetch;
};

const FLASH_1K_IMAGE_USD = 0.067;
const PRO_1K_IMAGE_USD = 0.134;
const FLASH_INPUT_PER_MILLION_USD = 0.5;
const PRO_INPUT_PER_MILLION_USD = 2;

export function geminiAspectRatioForFormat(format: ImageSocialFormat): "1:1" | "9:16" {
  return format === "STORY" ? "9:16" : "1:1";
}

export function estimateGeminiImageCostUsd(model: GeminiImageModel, inputTokens: number | null) {
  const image = model === "gemini-3-pro-image" ? PRO_1K_IMAGE_USD : FLASH_1K_IMAGE_USD;
  if (inputTokens === null) return image;
  const inputRate = model === "gemini-3-pro-image" ? PRO_INPUT_PER_MILLION_USD : FLASH_INPUT_PER_MILLION_USD;
  return image + Math.max(inputTokens, 0) * inputRate / 1_000_000;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractImage(body: Record<string, unknown>): { data: string; mimeType: "image/png" | "image/jpeg" } | null {
  const direct = body.output_image && typeof body.output_image === "object" ? body.output_image as Record<string, unknown> : null;
  if (direct && typeof direct.data === "string" && direct.data) {
    const mime = direct.mime_type === "image/jpeg" ? "image/jpeg" : "image/png";
    return { data: direct.data, mimeType: mime };
  }

  const visit = (value: unknown): { data: string; mimeType: "image/png" | "image/jpeg" } | null => {
    if (!value) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof value !== "object") return null;
    const object = value as Record<string, unknown>;
    const candidate = object.inline_data && typeof object.inline_data === "object"
      ? object.inline_data as Record<string, unknown>
      : object.inlineData && typeof object.inlineData === "object"
        ? object.inlineData as Record<string, unknown>
        : object.type === "image"
          ? object
          : null;
    if (candidate && typeof candidate.data === "string" && candidate.data) {
      const rawMime = candidate.mime_type ?? candidate.mimeType;
      return { data: candidate.data, mimeType: rawMime === "image/jpeg" ? "image/jpeg" : "image/png" };
    }
    for (const nested of Object.values(object)) {
      const found = visit(nested);
      if (found) return found;
    }
    return null;
  };

  return visit(body.output) ?? visit(body.steps) ?? visit(body.candidates);
}

export function buildGeminiImagePrompt(options: Omit<GenerateGeminiImageOptions, "apiKey" | "fetcher" | "model">) {
  return [
    `Crea un visual social per ${options.profileName}.`,
    options.industry ? `Settore: ${options.industry}.` : "",
    options.tone ? `Tono del brand: ${options.tone}.` : "",
    `Piattaforma: ${options.provider}. Formato: ${options.format}.`,
    `Brief visivo: ${options.visualBrief}.`,
    options.caption ? `Contesto del copy: ${options.caption}.` : "",
    options.additionalDirection ? `Direzione aggiuntiva: ${options.additionalDirection}.` : "",
    "Non inventare loghi, clienti, testimonianze, risultati, numeri o fatti del brand.",
    "Non inserire testo editoriale dentro l'immagine: testo, logo e CTA vengono impaginati dal Template Engine.",
    "Produci un visual pulito, credibile, coerente e utilizzabile come master visual.",
  ].filter(Boolean).join("\n");
}

export async function generateGeminiImage(options: GenerateGeminiImageOptions): Promise<GeminiImageResult> {
  if (!options.apiKey) throw new Error("GEMINI_NOT_CONFIGURED");
  const fetcher = options.fetcher ?? fetch;
  const aspectRatio = geminiAspectRatioForFormat(options.format);
  const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "x-goog-api-key": options.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      input: [{ type: "text", text: buildGeminiImagePrompt(options) }],
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: aspectRatio,
        image_size: "1K",
      },
    }),
  });

  const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id");
  const raw = await response.text();
  if (!response.ok) {
    let code = `GEMINI_IMAGE_HTTP_${response.status}`;
    try {
      const parsed = JSON.parse(raw) as { error?: { status?: string; message?: string } };
      code = parsed.error?.status || parsed.error?.message || code;
    } catch { /* keep status code */ }
    throw new Error(code);
  }

  const body = JSON.parse(raw) as Record<string, unknown>;
  const image = extractImage(body);
  if (!image) throw new Error("GEMINI_IMAGE_EMPTY_OUTPUT");

  const usage = body.usage && typeof body.usage === "object"
    ? body.usage as Record<string, unknown>
    : body.usage_metadata && typeof body.usage_metadata === "object"
      ? body.usage_metadata as Record<string, unknown>
      : {};
  const inputTokens = numberOrNull(usage.input_tokens ?? usage.prompt_token_count ?? usage.promptTokenCount);
  const outputTokens = numberOrNull(usage.output_tokens ?? usage.candidates_token_count ?? usage.candidatesTokenCount);
  const totalTokens = numberOrNull(usage.total_tokens ?? usage.total_token_count ?? usage.totalTokenCount);
  const costUsd = estimateGeminiImageCostUsd(options.model, inputTokens);

  return {
    provider: "GOOGLE",
    model: options.model,
    mimeType: image.mimeType,
    base64: image.data,
    requestId,
    size: "1K",
    aspectRatio,
    quality: options.model === "gemini-3-pro-image" ? "premium" : "standard",
    usage: { inputTokens, outputTokens, totalTokens, estimatedCostUsd: costUsd },
    technicalEvents: [{
      operation: "GENERATE_SOCIAL_IMAGE",
      model: options.model,
      inputTokens,
      outputTokens,
      costUsd,
      metadata: {
        provider: "GOOGLE",
        google_request_id: requestId,
        aspect_ratio: aspectRatio,
        image_size: "1K",
        quality: options.model === "gemini-3-pro-image" ? "premium" : "standard",
      },
    }],
  };
}
