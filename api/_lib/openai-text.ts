import { buildSectorResearchInstruction, type EditorialResearchMode } from "./editorial-research.js";
import { contentNeedsFactCheck, runOpenAIFactCheckAgent, runOpenAIResearchAgent, shouldRunResearchAgent, type ResearchAgentResult } from "./openai-research-factcheck.js";

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
  editorialTopic: string;
  editorialAngle: string;
  strategySummary: string;
  variants: GeneratedVariant[];
};

export type OpenAITextUsage = {
  inputTokens: number | null;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number | null;
  totalTokens: number | null;
  webSearchCalls: number;
  estimatedCostUsd: number | null;
};

export type OpenAITextTechnicalEvent = {
  operation: "GENERATE_SOCIAL_TEXT" | "AGENT_RESEARCH" | "AGENT_FACTCHECK";
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  metadata: Record<string, unknown>;
};

export class OpenAITextPipelineError extends Error {
  constructor(message: string, public readonly technicalEvents: OpenAITextTechnicalEvent[]) {
    super(message);
    this.name = "OpenAITextPipelineError";
  }
}

export type OpenAITextResult = {
  content: GeneratedSocialContent;
  responseId: string;
  model: string;
  requestId: string | null;
  researchMode: EditorialResearchMode;
  externalSources: string[];
  verification: {
    researchAgentRan: boolean;
    factCheckAgentRan: boolean;
    factCheckVerdict: "PASS" | null;
  };
  usage: OpenAITextUsage;
  technicalEvents: OpenAITextTechnicalEvent[];
};

export type GenerateOptions = {
  apiKey: string;
  topic: string;
  objective?: string | null;
  providers: SocialProvider[];
  formats: SocialFormat[];
  brand: BrandContext;
  researchMode?: EditorialResearchMode;
  fetcher?: typeof fetch;
  model?: string;
  cacheKey?: string;
};

const TERRA_INPUT_PER_MILLION_USD = 2;
const TERRA_CACHED_INPUT_PER_MILLION_USD = 0.2;
const TERRA_CACHE_WRITE_PER_MILLION_USD = 2.5;
const TERRA_OUTPUT_PER_MILLION_USD = 12;
const WEB_SEARCH_PER_RUN_USD = 0.01;
export const MAX_TEXT_OUTPUT_TOKENS = 5_000;
const MAX_WEBSITE_CONTEXT_CHARS = 40_000;
const MAX_PAGE_CONTEXT_CHARS = 6_000;
const MAX_RELEVANT_PAGES = 8;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    editorialTopic: { type: "string", minLength: 3, maxLength: 120 },
    editorialAngle: { type: "string", minLength: 3, maxLength: 180 },
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
  required: ["editorialTopic", "editorialAngle", "strategySummary", "variants"],
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

export function countWebSearchCalls(body: Record<string, unknown>) {
  const output = Array.isArray(body.output) ? body.output : [];
  return output.filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "web_search_call").length;
}

export function extractWebSearchSources(body: Record<string, unknown>) {
  const output = Array.isArray(body.output) ? body.output : [];
  const urls = new Set<string>();
  for (const item of output) {
    if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "web_search_call") continue;
    const action = (item as { action?: unknown }).action;
    if (!action || typeof action !== "object") continue;
    const sourceList = Array.isArray((action as { sources?: unknown }).sources) ? (action as { sources: unknown[] }).sources : [];
    for (const source of sourceList) {
      if (!source || typeof source !== "object" || typeof (source as { url?: unknown }).url !== "string") continue;
      try {
        const url = new URL((source as { url: string }).url);
        if (url.protocol === "https:" || url.protocol === "http:") urls.add(url.toString());
      } catch { /* ignore invalid provider source URLs */ }
    }
  }
  return [...urls].slice(0, 20);
}

