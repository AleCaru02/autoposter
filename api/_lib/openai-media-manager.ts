import { estimateTerraCostUsd } from "./openai-text.js";
import type { ImageSocialFormat, ImageSocialProvider } from "./openai-image.js";

export type MediaManagerResult = {
  visualIntent: string;
  composition: string;
  subject: string;
  environment: string;
  style: string;
  imagePrompt: string;
  altText: string;
  avoid: string[];
  responseId: string;
  requestId: string | null;
  model: "gpt-5.6-terra";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
};

const MEDIA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    visualIntent: { type: "string", minLength: 3, maxLength: 300 },
    composition: { type: "string", minLength: 3, maxLength: 500 },
    subject: { type: "string", minLength: 3, maxLength: 500 },
    environment: { type: "string", minLength: 3, maxLength: 500 },
    style: { type: "string", minLength: 3, maxLength: 500 },
    imagePrompt: { type: "string", minLength: 20, maxLength: 2500 },
    altText: { type: "string", minLength: 3, maxLength: 500 },
    avoid: { type: "array", maxItems: 12, items: { type: "string", maxLength: 200 } },
  },
  required: ["visualIntent", "composition", "subject", "environment", "style", "imagePrompt", "altText", "avoid"],
} as const;

function outputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  const pieces: string[] = [];
  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (!item || typeof item !== "object") continue;
    for (const part of Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : []) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") pieces.push((part as { text: string }).text);
    }
  }
  return pieces.join("\n").trim();
}

function n(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

export async function runOpenAIMediaManager(input: {
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
}): Promise<MediaManagerResult> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "Sei il Media Manager e Visual Director di Post Automatici.",
        "Trasforma il brief editoriale già approvato in una direzione visuale pronta per OpenAI Immagini 2.",
        "Non inventare sedi, persone reali, prodotti, risultati, certificazioni, prezzi, loghi o caratteristiche specifiche del brand che non siano presenti nel contesto.",
        "Non usare ricerca web. Non scrivere copy social: occupati soltanto del visual.",
        "Adatta composizione e densità alla piattaforma e al formato. Per STORY privilegia una composizione verticale leggibile su smartphone; per POST/CAROUSEL una composizione quadrata forte e pulita.",
        "Evita testo incorporato nell'immagine salvo richiesta esplicita; evita watermark, marchi di terzi e claim visivi non verificati.",
        "imagePrompt deve essere autosufficiente, concreto, visuale e pronto per gpt-image-2.",
        "Restituisci esclusivamente JSON conforme allo schema.",
      ].join("\n"),
      input: JSON.stringify({
        brand: { name: input.profileName, industry: input.industry, tone: input.tone },
        placement: { provider: input.provider, format: input.format },
        visualBrief: input.visualBrief,
        captionContext: input.caption ?? null,
        additionalDirection: input.additionalDirection ?? null,
      }),
      text: { verbosity: "low", format: { type: "json_schema", name: "post_automatici_media_manager", strict: true, schema: MEDIA_SCHEMA } },
      max_output_tokens: 1400,
    }),
  });
  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) throw new Error(`OPENAI_MEDIA_MANAGER_HTTP_${response.status}`);
  const body = JSON.parse(raw) as Record<string, unknown>;
  const text = outputText(body);
  if (!text) throw new Error("OPENAI_MEDIA_MANAGER_EMPTY_OUTPUT");
  const parsed = JSON.parse(text) as Omit<MediaManagerResult, "responseId" | "requestId" | "model" | "usage">;
  const rawUsage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const inputTokens = n(rawUsage.input_tokens);
  const outputTokens = n(rawUsage.output_tokens);
  return {
    ...parsed,
    responseId: typeof body.id === "string" ? body.id : "",
    requestId,
    model: "gpt-5.6-terra",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: n(rawUsage.total_tokens) || inputTokens + outputTokens,
      estimatedCostUsd: estimateTerraCostUsd(inputTokens, outputTokens),
    },
  };
}
