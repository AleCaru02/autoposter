import type { EditorialResearchMode } from "./editorial-research.js";

export type ResearchEvidence = {
  claim: string;
  evidenceSummary: string;
  sourceType: "PRIMARY" | "OFFICIAL" | "SECONDARY" | "UNKNOWN";
  datedAt: string | null;
  reliability: "HIGH" | "MEDIUM" | "LOW";
};

export type ResearchAgentResult = {
  status: "READY" | "BLOCKED";
  summary: string;
  evidence: ResearchEvidence[];
  sources: string[];
  responseId: string;
  requestId: string | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; webSearchCalls: number };
};

export type FactCheckClaim = {
  claim: string;
  claimType: "EXTERNAL" | "BRAND" | "INTERNAL" | "EDITORIAL";
  slideNumber: number | null;
  sourceRequired: boolean;
  status: "VERIFIED" | "UNSUPPORTED" | "CONTRADICTED" | "TIME_SENSITIVE" | "NOT_FACTUAL";
  reason: string;
};

export type FactCheckAgentResult = {
  verdict: "PASS" | "BLOCK" | "NEEDS_SOURCE";
  checkedClaims: FactCheckClaim[];
  sources: string[];
  responseId: string;
  requestId: string | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; webSearchCalls: number };
};

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["READY", "BLOCKED"] },
    summary: { type: "string" },
    evidence: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          evidenceSummary: { type: "string" },
          sourceType: { type: "string", enum: ["PRIMARY", "OFFICIAL", "SECONDARY", "UNKNOWN"] },
          datedAt: { type: ["string", "null"] },
          reliability: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        },
        required: ["claim", "evidenceSummary", "sourceType", "datedAt", "reliability"],
      },
    },
  },
  required: ["status", "summary", "evidence"],
} as const;

const FACTCHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["PASS", "BLOCK", "NEEDS_SOURCE"] },
    checkedClaims: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          claimType: { type: "string", enum: ["EXTERNAL", "BRAND", "INTERNAL", "EDITORIAL"] },
          slideNumber: { type: ["integer", "null"], minimum: 1, maximum: 10 },
          sourceRequired: { type: "boolean" },
          status: { type: "string", enum: ["VERIFIED", "UNSUPPORTED", "CONTRADICTED", "TIME_SENSITIVE", "NOT_FACTUAL"] },
          reason: { type: "string" },
        },
        required: ["claim", "claimType", "slideNumber", "sourceRequired", "status", "reason"],
      },
    },
  },
  required: ["verdict", "checkedClaims"],
} as const;

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

function sources(body: Record<string, unknown>) {
  const output = Array.isArray(body.output) ? body.output : [];
  const urls = new Set<string>();
  for (const item of output) {
    if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "web_search_call") continue;
    const action = (item as { action?: unknown }).action;
    if (!action || typeof action !== "object") continue;
    const candidates = Array.isArray((action as { sources?: unknown }).sources) ? (action as { sources: unknown[] }).sources : [];
    for (const candidate of candidates) {
      const value = candidate && typeof candidate === "object" ? (candidate as { url?: unknown }).url : null;
      if (typeof value !== "string") continue;
      try {
        const url = new URL(value);
        if (url.protocol === "http:" || url.protocol === "https:") urls.add(url.toString());
      } catch { /* ignore invalid provider URLs */ }
    }
  }
  return [...urls].slice(0, 20);
}

function usage(body: Record<string, unknown>) {
  const raw = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const output = Array.isArray(body.output) ? body.output : [];
  return {
    inputTokens: typeof raw.input_tokens === "number" ? raw.input_tokens : 0,
    outputTokens: typeof raw.output_tokens === "number" ? raw.output_tokens : 0,
    totalTokens: typeof raw.total_tokens === "number" ? raw.total_tokens : 0,
    webSearchCalls: output.filter((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "web_search_call").length,
  };
}

async function callStructured(input: {
  apiKey: string;
  instructions: string;
  payload: unknown;
  schema: typeof RESEARCH_SCHEMA | typeof FACTCHECK_SCHEMA;
  schemaName: string;
  useWebSearch: boolean;
  requireWebSearch?: boolean;
  fetcher?: typeof fetch;
}) {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "medium" },
      instructions: input.instructions,
      input: JSON.stringify(input.payload),
      ...(input.useWebSearch ? {
        tools: [{ type: "web_search", search_context_size: "low" }],
        max_tool_calls: 1,
        include: ["web_search_call.action.sources"],
        ...(input.requireWebSearch ? { tool_choice: "required" } : {}),
      } : {}),
      text: { verbosity: "low", format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } },
      max_output_tokens: 2400,
    }),
  });
  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) throw new Error(`OPENAI_AGENT_HTTP_${response.status}`);
  const body = JSON.parse(raw) as Record<string, unknown>;
  const output = extractOutputText(body);
  if (!output) throw new Error("OPENAI_AGENT_EMPTY_OUTPUT");
  return { parsed: JSON.parse(output) as Record<string, unknown>, body, requestId };
}