function validateResult(value: unknown, providers: SocialProvider[], formats: SocialFormat[]): GeneratedSocialContent {
  if (!value || typeof value !== "object") throw new Error("OPENAI_INVALID_JSON");
  const candidate = value as Partial<GeneratedSocialContent>;
  if (typeof candidate.editorialTopic !== "string" || !candidate.editorialTopic.trim() || typeof candidate.editorialAngle !== "string" || !candidate.editorialAngle.trim() || typeof candidate.strategySummary !== "string" || !Array.isArray(candidate.variants) || candidate.variants.length === 0) throw new Error("OPENAI_INVALID_SCHEMA");
  const variants = candidate.variants as GeneratedVariant[];
  const keys = new Set(variants.map((variant) => `${variant.provider}:${variant.format}`));
  for (const provider of providers) {
    for (const format of formats) {
      if (!keys.has(`${provider}:${format}`)) throw new Error("OPENAI_INCOMPLETE_VARIANTS");
    }
  }
  if (keys.size !== variants.length) throw new Error("OPENAI_DUPLICATE_VARIANTS");
  return { ...candidate, editorialTopic: candidate.editorialTopic.trim(), editorialAngle: candidate.editorialAngle.trim() } as GeneratedSocialContent;
}

export function estimateTerraCostUsd(inputTokens: number, outputTokens: number, cachedInputTokens = 0, cacheWriteTokens = 0) {
  const safeCached = Math.min(Math.max(cachedInputTokens, 0), inputTokens);
  const safeWrite = Math.min(Math.max(cacheWriteTokens, 0), Math.max(inputTokens - safeCached, 0));
  const uncachedInput = Math.max(inputTokens - safeCached - safeWrite, 0);
  return (uncachedInput * TERRA_INPUT_PER_MILLION_USD + safeCached * TERRA_CACHED_INPUT_PER_MILLION_USD + safeWrite * TERRA_CACHE_WRITE_PER_MILLION_USD + Math.max(outputTokens, 0) * TERRA_OUTPUT_PER_MILLION_USD) / 1_000_000;
}

export function estimateTextRequestUpperBoundUsd(options: Pick<GenerateOptions, "topic" | "objective" | "providers" | "formats" | "brand" | "researchMode">) {
  const selected = compactWebsiteContext(options.topic, options.brand.confirmedWebsiteContent);
  const approximateInputChars = selected.length + options.topic.length + (options.objective?.length ?? 0) + JSON.stringify(options.brand).length + 7_000;
  const approximateInputTokens = Math.ceil(approximateInputChars / 3.5);
  const research = buildSectorResearchInstruction({ industry: options.brand.industry, description: options.brand.description, businessModel: options.brand.businessModel, target: options.brand.target, mode: options.researchMode ?? "BALANCED" });
  const agentReserve = research.mode === "NEWS" ? estimateTerraCostUsd(6_000, 2_400) * 2 : 0;
  return estimateTerraCostUsd(approximateInputTokens, MAX_TEXT_OUTPUT_TOKENS) + (research.useWebSearch ? WEB_SEARCH_PER_RUN_USD : 0) + agentReserve;
}

function agentCost(result: ResearchAgentResult | { usage: { inputTokens: number; outputTokens: number; webSearchCalls: number } } | null) {
  if (!result) return 0;
  return estimateTerraCostUsd(result.usage.inputTokens, result.usage.outputTokens) + result.usage.webSearchCalls * WEB_SEARCH_PER_RUN_USD;
}

