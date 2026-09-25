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
  status: "VERIFIED" | "UNSUPPORTED" | "CONTRADICTED" | "TIME_SENSITIVE";
  reason: string;
};

export type FactCheckAgentResult = {
  verdict: "PASS" | "BLOCK" | "NEEDS_RESEARCH";
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
    verdict: { type: "string", enum: ["PASS", "BLOCK", "NEEDS_RESEARCH"] },
    checkedClaims: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          status: { type: "string", enum: ["VERIFIED", "UNSUPPORTED", "CONTRADICTED", "TIME_SENSITIVE"] },
          reason: { type: "string" },
        },
        required: ["claim", "status", "reason"],
      },
    },
  },
  required: ["verdict", "checkedClaims"],
} as const;

function extractGeminiOutputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const pieces: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object" || (step as { type?: unknown }).type !== "model_output") continue;
    const content = Array.isArray((step as { content?: unknown }).content) ? (step as { content: unknown[] }).content : [];
    for (const block of content) {
      if (block && typeof block === "object" && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string") {
        pieces.push((block as { text: string }).text);
      }
    }
  }
  return pieces.join("\n").trim();
}

function geminiSources(body: Record<string, unknown>) {
  const urls = new Set<string>();
  const steps = Array.isArray(body.steps) ? body.steps : [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const type = (step as { type?: unknown }).type;
    if (type === "google_search_result") {
      const result = (step as { result?: unknown }).result;
      const values = Array.isArray(result) ? result : result ? [result] : [];
      for (const item of values) {
        if (!item || typeof item !== "object") continue;
        for (const key of ["url", "uri"] as const) {
          const candidate = (item as Record<string, unknown>)[key];
          if (typeof candidate === "string") {
            try { const url = new URL(candidate); if (url.protocol === "https:" || url.protocol === "http:") urls.add(url.toString()); } catch { /* ignore */ }
          }
        }
      }
    }
    if (type === "model_output") {
      const content = Array.isArray((step as { content?: unknown }).content) ? (step as { content: unknown[] }).content : [];
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const annotations = Array.isArray((block as { annotations?: unknown }).annotations) ? (block as { annotations: unknown[] }).annotations : [];
        for (const annotation of annotations) {
          if (!annotation || typeof annotation !== "object") continue;
          const raw = annotation as Record<string, unknown>;
          const candidate = typeof raw.uri === "string" ? raw.uri : typeof raw.url === "string" ? raw.url : typeof raw.source === "string" ? raw.source : null;
          if (!candidate) continue;
          try { const url = new URL(candidate); if (url.protocol === "https:" || url.protocol === "http:") urls.add(url.toString()); } catch { /* ignore */ }
        }
      }
    }
  }
  return [...urls].slice(0, 20);
}

function geminiUsage(body: Record<string, unknown>) {
  const raw = body.usage && typeof body.usage === "object"
    ? body.usage as Record<string, unknown>
    : body.usage_metadata && typeof body.usage_metadata === "object"
      ? body.usage_metadata as Record<string, unknown>
      : {};
  const steps = Array.isArray(body.steps) ? body.steps : [];
  const inputTokens = Number(raw.input_tokens ?? raw.prompt_token_count ?? raw.inputTokenCount ?? 0) || 0;
  const outputTokens = Number(raw.output_tokens ?? raw.candidates_token_count ?? raw.outputTokenCount ?? 0) || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: Number(raw.total_tokens ?? raw.total_token_count ?? raw.totalTokenCount ?? inputTokens + outputTokens) || inputTokens + outputTokens,
    webSearchCalls: steps.filter((step) => step && typeof step === "object" && (step as { type?: unknown }).type === "google_search_call").length,
  };
}

async function callStructured(input: {
  apiKey: string;
  instructions: string;
  payload: unknown;
  schema: typeof RESEARCH_SCHEMA | typeof FACTCHECK_SCHEMA;
  useWebSearch: boolean;
  fetcher?: typeof fetch;
}) {
  if (!input.apiKey) throw new Error("GEMINI_NOT_CONFIGURED");
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": input.apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gemini-3.8-flash",
      input: `${input.instructions}\n\nDATI DA ANALIZZARE:\n${JSON.stringify(input.payload)}`,
      ...(input.useWebSearch ? { tools: [{ type: "google_search" }] } : {}),
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: input.schema,
      },
    }),
  });
  const requestId = response.headers.get("x-request-id") || response.headers.get("x-goog-request-id");
  const raw = await response.text();
  if (!response.ok) throw new Error(`GEMINI_AGENT_HTTP_${response.status}`);
  const body = JSON.parse(raw) as Record<string, unknown>;
  const output = extractGeminiOutputText(body);
  if (!output) throw new Error("GEMINI_AGENT_EMPTY_OUTPUT");
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
    sources: geminiSources(result.body),
    responseId: typeof result.body.id === "string" ? result.body.id : "",
    requestId: result.requestId,
    model: typeof result.body.model === "string" ? result.body.model : "gemini-3.8-flash",
    usage: geminiUsage(result.body),
  };
}

export async function runOpenAIFactCheckAgent(input: {
  apiKey: string;
  topic: string;
  content: unknown;
  research: ResearchAgentResult | null;
  existingSources: string[];
  allowWebSearch: boolean;
  fetcher?: typeof fetch;
}): Promise<FactCheckAgentResult> {
  const result = await callStructured({
    apiKey: input.apiKey,
    fetcher: input.fetcher,
    useWebSearch: input.allowWebSearch,
    schema: FACTCHECK_SCHEMA,
    schemaName: "post_automatici_fact_check_agent",
    instructions: [
      "Sei il Fact-check Agent di Post Automatici.",
      "Controlla date, numeri, percentuali, prezzi, norme, scadenze e affermazioni esterne presenti nel contenuto.",
      "Un claim del brand è verificabile soltanto con dati del brand/sito forniti nel contenuto; una fonte generale non può renderlo un fatto del brand.",
      "Se un claim materiale non è supportato, usa UNSUPPORTED e verdict=BLOCK. Se serve nuova evidenza non disponibile, verdict=NEEDS_RESEARCH.",
      "Se una fonte contraddice il claim, usa CONTRADICTED e verdict=BLOCK. Per fatti che possono cambiare indica TIME_SENSITIVE e richiedi evidenza attuale.",
      "Non approvare per plausibilità: approva soltanto ciò che è supportato dalle evidenze disponibili.",
    ].join("\n"),
    payload: { topic: input.topic, content: input.content, research: input.research, existingSources: input.existingSources },
  });
  const parsed = result.parsed as unknown as { verdict: "PASS" | "BLOCK" | "NEEDS_RESEARCH"; checkedClaims: FactCheckClaim[] };
  return {
    verdict: parsed.verdict,
    checkedClaims: Array.isArray(parsed.checkedClaims) ? parsed.checkedClaims : [],
    sources: [...new Set([...input.existingSources, ...geminiSources(result.body)])].slice(0, 20),
    responseId: typeof result.body.id === "string" ? result.body.id : "",
    requestId: result.requestId,
    model: typeof result.body.model === "string" ? result.body.model : "gemini-3.8-flash",
    usage: geminiUsage(result.body),
  };
}
