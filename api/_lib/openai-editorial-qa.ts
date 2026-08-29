import { estimateTerraCostUsd, type GeneratedSocialContent, type GeneratedVariant, type SocialFormat, type SocialProvider } from "./openai-text.js";

export type EditorialQAResult = {
  verdict: "PASS" | "BLOCK";
  reasons: string[];
  checks: {
    brandConsistency: "PASS" | "FAIL";
    platformFit: "PASS" | "FAIL";
    formatFit: "PASS" | "FAIL";
    ctaFit: "PASS" | "FAIL";
    claimSafety: "PASS" | "FAIL";
    visualSafety: "PASS" | "FAIL";
  };
  responseId: string;
  requestId: string | null;
  model: "gpt-5.6-terra";
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number };
};

const QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["PASS", "BLOCK"] },
    reasons: { type: "array", maxItems: 10, items: { type: "string", maxLength: 300 } },
    checks: {
      type: "object",
      additionalProperties: false,
      properties: {
        brandConsistency: { type: "string", enum: ["PASS", "FAIL"] },
        platformFit: { type: "string", enum: ["PASS", "FAIL"] },
        formatFit: { type: "string", enum: ["PASS", "FAIL"] },
        ctaFit: { type: "string", enum: ["PASS", "FAIL"] },
        claimSafety: { type: "string", enum: ["PASS", "FAIL"] },
        visualSafety: { type: "string", enum: ["PASS", "FAIL"] },
      },
      required: ["brandConsistency", "platformFit", "formatFit", "ctaFit", "claimSafety", "visualSafety"],
    },
  },
  required: ["verdict", "reasons", "checks"],
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

export async function runOpenAIEditorialQA(input: {
  apiKey: string;
  profileName: string;
  industry: string | null;
  tone: string | null;
  provider: SocialProvider;
  format: SocialFormat;
  objective: string | null;
  content: GeneratedSocialContent;
  variant: GeneratedVariant;
  verification: { researchAgentRan: boolean; factCheckAgentRan: boolean; factCheckVerdict: "PASS" | null };
  externalSources: string[];
  fetcher?: typeof fetch;
}): Promise<EditorialQAResult> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "Sei l'Editorial QA Agent di Post Automatici.",
        "Sei l'ultimo controllo semantico prima che un contenuto possa procedere automaticamente verso media e pubblicazione.",
        "Non riscrivere il contenuto e non fare ricerca web. Devi soltanto PASS oppure BLOCK.",
        "Blocca se il copy è incoerente con brand/obiettivo, inadatto alla piattaforma o al formato, ha CTA ingannevole/forzata, introduce claim specifici non sostenuti dalla factualBasis/verifica disponibile, oppure se il visualBrief può introdurre fatti del brand non verificati.",
        "Non bocciare per preferenze stilistiche minori: BLOCK solo per problemi materiali che rendono rischiosa o scadente la pubblicazione automatica.",
        "Per GBP richiedi utilità aziendale/locale concreta e niente engagement bait. Per LinkedIn richiedi tono professionale autonomo. Per Story richiedi brevità e leggibilità mobile.",
        "Se Fact-check è stato eseguito e non risulta PASS, verdict deve essere BLOCK.",
        "Restituisci esclusivamente JSON conforme allo schema.",
      ].join("\n"),
      input: JSON.stringify({
        brand: { name: input.profileName, industry: input.industry, tone: input.tone },
        placement: { provider: input.provider, format: input.format, objective: input.objective },
        editorialCore: { topic: input.content.editorialTopic, angle: input.content.editorialAngle, strategySummary: input.content.strategySummary },
        variant: input.variant,
        verification: input.verification,
        externalSources: input.externalSources.slice(0, 12),
      }),
      text: { verbosity: "low", format: { type: "json_schema", name: "post_automatici_editorial_qa", strict: true, schema: QA_SCHEMA } },
      max_output_tokens: 1000,
    }),
  });
  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) throw new Error(`OPENAI_EDITORIAL_QA_HTTP_${response.status}`);
  const body = JSON.parse(raw) as Record<string, unknown>;
  const text = outputText(body);
  if (!text) throw new Error("OPENAI_EDITORIAL_QA_EMPTY_OUTPUT");
  const parsed = JSON.parse(text) as Pick<EditorialQAResult, "verdict" | "reasons" | "checks">;
  const rawUsage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const inputTokens = n(rawUsage.input_tokens);
  const outputTokens = n(rawUsage.output_tokens);
  return {
    ...parsed,
    responseId: typeof body.id === "string" ? body.id : "",
    requestId,
    model: "gpt-5.6-terra",
    usage: { inputTokens, outputTokens, totalTokens: n(rawUsage.total_tokens) || inputTokens + outputTokens, estimatedCostUsd: estimateTerraCostUsd(inputTokens, outputTokens) },
  };
}