export async function generateSocialText(options: GenerateOptions): Promise<OpenAITextResult> {
  const fetcher = options.fetcher ?? fetch;
  const model = options.model ?? "gpt-5.6-terra";
  if (model !== "gpt-5.6-terra") throw new Error("OPENAI_TEXT_MODEL_NOT_ALLOWED");
  const websiteContext = compactWebsiteContext(options.topic, options.brand.confirmedWebsiteContent);
  const research = buildSectorResearchInstruction({
    industry: options.brand.industry,
    description: options.brand.description,
    businessModel: options.brand.businessModel,
    target: options.brand.target,
    mode: options.researchMode ?? "BALANCED",
  });

  let dedicatedResearch: ResearchAgentResult | null = null;
  if (shouldRunResearchAgent(research.mode)) {
    dedicatedResearch = await runOpenAIResearchAgent({
      apiKey: options.apiKey,
      topic: options.topic,
      industry: options.brand.industry,
      businessDescription: options.brand.description,
      target: options.brand.target,
      freshnessDays: research.freshnessDays,
      fetcher,
    });
    if (dedicatedResearch.status !== "READY" || !dedicatedResearch.sources.length) {
      const researchCostUsd = agentCost(dedicatedResearch);
      throw new OpenAITextPipelineError("OPENAI_RESEARCH_BLOCKED", [{
        operation: "AGENT_RESEARCH",
        model: dedicatedResearch.model,
        inputTokens: dedicatedResearch.usage.inputTokens,
        outputTokens: dedicatedResearch.usage.outputTokens,
        costUsd: researchCostUsd,
        metadata: {
          openai_response_id: dedicatedResearch.responseId,
          openai_request_id: dedicatedResearch.requestId,
          web_search_calls: dedicatedResearch.usage.webSearchCalls,
          sources: dedicatedResearch.sources,
          status: dedicatedResearch.status,
        },
      }]);
    }
  }

  const copyUsesWebSearch = research.useWebSearch && !dedicatedResearch;
  const instructions = [
    "Sei il motore editoriale di Post Automatici.",
    "Genera contenuti social distinti per piattaforma e formato, mantenendo il tono del brand e una qualità professionale pronta per revisione umana.",
    research.instruction,
    dedicatedResearch ? "Il Research Agent ha già raccolto le evidenze esterne. Usa soltanto quelle evidenze per i fatti esterni e non avviare una seconda ricerca web nel copy." : "",
    "Regola critica sui fatti del brand: non inventare prezzi, servizi, risultati, sedi, certificazioni, numeri o dichiarazioni dell'attività. Per questi claim usa solo dati brand e contenuto sito esplicitamente incluso come fonte confermata.",
    copyUsesWebSearch ? "Per conoscenze di settore, consigli, dati generali, aggiornamenti e news puoi usare esclusivamente informazioni trovate tramite la ricerca web disponibile in questa richiesta. Se una fonte non è sufficientemente affidabile o pertinente, non usarla." : "Non introdurre fatti esterni diversi dalle evidenze esplicitamente fornite.",
    "Se il contesto non supporta un claim, omettilo. factualBasis deve distinguere sinteticamente BASE BRAND/SITO da BASE ESTERNA quando vengono usate informazioni web.",
    "Adatta davvero il copy a Instagram, Facebook, LinkedIn e Google Business Profile: non fare semplice copia-incolla cross-platform.",
    "Produci esattamente una variante per ogni combinazione piattaforma/formato richiesta, senza duplicati.",
    "editorialTopic deve essere il tema canonico e specifico del contenuto in 3-12 parole, senza istruzioni, piattaforme o formule promozionali.",
    "editorialAngle deve descrivere in modo conciso il punto di vista concreto usato per trattare quel tema; due copy sullo stesso tema ma con angoli realmente diversi devono avere angoli diversi.",
    "Non usare in editorialTopic o editorialAngle frasi come 'scegli', 'crea', 'evita di ripetere', 'contenuto destinato' o riferimenti alla richiesta tecnica.",
    "Per GBP imposta eligible=false quando il concept non ha utilità locale/aziendale coerente.",
    "Per le storie scrivi copy breve; per i caroselli il caption deve indicare chiaramente una sequenza di slide; per i post usa una struttura completa ma non prolissa.",
    "La qualità viene prima della brevità: elimina solo ridondanze e testo non utile, non dettagli sostanziali.",
    "Restituisci esclusivamente l'output strutturato richiesto.",
  ].filter(Boolean).join("\n");
  const userContext = JSON.stringify({
    task: { topic: options.topic, objective: options.objective ?? null, providers: options.providers, formats: options.formats, researchMode: research.mode, freshnessGuidanceDays: research.freshnessDays },
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
    researchAgentEvidence: dedicatedResearch ? { summary: dedicatedResearch.summary, evidence: dedicatedResearch.evidence, sources: dedicatedResearch.sources } : null,
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
      ...(copyUsesWebSearch ? { tools: [{ type: "web_search", search_context_size: "low" }], max_tool_calls: 1, include: ["web_search_call.action.sources"] } : {}),
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
  const mainInputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const mainOutputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : null;
  const cachedInputTokens = typeof inputDetails.cached_tokens === "number" ? inputDetails.cached_tokens : 0;
  const cacheWriteTokens = typeof inputDetails.cache_write_tokens === "number" ? inputDetails.cache_write_tokens : 0;
  const mainWebSearchCalls = countWebSearchCalls(body);
  const mainSources = copyUsesWebSearch ? extractWebSearchSources(body) : [];
  const combinedSources = [...new Set([...(dedicatedResearch?.sources ?? []), ...mainSources])].slice(0, 20);

  let factCheck = null as Awaited<ReturnType<typeof runOpenAIFactCheckAgent>> | null;
  if (contentNeedsFactCheck(content, research.mode)) {
    factCheck = await runOpenAIFactCheckAgent({
      apiKey: options.apiKey,
      topic: options.topic,
      content: { generated: content, confirmedWebsiteSources: websiteContext },
      research: dedicatedResearch,
      existingSources: combinedSources,
      allowWebSearch: research.useWebSearch && combinedSources.length === 0,
      fetcher,
    });
    // Persist technical cost before surfacing a blocking fact-check verdict.
  }

  const totalInputTokens = mainInputTokens === null ? null : mainInputTokens + (dedicatedResearch?.usage.inputTokens ?? 0) + (factCheck?.usage.inputTokens ?? 0);
  const totalOutputTokens = mainOutputTokens === null ? null : mainOutputTokens + (dedicatedResearch?.usage.outputTokens ?? 0) + (factCheck?.usage.outputTokens ?? 0);
  const webSearchCalls = mainWebSearchCalls + (dedicatedResearch?.usage.webSearchCalls ?? 0) + (factCheck?.usage.webSearchCalls ?? 0);
  const mainTokenCost = mainInputTokens !== null && mainOutputTokens !== null ? estimateTerraCostUsd(mainInputTokens, mainOutputTokens, cachedInputTokens, cacheWriteTokens) : null;
  const mainCostUsd = mainTokenCost === null ? null : mainTokenCost + mainWebSearchCalls * WEB_SEARCH_PER_RUN_USD;
  const researchCostUsd = dedicatedResearch ? agentCost(dedicatedResearch) : null;
  const factCheckCostUsd = factCheck ? agentCost(factCheck) : null;
  const estimatedCostUsd = mainCostUsd === null ? null : mainCostUsd + (researchCostUsd ?? 0) + (factCheckCostUsd ?? 0);
  const externalSources = [...new Set([...combinedSources, ...(factCheck?.sources ?? [])])].slice(0, 20);
  const technicalEvents: OpenAITextTechnicalEvent[] = [
    {
      operation: "GENERATE_SOCIAL_TEXT",
      model: typeof body.model === "string" ? body.model : model,
      inputTokens: mainInputTokens,
      outputTokens: mainOutputTokens,
      costUsd: mainCostUsd,
      metadata: {
        openai_response_id: typeof body.id === "string" ? body.id : "",
        openai_request_id: requestId,
        cached_input_tokens: cachedInputTokens,
        cache_write_tokens: cacheWriteTokens,
        web_search_calls: mainWebSearchCalls,
        research_mode: research.mode,
      },
    },
    ...(dedicatedResearch ? [{
      operation: "AGENT_RESEARCH" as const,
      model: dedicatedResearch.model,
      inputTokens: dedicatedResearch.usage.inputTokens,
      outputTokens: dedicatedResearch.usage.outputTokens,
      costUsd: researchCostUsd,
      metadata: {
        openai_response_id: dedicatedResearch.responseId,
        openai_request_id: dedicatedResearch.requestId,
        web_search_calls: dedicatedResearch.usage.webSearchCalls,
        sources: dedicatedResearch.sources,
      },
    }] : []),
    ...(factCheck ? [{
      operation: "AGENT_FACTCHECK" as const,
      model: factCheck.model,
      inputTokens: factCheck.usage.inputTokens,
      outputTokens: factCheck.usage.outputTokens,
      costUsd: factCheckCostUsd,
      metadata: {
        openai_response_id: factCheck.responseId,
        openai_request_id: factCheck.requestId,
        web_search_calls: factCheck.usage.webSearchCalls,
        verdict: factCheck.verdict,
        sources: factCheck.sources,
      },
    }] : []),
  ];

  if (factCheck && factCheck.verdict !== "PASS") {
    throw new OpenAITextPipelineError(`OPENAI_FACTCHECK_${factCheck.verdict}`, technicalEvents);
  }

  return {
    content,
    responseId: typeof body.id === "string" ? body.id : "",
    model: typeof body.model === "string" ? body.model : model,
    requestId,
    researchMode: research.mode,
    externalSources,
    verification: {
      researchAgentRan: Boolean(dedicatedResearch),
      factCheckAgentRan: Boolean(factCheck),
      factCheckVerdict: factCheck?.verdict === "PASS" ? "PASS" : null,
    },
    usage: {
      inputTokens: totalInputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens !== null && totalOutputTokens !== null ? totalInputTokens + totalOutputTokens : (typeof usage.total_tokens === "number" ? usage.total_tokens : null),
      webSearchCalls,
      estimatedCostUsd,
    },
    technicalEvents,
  };
}
