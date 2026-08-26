export type SocialProvider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";
export type SocialFormat = "POST" | "CAROUSEL" | "STORY";

export type BrandContext = {
  profileName: string;
  industry: string | null;
  websiteUrl: string | null;
  description: string | null;
  businessModel: string | null;
  location: string | null;
  serviceArea: string | null;
  target: string | null;
  tone: string | null;
  goals: string[];
  confirmedWebsiteContent: Array<{ url: string; title: string | null; text: string }>;
};

export type GeneratedVariant = {
  provider: SocialProvider;
  format: SocialFormat;
  eligible: boolean;
  hook: string;
  caption: string;
  cta: string | null;
  hashtags: string[];
  visualBrief: string;
  altText: string;
  factualBasis: string[];
};

export type GeneratedSocialContent = {
  strategySummary: string;
  variants: GeneratedVariant[];
};

export type OpenAITextUsage = {
  inputTokens: number | null;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
};

export type OpenAITextResult = {
  content: GeneratedSocialContent;
  responseId: string;
  model: string;
  requestId: string | null;
  usage: OpenAITextUsage;
};

export type GenerateOptions = {
  apiKey: string;
  topic: string;
  objective?: string | null;
  providers: SocialProvider[];
  formats: SocialFormat[];
  brand: BrandContext;
  fetcher?: typeof fetch;
  model?: string;
  cacheKey?: string;
};

const TERRA_INPUT_PER_MILLION_USD = 2;
const TERRA_CACHED_INPUT_PER_MILLION_USD = 0.2;
const TERRA_CACHE_WRITE_PER_MILLION_USD = 2.5;
const TERRA_OUTPUT_PER_MILLION_USD = 12;
export const MAX_TEXT_OUTPUT_TOKENS = 5_000;
const MAX_WEBSITE_CONTEXT_CHARS = 40_000;
const MAX_PAGE_CONTEXT_CHARS = 6_000;
const MAX_RELEVANT_PAGES = 8;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    strategySummary: { type: "string" },
    variants: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          provider: { type: "string", enum: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"] },
          format: { type: "string", enum: ["POST", "CAROUSEL", "STORY"] },
          eligible: { type: "boolean" },
          hook: { type: "string" },
          caption: { type: "string" },
          cta: { type: ["string", "null"] },
          hashtags: { type: "array", items: { type: "string" }, maxItems: 15 },
          visualBrief: { type: "string" },
          altText: { type: "string" },
          factualBasis: { type: "array", items: { type: "string" }, maxItems: 12 },
        },
        required: ["provider", "format", "eligible", "hook", "caption", "cta", "hashtags", "visualBrief", "altText", "factualBasis"],
      },
    },
  },
  required: ["strategySummary", "variants"],
} as const;

function terms(value: string) {
  return new Set(value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((term) => term.length >= 3));
}

function scorePage(page: BrandContext["confirmedWebsiteContent"][number], queryTerms: Set<string>) {
  const titleTerms = terms(page.title ?? "");
  const urlTerms = terms(new URL(page.url).pathname);
  const bodyTerms = terms(page.text.slice(0, 12_000));
  let score = 0;
  for (const term of queryTerms) {
    if (titleTerms.has(term)) score += 6;
    if (urlTerms.has(term)) score += 4;
    if (bodyTerms.has(term)) score += 1;
  }
  if (new URL(page.url).pathname === "/") score += 2;
  return score;
}

