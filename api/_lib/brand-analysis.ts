import { estimateTerraCostUsd, type OpenAITextUsage } from "./openai-text.js";

export type WebsiteVisualHints = {
  colors: string[];
  fontFamilies?: string[];
  socialLinks: Record<string, string>;
  logoUrl: string | null;
  logoCandidates?: string[];
  imageUrls?: string[];
  stylesheetUrls?: string[];
  pageSignals?: Array<{
    url: string;
    canonicalUrl: string | null;
    headings: string[];
    imageUrls: string[];
    ogImageUrl: string | null;
    schemaTypes: string[];
  }>;
};

export type BrandAnalysisInput = {
  apiKey: string;
  profileName: string;
  websiteUrl: string | null;
  industry: string | null;
  pages: Array<{ url: string; title: string | null; text: string }>;
  visualHints: WebsiteVisualHints;
  fetcher?: typeof fetch;
};

export type BrandAnalysis = {
  industry: string | null;
  description: string | null;
  businessModel: string | null;
  location: string | null;
  serviceArea: string | null;
  targetAudience: { summary: string; segments: string[] };
  toneOfVoice: { summary: string; traits: string[] };
  services: string[];
  differentiators: string[];
  valuePropositions: string[];
  goals: string[];
  contentPillars: Array<{ name: string; description: string; sourceUrls: string[] }>;
  visualStyleSummary: string;
  pageInsights: Array<{
    url: string;
    summary: string;
    topics: string[];
    pageType: string;
    intent: string;
    servicesMentioned: string[];
  }>;
};

export type BrandAnalysisResult = {
  analysis: BrandAnalysis;
  model: string;
  responseId: string;
  requestId: string | null;
  usage: OpenAITextUsage;
};

const MODEL = "gpt-5.6-terra";
const MAX_CONTEXT_CHARS = 110_000;
const MAX_PAGE_CHARS = 2_800;
const MAX_PAGES = 80;
const MAX_OUTPUT_TOKENS = 8_000;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    industry: { type: ["string", "null"] },
    description: { type: ["string", "null"] },
    businessModel: { type: ["string", "null"] },
    location: { type: ["string", "null"] },
    serviceArea: { type: ["string", "null"] },
    targetAudience: {
      type: "object",
      additionalProperties: false,
      properties: { summary: { type: "string" }, segments: { type: "array", items: { type: "string" }, maxItems: 8 } },
      required: ["summary", "segments"],
    },
    toneOfVoice: {
      type: "object",
      additionalProperties: false,
      properties: { summary: { type: "string" }, traits: { type: "array", items: { type: "string" }, maxItems: 8 } },
      required: ["summary", "traits"],
    },
    services: { type: "array", items: { type: "string" }, maxItems: 20 },
    differentiators: { type: "array", items: { type: "string" }, maxItems: 14 },
    valuePropositions: { type: "array", items: { type: "string" }, maxItems: 14 },
    goals: { type: "array", items: { type: "string" }, maxItems: 8 },
    contentPillars: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          sourceUrls: { type: "array", items: { type: "string" }, maxItems: 12 },
        },
        required: ["name", "description", "sourceUrls"],
      },
    },
    visualStyleSummary: { type: "string" },
    pageInsights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          url: { type: "string" },
          summary: { type: "string" },
          topics: { type: "array", items: { type: "string" }, maxItems: 10 },
          pageType: { type: "string" },
          intent: { type: "string" },
          servicesMentioned: { type: "array", items: { type: "string" }, maxItems: 10 },
        },
        required: ["url", "summary", "topics", "pageType", "intent", "servicesMentioned"],
      },
    },
  },
  required: ["industry", "description", "businessModel", "location", "serviceArea", "targetAudience", "toneOfVoice", "services", "differentiators", "valuePropositions", "goals", "contentPillars", "visualStyleSummary", "pageInsights"],
} as const;

function compactPages(pages: BrandAnalysisInput["pages"]) {
  const chunks: string[] = [];
  let used = 0;
  for (const page of pages.slice(0, MAX_PAGES)) {
    const text = page.text.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_CHARS);
    if (!text) continue;
    const chunk = `URL: ${page.url}\nTITLE: ${page.title ?? ""}\nCONTENT: ${text}`;
    if (used + chunk.length > MAX_CONTEXT_CHARS) break;
    chunks.push(chunk);
    used += chunk.length;
  }
  return chunks.join("\n\n--- PAGE ---\n\n");
}

function extractOutputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  const pieces: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : [];
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") pieces.push((part as { text: string }).text);
    }
  }
  return pieces.join("\n").trim();
}

function validate(value: unknown): BrandAnalysis {
  if (!value || typeof value !== "object") throw new Error("OPENAI_INVALID_BRAND_ANALYSIS");
  const candidate = value as Partial<BrandAnalysis>;
  if (!candidate.targetAudience || !candidate.toneOfVoice || !Array.isArray(candidate.pageInsights) || !Array.isArray(candidate.contentPillars)) throw new Error("OPENAI_INVALID_BRAND_SCHEMA");
  return candidate as BrandAnalysis;
}

export async function analyzeBrandFromWebsite(options: BrandAnalysisInput): Promise<BrandAnalysisResult> {
  const fetcher = options.fetcher ?? fetch;
  const pagesContext = compactPages(options.pages);
  if (!pagesContext) throw new Error("WEBSITE_PAGES_REQUIRED");

  const instructions = [
    "Sei il motore di onboarding e brand intelligence di Post Automatici.",
    "Analizza il sito pagina per pagina: ogni pagina fornita è una fonte reale e deve essere compresa individualmente.",
    "Ricostruisci attività, modello di business, servizi, target, tono di voce, differenziatori, proposte di valore e obiettivi social plausibili.",
    "Costruisci contentPillars come tassonomia editoriale riutilizzabile: ogni pilastro deve essere specifico, distinto e collegato agli URL reali che lo supportano.",
    "Per pageInsights restituisci un elemento per ogni pagina inclusa nel contesto, mantenendo esattamente l'URL della fonte; classifica tipo pagina, intento, temi e servizi citati.",
    "Non inventare sedi, servizi, prezzi, risultati, certificazioni, clienti o claim non presenti nelle fonti.",
    "Se un dato non è verificabile, restituisci null o una lista vuota.",
    "Gli obiettivi devono essere suggerimenti operativi per la strategia social, non fatti attribuiti all'azienda.",
    "Per lo stile visivo usa anche gli indizi tecnici forniti: colori osservati, font, logo, immagini, CSS, headings, Open Graph e schema.org. Non dichiarare ufficiale ciò che è soltanto osservato.",
    "Restituisci esclusivamente l'output strutturato richiesto.",
  ].join("\n");

  const input = JSON.stringify({
    profile: { name: options.profileName, websiteUrl: options.websiteUrl, industryHint: options.industry },
    visualHints: options.visualHints,
    pages: pagesContext,
  });

  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      store: false,
      reasoning: { effort: "medium" },
      instructions,
      input,
      text: { verbosity: "medium", format: { type: "json_schema", name: "post_automatici_brand_analysis", strict: true, schema: OUTPUT_SCHEMA } },
      max_output_tokens: MAX_OUTPUT_TOKENS,
    }),
  });

  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) {
    let message = `OPENAI_HTTP_${response.status}`;
    try {
      const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } };
      message = parsed.error?.code || parsed.error?.message || message;
    } catch { /* keep status */ }
    throw new Error(message);
  }

  const body = JSON.parse(raw) as Record<string, unknown>;
  const outputText = extractOutputText(body);
  if (!outputText) throw new Error("OPENAI_EMPTY_BRAND_ANALYSIS");
  const analysis = validate(JSON.parse(outputText));
  const usageRaw = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const inputDetails = usageRaw.input_tokens_details && typeof usageRaw.input_tokens_details === "object" ? usageRaw.input_tokens_details as Record<string, unknown> : {};
  const inputTokens = typeof usageRaw.input_tokens === "number" ? usageRaw.input_tokens : null;
  const outputTokens = typeof usageRaw.output_tokens === "number" ? usageRaw.output_tokens : null;
  const cachedInputTokens = typeof inputDetails.cached_tokens === "number" ? inputDetails.cached_tokens : 0;
  const cacheWriteTokens = typeof inputDetails.cache_write_tokens === "number" ? inputDetails.cache_write_tokens : 0;

  return {
    analysis,
    model: typeof body.model === "string" ? body.model : MODEL,
    responseId: typeof body.id === "string" ? body.id : "",
    requestId,
    usage: {
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
      totalTokens: typeof usageRaw.total_tokens === "number" ? usageRaw.total_tokens : null,
      webSearchCalls: 0,
      estimatedCostUsd: inputTokens !== null && outputTokens !== null ? estimateTerraCostUsd(inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens) : null,
    },
  };
}