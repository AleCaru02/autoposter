import { neon } from "@neondatabase/serverless";
import { EntitlementUsageService } from "./entitlement-usage.js";
import { estimateTerraCostUsd } from "./openai-text.js";
import { identityQaVerdict, type IdentityQaScores } from "./visual-provider-routing.js";

export type IdentityQaVisionScores = IdentityQaScores & {
  composition: number;
  social_format: number;
};

export type IdentityQaVisionResult = {
  verdict: "PASS" | "BLOCK";
  identityScore: number;
  qualityScore: number;
  failedDimensions: string[];
  scores: IdentityQaVisionScores;
  reasons: string[];
  model: "gpt-5.6-terra";
  responseId: string;
  requestId: string | null;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
};

const SCORE_KEYS = [
  "face","eyes","hair","nose","mouth","apparent_age","body","proportions",
  "hands","fingers","teeth","anatomy","artifacts","realism","overall_quality",
  "composition","social_format",
] as const;

const QA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(SCORE_KEYS.map((key) => [key, { type: "number", minimum: 0, maximum: 1 }])),
      required: [...SCORE_KEYS],
    },
    reasons: { type: "array", maxItems: 12, items: { type: "string", maxLength: 220 } },
  },
  required: ["scores","reasons"],
} as const;

function outputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (!item || typeof item !== "object") continue;
    for (const part of Array.isArray((item as {content?:unknown}).content) ? (item as {content:unknown[]}).content : []) {
      if (part && typeof part === "object" && (part as {type?:unknown}).type === "output_text" && typeof (part as {text?:unknown}).text === "string") {
        parts.push((part as {text:string}).text);
      }
    }
  }
  return parts.join("\n").trim();
}

function clamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0,Math.min(1,value)) : 0;
}

function validatedScores(value: unknown): IdentityQaVisionScores {
  const source = value && typeof value === "object" ? value as Record<string,unknown> : {};
  return Object.fromEntries(SCORE_KEYS.map((key) => [key,clamp(source[key])])) as IdentityQaVisionScores;
}

export function finalizeIdentityQa(scores: IdentityQaVisionScores, reasons: string[] = []): Omit<IdentityQaVisionResult,"model"|"responseId"|"requestId"|"usage"> {
  const base = identityQaVerdict(scores);
  const extraFailed = [
    ...(scores.composition < 0.75 ? ["composition"] : []),
    ...(scores.social_format < 0.8 ? ["social_format"] : []),
  ];
  const failedDimensions = [...new Set([...base.failedDimensions,...extraFailed])];
  return {
    verdict: base.verdict === "PASS" && extraFailed.length === 0 ? "PASS" : "BLOCK",
    identityScore: base.identityScore,
    qualityScore: base.qualityScore,
    failedDimensions,
    scores,
    reasons,
  };
}

export async function runOpenAIIdentityQa(input: {
  apiKey: string;
  generatedImageDataUrl: string;
  referenceImageDataUrls: string[];
  provider: string;
  format: string;
  visualBrief: string;
  fetcher?: typeof fetch;
}): Promise<IdentityQaVisionResult> {
  const references = input.referenceImageDataUrls.filter((value) => /^data:image\/(?:jpeg|png|webp);base64,/i.test(value)).slice(0,4);
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(input.generatedImageDataUrl)) throw new Error("IDENTITY_QA_GENERATED_IMAGE_REQUIRED");
  if (!references.length) throw new Error("IDENTITY_QA_REFERENCES_REQUIRED");

  const response = await (input.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "Sei il Visual Identity QA di Post Automatici.",
        "Confronta l'immagine candidata con le foto reference della stessa persona.",
        "Valuta soltanto ciò che è visibile. Non identificare la persona e non inferire attributi sensibili.",
        "Assegna score 0..1 a ogni dimensione richiesta.",
        "face/eyes/hair/nose/mouth/apparent_age/body/proportions misurano la coerenza visiva con le reference.",
        "hands/fingers/teeth/anatomy/artifacts/realism/overall_quality misurano difetti e qualità tecnica: 1 significa nessun problema evidente.",
        "composition valuta leggibilità e composizione professionale.",
        "social_format valuta l'idoneità al formato social richiesto.",
        "Se una parte non è visibile, non inventare: usa uno score prudente e spiegalo nei reasons.",
        "Restituisci solo JSON conforme allo schema.",
      ].join("\n"),
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: JSON.stringify({ provider: input.provider, format: input.format, visualBrief: input.visualBrief }) },
          { type: "input_text", text: "IMMAGINE CANDIDATA:" },
          { type: "input_image", image_url: input.generatedImageDataUrl, detail: "high" },
          { type: "input_text", text: "REFERENCE DELLA STESSA PERSONA:" },
          ...references.map((image_url) => ({ type: "input_image", image_url, detail: "high" })),
        ],
      }],
      text: { verbosity: "low", format: { type: "json_schema", name: "post_automatici_identity_qa", strict: true, schema: QA_SCHEMA } },
      max_output_tokens: 1200,
    }),
  });
  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) throw new Error(`OPENAI_IDENTITY_QA_HTTP_${response.status}`);
  const body = JSON.parse(raw) as Record<string,unknown>;
  const text = outputText(body);
  if (!text) throw new Error("OPENAI_IDENTITY_QA_EMPTY_OUTPUT");
  const parsed = JSON.parse(text) as { scores?: unknown; reasons?: unknown };
  const scores = validatedScores(parsed.scores);
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.filter((item):item is string => typeof item === "string").slice(0,12) : [];
  const base = finalizeIdentityQa(scores,reasons);
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string,unknown> : {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : 0;
  return {
    ...base,
    model: "gpt-5.6-terra",
    responseId: typeof body.id === "string" ? body.id : "",
    requestId,
    usage: { inputTokens, outputTokens, estimatedCostUsd: estimateTerraCostUsd(inputTokens,outputTokens) },
  };
}

function bytesDataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

export async function runMeteredIdentityQa(input: {
  databaseUrl: string;
  apiKey: string;
  profileId: string;
  variantId: string;
  generatedImageDataUrl: string;
  provider: string;
  format: string;
  visualBrief: string;
  fetcher?: typeof fetch;
}) {
  const sql = neon(input.databaseUrl);
  const refs = await sql`
    select mime_type,encode(image_bytes,'base64') as base64
    from public.personal_brand_reference_images
    where profile_id=${input.profileId}::uuid and quality_status='PASS'
    order by quality_score desc nulls last,created_at asc
    limit 4
  ` as unknown as Array<{mime_type:string;base64:string}>;
  if (!refs.length) throw new Error("IDENTITY_QA_REFERENCES_REQUIRED");

  const usage = new EntitlementUsageService(input.databaseUrl);
  const operationKey = `identity-qa:v1:${input.profileId}:${input.variantId}`;
  const reserved = await usage.reserveUsage({
    profileId: input.profileId,
    capabilityKey: "visual.identity.qa",
    quantity: 1,
    idempotencyKey: operationKey,
    source: "IDENTITY_QA",
    referenceId: input.variantId,
    metadata: { cost_bucket: "OTHER_AI", execution_state: "RESERVED" },
  });
  if (!reserved.allowed || !reserved.result?.event_id) throw new Error(reserved.reason ?? "IDENTITY_QA_RESERVATION_FAILED");
  const eventId = reserved.result.event_id;
  if (reserved.result.duplicate) {
    const existing = await usage.getUsageEvent(eventId);
    if (existing?.state === "COMMITTED") return { duplicate: true, eventId, result: existing.metadata };
    if (existing?.state === "RESERVED") throw new Error("IDENTITY_QA_IN_PROGRESS");
  }

  try {
    await usage.markProviderStarted(eventId,0.05);
    const result = await runOpenAIIdentityQa({
      apiKey: input.apiKey,
      generatedImageDataUrl: input.generatedImageDataUrl,
      referenceImageDataUrls: refs.map((row) => bytesDataUrl(row.mime_type,row.base64)),
      provider: input.provider,
      format: input.format,
      visualBrief: input.visualBrief,
      fetcher: input.fetcher,
    });
    await sql`
      insert into public.ai_usage_events(profile_id,operation,model,input_tokens,output_tokens,cost_usd,metadata)
      values (
        ${input.profileId}::uuid,'VISUAL_IDENTITY_QA',${result.model},${result.usage.inputTokens},
        ${result.usage.outputTokens},${result.usage.estimatedCostUsd},
        ${JSON.stringify({logical_usage_event_id:eventId,variant_id:input.variantId,openai_response_id:result.responseId,openai_request_id:result.requestId,verdict:result.verdict,failed_dimensions:result.failedDimensions})}::jsonb
      )
    `;
    await usage.reconcileProviderCostAttempt(eventId);
    await sql`
      update public.content_variants
      set visual_identity_qa_status=${result.verdict},
          updated_at=now()
      where id=${input.variantId}::uuid and profile_id=${input.profileId}::uuid
    `;
    await usage.mergeUsageEventMetadata(eventId,{ execution_state:"COMPLETED", result });
    await usage.commitUsage(eventId);
    return { duplicate:false,eventId,result };
  } catch (reason) {
    await usage.mergeUsageEventMetadata(eventId,{ execution_state:"FAILED", error_code:reason instanceof Error?reason.message.slice(0,120):"IDENTITY_QA_FAILED" }).catch(()=>undefined);
    await usage.releaseUsage(eventId).catch(()=>undefined);
    throw reason;
  }
}
