import { runOpenAIMediaManager } from "./openai-media-manager.js";

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
  mediaManagerInputTokens: number;
  mediaManagerOutputTokens: number;
  mediaManagerCostUsd: number;
};

export type OpenAIImageTechnicalEvent = {
  operation: "AGENT_MEDIA_MANAGER" | "GENERATE_SOCIAL_IMAGE";
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  metadata: Record<string, unknown>;
};

export class OpenAIImagePipelineError extends Error {
  constructor(message: string, readonly technicalEvents: OpenAIImageTechnicalEvent[]) {
    super(message);
    this.name = "OpenAIImagePipelineError";
  }
}

export type OpenAIImageResult = {
  provider: "OPENAI";
  model: "gpt-image-2";
  mimeType: "image/png";
  base64: string;
  revisedPrompt: string | null;
  generationPrompt: string;
  requestId: string | null;
  size: ImageSize;
  aspectRatio: "1:1" | "2:3";
  quality: "high";
  mediaManager: {
    model: "gpt-5.6-terra";
    responseId: string;
    requestId: string | null;
    visualIntent: string;
    composition: string;
    altText: string;
  };
  usage: OpenAIImageUsage;
  technicalEvents: OpenAIImageTechnicalEvent[];
};

export type GenerateImageOptions = {
  apiKey: string;
  profileName: string;
  industry: string | null;
  tone: string | null;
  brandColors?: string[];
  brandFonts?: string[];
  brandVisualStyle?: string | null;
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

function cleanList(values: string[] | undefined, maxItems: number, itemMax = 120) {
  return [...new Set((values ?? []).map((value) => clean(value, itemMax)).filter(Boolean))].slice(0, maxItems);
}

export function buildImageGuardrails(options: Omit<GenerateImageOptions, "apiKey" | "fetcher">) {
  const colors = cleanList(options.brandColors, 8, 64);
  const fonts = cleanList(options.brandFonts, 6, 100);
  const storySafety = options.format === "STORY"
    ? "STORY: mantieni testo e soggetto essenziali nella zona centrale, con ampio respiro sopra e sotto per l'interfaccia social e margini laterali sufficienti per un successivo ritaglio 9:16."
    : "POST/CAROUSEL: mantieni headline, soggetto ed elementi essenziali ad almeno circa l'8% dai bordi e leggibili in anteprima mobile.";
  return [
    "VINCOLI VISIVI OBBLIGATORI:",
    colors.length ? `Palette del profilo da rispettare: ${colors.join(", ")}. Usane 2-4 in modo coerente come colori dominanti/accento; non sostituirli con una palette arbitraria. Neutri sono ammessi solo per contrasto e leggibilità.` : "Se non è disponibile una palette confermata, scegli colori coerenti con il settore ma evita combinazioni arbitrarie o eccessivamente decorative.",
    fonts.length ? `Carattere tipografico osservato nel brand: ${fonts.join(", ")}. Mantieni una personalità tipografica coerente; non inventare uno stile editoriale opposto.` : "",
    options.brandVisualStyle ? `Stile visivo del profilo: ${clean(options.brandVisualStyle, 1_200)}.` : "",
    "Il visual deve comunicare l'idea centrale del contenuto, non limitarsi a decorare il luogo o il settore.",
    "Una sola gerarchia principale e al massimo tre elementi secondari. Niente composizioni affollate, collage casuali, infografiche improvvisate o troppi punti focali.",
    "Per luoghi reali, quartieri, mappe, metro, strade, landmark o percorsi: non inventare cartografia, posizioni, linee, fermate, collegamenti, distanze, edifici o label fattuali. Senza dati geografici verificati o asset reale, usa una rappresentazione editoriale non cartografica o uno schema chiaramente concettuale.",
    "Non mostrare un appartamento, ufficio, vista panoramica, prodotto, persona o risultato sintetico come se appartenesse davvero al brand, salvo conferma esplicita nel brief.",
    "Se il brief richiede testo nell'immagine, usa esclusivamente il testo richiesto: massimo un headline e un eventuale sottotitolo breve. Non aggiungere microcopy, nomi di quartieri, label, numeri, pseudo-dati o didascalie inventate.",
    "Testo ad alto contrasto, grande e immediatamente leggibile su smartphone; non sovrapporlo a zone visivamente rumorose.",
    storySafety,
    "Non inventare loghi, marchi, prezzi, recensioni, certificazioni, risultati o claim fattuali.",
  ].filter(Boolean).join("\n");
}

function buildFallbackArtDirection(options: Omit<GenerateImageOptions, "apiKey" | "fetcher">) {
  const sizeInstruction = options.format === "STORY"
    ? "Composizione verticale 2:3 progettata per restare leggibile dopo un ritaglio 9:16."
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
    "Costruisci una vera art direction: punto focale, gerarchia visiva, primo piano, piano intermedio, sfondo, profondità, prospettiva, illuminazione, ombre, atmosfera, materiali e texture.",
    "Il risultato deve avere qualità editoriale premium e impatto da social feed, evitando look da stock, template vuoti, composizioni piatte o elementi decorativi casuali.",
    "Quando il concetto è astratto o informativo, trasformalo in una scena o metafora visuale concreta e pertinente.",
  ].filter(Boolean).join("\n");
}