export function selectRelevantWebsiteContent(topic: string, pages: BrandContext["confirmedWebsiteContent"]) {
  const queryTerms = terms(topic);
  return pages
    .map((page, index) => ({ page, index, score: scorePage(page, queryTerms) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_RELEVANT_PAGES)
    .map(({ page }) => page);
}

function compactWebsiteContext(topic: string, pages: BrandContext["confirmedWebsiteContent"]) {
  const chunks: string[] = [];
  let used = 0;
  for (const page of selectRelevantWebsiteContent(topic, pages)) {
    const text = page.text.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_CONTEXT_CHARS);
    if (!text) continue;
    const chunk = `SOURCE ${page.url}\nTITLE: ${page.title ?? ""}\nCONTENT: ${text}`;
    if (used + chunk.length > MAX_WEBSITE_CONTEXT_CHARS) break;
    chunks.push(chunk);
    used += chunk.length;
  }
  return chunks.join("\n\n");
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

function validateResult(value: unknown, providers: SocialProvider[], formats: SocialFormat[]): GeneratedSocialContent {
  if (!value || typeof value !== "object") throw new Error("OPENAI_INVALID_JSON");
  const candidate = value as Partial<GeneratedSocialContent>;
  if (typeof candidate.strategySummary !== "string" || !Array.isArray(candidate.variants) || candidate.variants.length === 0) throw new Error("OPENAI_INVALID_SCHEMA");
  const variants = candidate.variants as GeneratedVariant[];
  const keys = new Set(variants.map((variant) => `${variant.provider}:${variant.format}`));
  for (const provider of providers) {
    for (const format of formats) {
      if (!keys.has(`${provider}:${format}`)) throw new Error("OPENAI_INCOMPLETE_VARIANTS");
    }
  }
  if (keys.size !== variants.length) throw new Error("OPENAI_DUPLICATE_VARIANTS");
  return candidate as GeneratedSocialContent;
}

export function estimateTerraCostUsd(inputTokens: number, outputTokens: number, cachedInputTokens = 0, cacheWriteTokens = 0) {
  const safeCached = Math.min(Math.max(cachedInputTokens, 0), inputTokens);
  const safeWrite = Math.min(Math.max(cacheWriteTokens, 0), Math.max(inputTokens - safeCached, 0));
  const uncachedInput = Math.max(inputTokens - safeCached - safeWrite, 0);
  return (uncachedInput * TERRA_INPUT_PER_MILLION_USD + safeCached * TERRA_CACHED_INPUT_PER_MILLION_USD + safeWrite * TERRA_CACHE_WRITE_PER_MILLION_USD + Math.max(outputTokens, 0) * TERRA_OUTPUT_PER_MILLION_USD) / 1_000_000;
}

export function estimateTextRequestUpperBoundUsd(options: Pick<GenerateOptions, "topic" | "objective" | "providers" | "formats" | "brand">) {
  const selected = compactWebsiteContext(options.topic, options.brand.confirmedWebsiteContent);
  const approximateInputChars = selected.length + options.topic.length + (options.objective?.length ?? 0) + JSON.stringify(options.brand).length + 6_000;
  const approximateInputTokens = Math.ceil(approximateInputChars / 3.5);
  return estimateTerraCostUsd(approximateInputTokens, MAX_TEXT_OUTPUT_TOKENS);
}

export async function generateSocialText(options: GenerateOptions): Promise<OpenAITextResult> {
  const fetcher = options.fetcher ?? fetch;
  const model = options.model ?? "gpt-5.6-terra";
  if (model !== "gpt-5.6-terra") throw new Error("OPENAI_TEXT_MODEL_NOT_ALLOWED");
  const websiteContext = compactWebsiteContext(options.topic, options.brand.confirmedWebsiteContent);
  const instructions = [
    "Sei il motore editoriale di Post Automatici.",
    "Genera contenuti social distinti per piattaforma e formato, mantenendo il tono del brand e una qualità professionale pronta per revisione umana.",
    "Regola critica: non inventare prezzi, servizi, risultati, sedi, certificazioni, numeri o fatti. Usa come fatti solo i dati brand forniti e il contenuto sito esplicitamente incluso come fonte confermata.",
    "Se il contesto non supporta un claim, omettilo. factualBasis deve elencare brevemente quali elementi confermati sostengono la variante.",
    "Adatta davvero il copy a Instagram, Facebook, LinkedIn e Google Business Profile: non fare semplice copia-incolla cross-platform.",
    "Produci esattamente una variante per ogni combinazione piattaforma/formato richiesta, senza duplicati.",
    "Per GBP imposta eligible=false quando il concept non ha utilità locale/aziendale coerente.",
    "Per le storie scrivi copy breve; per i caroselli il caption deve indicare chiaramente una sequenza di slide; per i post usa una struttura completa ma non prolissa.",
    "La qualità viene prima della brevità: elimina solo ridondanze e testo non utile, non dettagli sostanziali.",
    "Restituisci esclusivamente l'output strutturato richiesto.",
  ].join("\n");
  const userContext = JSON.stringify({
    task: { topic: options.topic, objective: options.objective ?? null, providers: options.providers, formats: options.formats },
    brand: {
      name: options.brand.profileName,
      industry: options.brand.industry,
      websiteUrl: options.brand.websiteUrl,
      description: options.brand.description,
      businessModel: options.brand.businessModel,
      location: options.brand.location,
      serviceArea: options.brand.serviceArea,
      target: options.brand.target,
      tone: options.brand.tone,
      goals: options.brand.goals,
    },
    confirmedWebsiteSources: websiteContext || "NESSUNA PAGINA SITO CONFERMATA DISPONIBILE",
  });

  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "medium" },
      instructions,
      input: userContext,
      prompt_cache_key: options.cacheKey || undefined,
      text: { verbosity: "medium", format: { type: "json_schema", name: "post_automatici_social_content", strict: true, schema: OUTPUT_SCHEMA } },
      max_output_tokens: MAX_TEXT_OUTPUT_TOKENS,
    }),
  });
  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) {
    let message = `OPENAI_HTTP_${response.status}`;
    try {
      const parsed = JSON.parse(raw) as { error?: { code?: string; message?: string } };
      message = parsed.error?.code || parsed.error?.message || message;
    } catch { /* keep generic status */ }
    throw new Error(message);
  }
  const body = JSON.parse(raw) as Record<string, unknown>;
  const outputText = extractOutputText(body);
  if (!outputText) throw new Error("OPENAI_EMPTY_OUTPUT");
  const content = validateResult(JSON.parse(outputText), options.providers, options.formats);
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === "object" ? usage.input_tokens_details as Record<string, unknown> : {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : null;
  const cachedInputTokens = typeof inputDetails.cached_tokens === "number" ? inputDetails.cached_tokens : 0;
  const cacheWriteTokens = typeof inputDetails.cache_write_tokens === "number" ? inputDetails.cache_write_tokens : 0;
  const estimatedCostUsd = inputTokens !== null && outputTokens !== null ? estimateTerraCostUsd(inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens) : null;
  return {
    content,
    responseId: typeof body.id === "string" ? body.id : "",
    model: typeof body.model === "string" ? body.model : model,
    requestId,
    usage: {
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
      totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
      estimatedCostUsd,
    },
  };
}
