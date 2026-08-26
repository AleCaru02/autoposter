export type ImageSocialFormat = "POST" | "CAROUSEL" | "STORY";
export type ImageSocialProvider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";
export type ImageSize = "1024x1024" | "1024x1536";

const GPT_IMAGE_2_TEXT_INPUT_PER_MILLION_USD = 5;
const GPT_IMAGE_2_IMAGE_OUTPUT_PER_MILLION_USD = 30;

export type OpenAIImageUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
};

export type OpenAIImageResult = {
  model: "gpt-image-2";
  mimeType: "image/png";
  base64: string;
  revisedPrompt: string | null;
  requestId: string | null;
  size: ImageSize;
  quality: "high";
  usage: OpenAIImageUsage;
};

export type GenerateImageOptions = {
  apiKey: string;
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

export function imageSizeForFormat(format: ImageSocialFormat): ImageSize {
  return format === "STORY" ? "1024x1536" : "1024x1024";
}

function clean(value: string | null | undefined, max: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildImagePrompt(options: Omit<GenerateImageOptions, "apiKey" | "fetcher">) {
  const sizeInstruction = options.format === "STORY"
    ? "Composizione verticale 2:3, soggetto principale ben leggibile anche su smartphone."
    : "Composizione quadrata 1:1, soggetto principale ben leggibile anche su smartphone.";
  return [
    "Crea un'immagine social originale e professionale per il brand indicato.",
    `Brand: ${clean(options.profileName, 160)}.`,
    options.industry ? `Settore: ${clean(options.industry, 200)}.` : "",
    options.tone ? `Tono visivo: ${clean(options.tone, 300)}.` : "",
    `Piattaforma: ${options.provider}. Formato: ${options.format}.`,
    sizeInstruction,
    `Brief visivo confermato: ${clean(options.visualBrief, 2_000)}.`,
    options.caption ? `Contesto del contenuto: ${clean(options.caption, 1_500)}.` : "",
    options.additionalDirection ? `Indicazione aggiuntiva: ${clean(options.additionalDirection, 700)}.` : "",
    "Qualità fotografica/grafica premium, dettagli curati, composizione pulita e credibile.",
    "Non aggiungere testo, loghi, marchi, watermark, prezzi, recensioni, certificazioni o claim non esplicitamente richiesti.",
    "Non inventare elementi fattuali dell'attività; il visual deve restare coerente con il brief senza affermare fatti nuovi.",
  ].filter(Boolean).join("\n");
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function estimateImageCostUsd(inputTokens: number, outputTokens: number) {
  return (Math.max(inputTokens, 0) * GPT_IMAGE_2_TEXT_INPUT_PER_MILLION_USD + Math.max(outputTokens, 0) * GPT_IMAGE_2_IMAGE_OUTPUT_PER_MILLION_USD) / 1_000_000;
}

export async function generateOpenAIImage(options: GenerateImageOptions): Promise<OpenAIImageResult> {
  const fetcher = options.fetcher ?? fetch;
  const size = imageSizeForFormat(options.format);
  const prompt = buildImagePrompt(options);
  const response = await fetcher("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      size,
      quality: "high",
      n: 1,
      output_format: "png",
    }),
  });
  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) {
    let message = `OPENAI_IMAGE_HTTP_${response.status}`;
    try {
      const body = JSON.parse(raw) as { error?: { code?: string; message?: string } };
      message = body.error?.code || body.error?.message || message;
    } catch { /* keep generic status */ }
    throw new Error(message);
  }
  const body = JSON.parse(raw) as Record<string, unknown>;
  const data = Array.isArray(body.data) ? body.data : [];
  const first = data[0] && typeof data[0] === "object" ? data[0] as Record<string, unknown> : null;
  const base64 = first && typeof first.b64_json === "string" ? first.b64_json : "";
  if (!base64) throw new Error("OPENAI_IMAGE_EMPTY_OUTPUT");
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const inputTokens = numberOrNull(usage.input_tokens);
  const outputTokens = numberOrNull(usage.output_tokens);
  return {
    model: "gpt-image-2",
    mimeType: "image/png",
    base64,
    revisedPrompt: first && typeof first.revised_prompt === "string" ? first.revised_prompt : null,
    requestId,
    size,
    quality: "high",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: numberOrNull(usage.total_tokens),
      estimatedCostUsd: inputTokens !== null && outputTokens !== null ? estimateImageCostUsd(inputTokens, outputTokens) : null,
    },
  };
}