export function buildImagePrompt(options: Omit<GenerateImageOptions, "apiKey" | "fetcher">) {
  return [buildFallbackArtDirection(options), buildImageGuardrails(options)].filter(Boolean).join("\n\n");
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
  const mediaManager = await runOpenAIMediaManager({
    apiKey: options.apiKey,
    profileName: options.profileName,
    industry: options.industry,
    tone: options.tone,
    brandColors: options.brandColors ?? [],
    brandFonts: options.brandFonts ?? [],
    brandVisualStyle: options.brandVisualStyle ?? null,
    provider: options.provider,
    format: options.format,
    visualBrief: options.visualBrief,
    caption: options.caption,
    additionalDirection: options.additionalDirection,
    fetcher,
  });
  const mediaManagerEvent: OpenAIImageTechnicalEvent = {
    operation: "AGENT_MEDIA_MANAGER",
    model: mediaManager.model,
    inputTokens: mediaManager.usage.inputTokens,
    outputTokens: mediaManager.usage.outputTokens,
    costUsd: mediaManager.usage.estimatedCostUsd,
    metadata: { openai_response_id: mediaManager.responseId, openai_request_id: mediaManager.requestId },
  };
  const mediaPrompt = mediaManager.imagePrompt.trim();
  const promptBase = mediaPrompt.length >= 600
    ? mediaPrompt
    : [
        mediaPrompt,
        mediaManager.visualIntent ? `Intento visivo: ${clean(mediaManager.visualIntent, 400)}.` : "",
        mediaManager.subject ? `Soggetto e dettagli: ${clean(mediaManager.subject, 600)}.` : "",
        mediaManager.environment ? `Ambiente: ${clean(mediaManager.environment, 600)}.` : "",
        mediaManager.composition ? `Composizione e gerarchia: ${clean(mediaManager.composition, 700)}.` : "",
        mediaManager.style ? `Stile, luce e atmosfera: ${clean(mediaManager.style, 700)}.` : "",
        buildFallbackArtDirection(options),
      ].filter(Boolean).join("\n");
  const prompt = [promptBase, buildImageGuardrails(options)].filter(Boolean).join("\n\n");
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
    throw new OpenAIImagePipelineError(message, [mediaManagerEvent]);
  }
  const body = JSON.parse(raw) as Record<string, unknown>;
  const data = Array.isArray(body.data) ? body.data : [];
  const first = data[0] && typeof data[0] === "object" ? data[0] as Record<string, unknown> : null;
  const base64 = first && typeof first.b64_json === "string" ? first.b64_json : "";
  if (!base64) throw new OpenAIImagePipelineError("OPENAI_IMAGE_EMPTY_OUTPUT", [mediaManagerEvent]);
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const imageInputTokens = numberOrNull(usage.input_tokens);
  const imageOutputTokens = numberOrNull(usage.output_tokens);
  const imageCost = imageInputTokens !== null && imageOutputTokens !== null ? estimateImageCostUsd(imageInputTokens, imageOutputTokens) : null;
  const totalCost = imageCost === null ? null : imageCost + mediaManager.usage.estimatedCostUsd;
  const imageEvent: OpenAIImageTechnicalEvent = {
    operation: "GENERATE_SOCIAL_IMAGE",
    model: "gpt-image-2",
    inputTokens: imageInputTokens,
    outputTokens: imageOutputTokens,
    costUsd: imageCost,
    metadata: { openai_request_id: requestId, quality: "high", size },
  };
  return {
    provider: "OPENAI",
    model: "gpt-image-2",
    mimeType: "image/png",
    base64,
    revisedPrompt: first && typeof first.revised_prompt === "string" ? first.revised_prompt : null,
    generationPrompt: prompt,
    requestId,
    size,
    aspectRatio: options.format === "STORY" ? "2:3" : "1:1",
    quality: "high",
    mediaManager: {
      model: mediaManager.model,
      responseId: mediaManager.responseId,
      requestId: mediaManager.requestId,
      visualIntent: mediaManager.visualIntent,
      composition: mediaManager.composition,
      altText: mediaManager.altText,
    },
    usage: {
      inputTokens: imageInputTokens === null ? null : imageInputTokens + mediaManager.usage.inputTokens,
      outputTokens: imageOutputTokens === null ? null : imageOutputTokens + mediaManager.usage.outputTokens,
      totalTokens: numberOrNull(usage.total_tokens) === null ? null : Number(usage.total_tokens) + mediaManager.usage.totalTokens,
      estimatedCostUsd: totalCost,
      mediaManagerInputTokens: mediaManager.usage.inputTokens,
      mediaManagerOutputTokens: mediaManager.usage.outputTokens,
      mediaManagerCostUsd: mediaManager.usage.estimatedCostUsd,
    },
    technicalEvents: [mediaManagerEvent, imageEvent],
  };
}
