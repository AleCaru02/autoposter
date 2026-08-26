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

export type OpenAITextResult = {
  content: GeneratedSocialContent;
  responseId: string;
  model: string;
  requestId: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
};

type GenerateOptions = {
  apiKey: string;
  topic: string;
  objective?: string | null;
  providers: SocialProvider[];
  formats: SocialFormat[];
  brand: BrandContext;
  fetcher?: typeof fetch;
  model?: string;
};

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

function compactWebsiteContext(pages: BrandContext["confirmedWebsiteContent"]) {
  const chunks: string[] = [];
  let used = 0;
  for (const page of pages) {
    const text = page.text.replace(/\s+/g, " ").trim().slice(0, 8_000);
    if (!text) continue;
    const chunk = `SOURCE ${page.url}\nTITLE: ${page.title ?? ""}\nCONTENT: ${text}`;
    if (used + chunk.length > 48_000) break;
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

function validateResult(value: unknown): GeneratedSocialContent {
  if (!value || typeof value !== "object") throw new Error("OPENAI_INVALID_JSON");
  const candidate = value as Partial<GeneratedSocialContent>;
  if (typeof candidate.strategySummary !== "string" || !Array.isArray(candidate.variants) || candidate.variants.length === 0) throw new Error("OPENAI_INVALID_SCHEMA");
  return candidate as GeneratedSocialContent;
}

export async function generateSocialText(options: GenerateOptions): Promise<OpenAITextResult> {
  const fetcher = options.fetcher ?? fetch;
  const model = options.model ?? "gpt-5.6-terra";
  const websiteContext = compactWebsiteContext(options.brand.confirmedWebsiteContent);
  const instructions = [
    "Sei il motore editoriale di Post Automatici.",
    "Genera contenuti social distinti per piattaforma e formato, mantenendo il tono del brand.",
    "Regola critica: non inventare prezzi, servizi, risultati, sedi, certificazioni, numeri o fatti. Usa come fatti solo i dati brand forniti e il contenuto sito esplicitamente incluso come fonte confermata.",
    "Se il contesto non supporta un claim, omettilo. factualBasis deve elencare brevemente quali elementi confermati sostengono la variante.",
    "Adatta davvero il copy a Instagram, Facebook, LinkedIn e Google Business Profile: non fare semplice copia-incolla cross-platform.",
    "Per GBP imposta eligible=false quando il concept non ha utilità locale/aziendale coerente.",
    "Per le storie scrivi copy breve; per i caroselli il caption deve indicare chiaramente una sequenza di slide; per i post usa una struttura completa ma non prolissa.",
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
      reasoning: { effort: "low" },
      instructions,
      input: userContext,
      text: { verbosity: "medium", format: { type: "json_schema", name: "post_automatici_social_content", strict: true, schema: OUTPUT_SCHEMA } },
      max_output_tokens: 8_000,
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
  const content = validateResult(JSON.parse(outputText));
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  return {
    content,
    responseId: typeof body.id === "string" ? body.id : "",
    model: typeof body.model === "string" ? body.model : model,
    requestId,
    usage: {
      inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
      outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
      totalTokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
    },
  };
}