export function shouldRunResearchAgent(mode: EditorialResearchMode) {
  return mode === "NEWS";
}

export function contentNeedsFactCheck(content: unknown, mode: EditorialResearchMode) {
  if (mode === "NEWS") return true;
  const text = JSON.stringify(content ?? "").replace(/\b\d+\s+(?:consigli|passi|idee|errori|modi|motivi|strategie|azioni|domande|suggerimenti|slide)\b/gi, "");
  return /\b\d+(?:[.,]\d+)?\s*(?:%|€|eur|euro|usd|km|kg|ore|giorni|anni)?\b|\b(?:legge|norma|regolamento|obbligo|scadenza|dal\s+\d|entro\s+il|202\d)\b/i.test(text);
}

export async function runOpenAIResearchAgent(input: {
  apiKey: string;
  topic: string;
  industry: string | null;
  businessDescription: string | null;
  target: string | null;
  freshnessDays: number | null;
  fetcher?: typeof fetch;
}): Promise<ResearchAgentResult> {
  const result = await callStructured({
    apiKey: input.apiKey,
    fetcher: input.fetcher,
    useWebSearch: true,
    schema: RESEARCH_SCHEMA,
    schemaName: "post_automatici_research_agent",
    instructions: [
      "Sei il Research Agent di Post Automatici.",
      "Raccogli soltanto evidenze utili al tema richiesto usando al massimo una ricerca web.",
      "Preferisci fonti primarie e ufficiali. Per news e dati correnti verifica data e freschezza.",
      "Non trasformare mai informazioni generali di settore in fatti specifici del brand.",
      "Se non trovi evidenza adeguata e sufficientemente recente, status=BLOCKED.",
      "Non inventare URL: gli URL reali vengono raccolti separatamente dalle citazioni dello strumento.",
    ].join("\n"),
    payload: input,
  });
  const parsed = result.parsed as unknown as { status: "READY" | "BLOCKED"; summary: string; evidence: ResearchEvidence[] };
  return {
    status: parsed.status,
    summary: parsed.summary,
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    sources: sources(result.body),
    responseId: typeof result.body.id === "string" ? result.body.id : "",
    requestId: result.requestId,
    model: typeof result.body.model === "string" ? result.body.model : "gpt-5.6-terra",
    usage: usage(result.body),
  };
}

