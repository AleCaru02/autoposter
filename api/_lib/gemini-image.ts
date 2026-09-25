import { buildImagePrompt, OpenAIImagePipelineError, type GenerateImageOptions, type OpenAIImageResult, type OpenAIImageTechnicalEvent } from "./openai-image.js";

const FLASH_INPUT_PER_MILLION_USD = 0.50;
const FLASH_IMAGE_1K_USD = 0.067;
const PRO_INPUT_PER_MILLION_USD = 2;
const PRO_IMAGE_1K_USD = 0.134;

function n(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function usage(body: Record<string, unknown>) {
  const raw = body.usage && typeof body.usage === "object"
    ? body.usage as Record<string, unknown>
    : body.usage_metadata && typeof body.usage_metadata === "object"
      ? body.usage_metadata as Record<string, unknown>
      : {};
  const inputTokens = n(raw.input_tokens ?? raw.prompt_token_count ?? raw.inputTokenCount);
  const outputTokens = n(raw.output_tokens ?? raw.candidates_token_count ?? raw.outputTokenCount);
  const totalTokens = n(raw.total_tokens ?? raw.total_token_count ?? raw.totalTokenCount) || inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function imageFromBody(body: Record<string, unknown>) {
  const direct = body.output_image;
  if (typeof direct === "string" && direct) return { data: direct, mimeType: "image/png" };
  if (direct && typeof direct === "object") {
    const record = direct as Record<string, unknown>;
    const data = typeof record.data === "string" ? record.data : null;
    const mimeType = typeof record.mime_type === "string" ? record.mime_type : typeof record.mimeType === "string" ? record.mimeType : "image/png";
    if (data) return { data, mimeType };
  }
  for (const step of Array.isArray(body.steps) ? body.steps : []) {
    if (!step || typeof step !== "object" || (step as { type?: unknown }).type !== "model_output") continue;
    const content = Array.isArray((step as { content?: unknown }).content) ? (step as { content: unknown[] }).content : [];
    for (const block of content) {
      if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "image") continue;
      const record = block as Record<string, unknown>;
      const data = typeof record.data === "string" ? record.data : null;
      const mimeType = typeof record.mime_type === "string" ? record.mime_type : "image/png";
      if (data) return { data, mimeType };
    }
  }
  return null;
}

function aspectRatio(format: GenerateImageOptions["format"]) {
  return format === "STORY" ? "9:16" : "1:1";
}

export function estimateGeminiImageCostUsd(model: string, inputTokens: number) {
  if (model === "gemini-3.1-flash-image") return inputTokens * FLASH_INPUT_PER_MILLION_USD / 1_000_000 + FLASH_IMAGE_1K_USD;
  if (model === "gemini-3-pro-image") return inputTokens * PRO_INPUT_PER_MILLION_USD / 1_000_000 + PRO_IMAGE_1K_USD;
  throw new Error("GEMINI_IMAGE_MODEL_NOT_ALLOWED");
}

export async function generateGeminiImage(options: GenerateImageOptions & { model: "gemini-3.1-flash-image" | "gemini-3-pro-image" }): Promise<OpenAIImageResult> {
  if (!options.apiKey) throw new Error("GEMINI_NOT_CONFIGURED");
  const fetcher = options.fetcher ?? fetch;
  const prompt = buildImagePrompt(options);
  const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": options.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      input: [{ type: "text", text: prompt }],
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: aspectRatio(options.format),
        image_size: "1K",
      },
    }),
  });
  const requestId = response.headers.get("x-goog-request-id") || response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) {
    let message = `GEMINI_IMAGE_HTTP_${response.status}`;
    try {
      const parsed = JSON.parse(raw) as { error?: { status?: string; message?: string } };
      message = parsed.error?.status || parsed.error?.message || message;
    } catch { /* keep status */ }
    throw new OpenAIImagePipelineError(message, []);
  }
  const body = JSON.parse(raw) as Record<string, unknown>;
  const image = imageFromBody(body);
  if (!image) throw new OpenAIImagePipelineError("GEMINI_IMAGE_EMPTY_OUTPUT", []);
  const metering = usage(body);
  const costUsd = estimateGeminiImageCostUsd(options.model, metering.inputTokens);
  const technicalEvent: OpenAIImageTechnicalEvent = {
    operation: "GENERATE_SOCIAL_IMAGE",
    model: options.model,
    inputTokens: metering.inputTokens,
    outputTokens: metering.outputTokens,
    costUsd,
    metadata: {
      provider: "GOOGLE",
      google_request_id: requestId,
      aspect_ratio: aspectRatio(options.format),
      image_size: "1K",
    },
  };
  return {
    model: options.model,
    mimeType: image.mimeType === "image/jpeg" ? "image/png" : "image/png",
    base64: image.data,
    revisedPrompt: null,
    requestId,
    size: options.format === "STORY" ? "1024x1536" : "1024x1024",
    quality: options.model === "gemini-3-pro-image" ? "premium" : "standard",
    mediaManager: {
      model: "RULE_BASED_VISUAL_BRIEF",
      responseId: "",
      requestId: null,
      visualIntent: options.visualBrief,
      composition: aspectRatio(options.format),
      altText: options.visualBrief.slice(0, 500),
    },
    usage: {
      inputTokens: metering.inputTokens,
      outputTokens: metering.outputTokens,
      totalTokens: metering.totalTokens,
      estimatedCostUsd: costUsd,
      mediaManagerInputTokens: 0,
      mediaManagerOutputTokens: 0,
      mediaManagerCostUsd: 0,
    },
    technicalEvents: [technicalEvent],
  };
}