export async function runOpenAIFactCheckAgent(input: {
  apiKey: string;
  topic: string;
  content: unknown;
  research: ResearchAgentResult | null;
  existingSources: string[];
  allowWebSearch: boolean;
  requireWebSearch?: boolean;
  fetcher?: typeof fetch;
}): Promise<FactCheckAgentResult> {
  const baseInstructions = [
    "Sei il Fact-check Agent di Post Automatici.",
    "Classifica ogni affermazione materiale come EXTERNAL, BRAND, INTERNAL oppure EDITORIAL.",
    "EXTERNAL: fatti sul mondo, norme, date, prezzi di mercato, dati, news o statistiche. Devono avere una fonte verificabile; se manca o non è verificabile usa UNSUPPORTED e verdict=NEEDS_SOURCE.",
    "BRAND: informazioni specifiche dell'attività o Personal Brand. Possono essere verificate solo con brandFacts, sito confermato, userProvidedContext o provenance esplicita forniti nel payload; una fonte generale non basta.",
    "INTERNAL: metriche, risultati o dati interni del profilo. Sono verificati solo se l'evidenza interna è presente nel payload; altrimenti usa UNSUPPORTED.",
    "EDITORIAL: opinioni, consigli, hook, CTA o formulazioni non fattuali. Usa status=NOT_FACTUAL, sourceRequired=false e non inventare una verifica.",
    "Per un carosello valorizza slideNumber quando il claim appartiene chiaramente a una slide; usa null per claim globali.",
    "Se una fonte contraddice il claim usa CONTRADICTED e verdict=BLOCK. Per fatti che possono cambiare usa TIME_SENSITIVE e richiedi evidenza attuale.",
    "Non approvare per plausibilità e non inventare fonti. Se un claim esterno richiede fonte e non può essere verificato, verdict=NEEDS_SOURCE.",
    "Quando usi la ricerca web per un confronto fra più piattaforme, aziende, prodotti o soggetti, cerca evidenze per TUTTI i soggetti citati: non fermarti alla prima entità trovata.",
  ].join("\n");

  const first = await callStructured({
    apiKey: input.apiKey,
    fetcher: input.fetcher,
    useWebSearch: input.allowWebSearch,
    requireWebSearch: input.requireWebSearch,
    schema: FACTCHECK_SCHEMA,
    schemaName: "post_automatici_fact_check_agent",
    instructions: baseInstructions,
    payload: { topic: input.topic, content: input.content, research: input.research, existingSources: input.existingSources },
  });
  const firstParsed = first.parsed as unknown as { verdict: "PASS" | "BLOCK" | "NEEDS_SOURCE"; checkedClaims: FactCheckClaim[] };
  const firstClaims = Array.isArray(firstParsed.checkedClaims) ? firstParsed.checkedClaims : [];
  const firstSources = [...new Set([...input.existingSources, ...sources(first.body)])].slice(0, 20);
  const firstUsage = usage(first.body);

  if (firstParsed.verdict !== "NEEDS_SOURCE" || !input.allowWebSearch) {
    return {
      verdict: firstParsed.verdict,
      checkedClaims: firstClaims,
      sources: firstSources,
      responseId: typeof first.body.id === "string" ? first.body.id : "",
      requestId: first.requestId,
      model: typeof first.body.model === "string" ? first.body.model : "gpt-5.6-terra",
      usage: firstUsage,
    };
  }

  const repairFocus = firstClaims
    .filter((claim) => claim.sourceRequired && (claim.status === "UNSUPPORTED" || claim.status === "TIME_SENSITIVE"))
    .map((claim) => ({ claim: claim.claim, claimType: claim.claimType, slideNumber: claim.slideNumber, reason: claim.reason }))
    .slice(0, 12);

  const second = await callStructured({
    apiKey: input.apiKey,
    fetcher: input.fetcher,
    useWebSearch: true,
    requireWebSearch: true,
    schema: FACTCHECK_SCHEMA,
    schemaName: "post_automatici_fact_check_repair",
    instructions: [
      baseInstructions,
      "Questo è un secondo pass di riparazione perché il primo controllo ha trovato claim senza fonte.",
      "Usa obbligatoriamente la ricerca web per cercare in modo mirato evidenza per ogni claim in repairFocus.",
      "Se il contenuto confronta più soggetti, copri esplicitamente ciascun soggetto mancante nelle fonti precedenti.",
      "Rivaluta l'intero contenuto alla luce delle nuove fonti: PASS solo se tutti i claim materiali sono verificati; BLOCK se contraddetti; NEEDS_SOURCE solo se restano davvero senza prova.",
    ].join("\n"),
    payload: {
      topic: input.topic,
      content: input.content,
      research: input.research,
      existingSources: firstSources,
      previousCheckedClaims: firstClaims,
      repairFocus,
    },
  });
  const secondParsed = second.parsed as unknown as { verdict: "PASS" | "BLOCK" | "NEEDS_SOURCE"; checkedClaims: FactCheckClaim[] };
  const secondClaims = Array.isArray(secondParsed.checkedClaims) ? secondParsed.checkedClaims : [];
  const secondSources = [...new Set([...firstSources, ...sources(second.body)])].slice(0, 20);
  const secondUsage = usage(second.body);

  return {
    verdict: secondParsed.verdict,
    checkedClaims: secondClaims,
    sources: secondSources,
    responseId: typeof second.body.id === "string" ? second.body.id : "",
    requestId: second.requestId,
    model: typeof second.body.model === "string" ? second.body.model : "gpt-5.6-terra",
    usage: {
      inputTokens: firstUsage.inputTokens + secondUsage.inputTokens,
      outputTokens: firstUsage.outputTokens + secondUsage.outputTokens,
      totalTokens: firstUsage.totalTokens + secondUsage.totalTokens,
      webSearchCalls: firstUsage.webSearchCalls + secondUsage.webSearchCalls,
    },
  };
}
