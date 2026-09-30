import { neon } from "@neondatabase/serverless";
import { EntitlementUsageService } from "./entitlement-usage.js";
import type { OpenAITextResult } from "./openai-text.js";

export const AI_CONTENT_TEXT_CAPABILITY = "ai.content.generate_text" as const;
export const TEXT_COST_OPERATIONS = ["GENERATE_SOCIAL_TEXT","AGENT_RESEARCH","AGENT_FACTCHECK","AGENT_COPY_REPAIR","AGENT_EDITORIAL_QA"] as const;

export type TextGenerationSource = "MANUAL" | "AUTOPILOT";
export type TechnicalAiEvent = {
  operation: (typeof TEXT_COST_OPERATIONS)[number];
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  metadata: Record<string, unknown>;
};

type UsageEventState = "RESERVED" | "COMMITTED" | "RELEASED";
type CachedResult = { response: unknown; contentId?: string | null; variantId?: string | null };

export type TextGenerationProgressStage =
  | "PREPARING"
  | "ANALYZING"
  | "RESEARCHING"
  | "WRITING"
  | "COPY_READY"
  | "VERIFYING"
  | "VERIFIED"
  | "FINALIZING"
  | "COMMITTED"
  | "RELEASED";

export type TextGenerationOperationStatus = {
  eventId: string;
  state: UsageEventState;
  stage: TextGenerationProgressStage;
  percent: number;
  releaseReason: string | null;
  cached: CachedResult | null;
  createdAt: string;
};

export type TextGenerationReservation =
  | { status: "RESERVED"; eventId: string; operationKey: string }
  | { status: "COMPLETED"; eventId: string; operationKey: string; cached: CachedResult }
  | { status: "IN_PROGRESS"; eventId: string; operationKey: string }
  | { status: "RELEASED"; eventId: string; operationKey: string }
  | { status: "DENIED"; code: "CAPABILITY_DISABLED" | "CAPABILITY_LIMIT_REACHED"; operationKey: string };

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function deriveTextGenerationOperationKey(input: {
  profileId: string;
  source: TextGenerationSource;
  operationIdentity: string;
  requestFingerprint: unknown;
}) {
  if (!input.profileId || !input.operationIdentity) throw new Error("OPERATION_ID_REQUIRED");
  const fingerprint = await sha256(stable(input.requestFingerprint));
  return `ai-text:v1:${await sha256(`${input.profileId}|${input.source}|${input.operationIdentity}|${fingerprint}`)}`;
}

export class TextGenerationMetering {
  private readonly usage: EntitlementUsageService;
  private readonly sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
    this.usage = new EntitlementUsageService(databaseUrl);
    this.sql = neon(databaseUrl);
  }

  async reserve(input: {
    profileId: string;
    source: TextGenerationSource;
    operationIdentity: string;
    requestFingerprint: unknown;
    referenceId?: string | null;
  }): Promise<TextGenerationReservation> {
    const operationKey = await deriveTextGenerationOperationKey(input);
    const reserved = await this.usage.reserveUsage({
      profileId: input.profileId,
      capabilityKey: AI_CONTENT_TEXT_CAPABILITY,
      quantity: 1,
      idempotencyKey: operationKey,
      source: `AI_TEXT_${input.source}`,
      referenceId: input.referenceId ?? null,
      metadata: {
        logical_unit: 1,
        source: input.source,
        execution_state: "RESERVED",
        client_operation_identity: input.operationIdentity,
        progress_stage: "PREPARING",
        progress_percent: 10,
        progress_updated_at: new Date().toISOString(),
      },
    });
    if (!reserved.allowed) {
      return {
        status: "DENIED",
        code: reserved.reason === "ENTITLEMENT_DISABLED" ? "CAPABILITY_DISABLED" : "CAPABILITY_LIMIT_REACHED",
        operationKey,
      };
    }
    const eventId = reserved.result?.event_id;
    if (!eventId) throw new Error("METERING_FAILED");
    if (!reserved.result?.duplicate) return { status: "RESERVED", eventId, operationKey };

    const existing = await this.usage.getUsageEvent(eventId);
    if (!existing) throw new Error("METERING_FAILED");
    const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata as Record<string, unknown> : {};
    const cached = metadata.cached_result && typeof metadata.cached_result === "object" ? metadata.cached_result as CachedResult : null;
    if (existing.state === "COMMITTED" && cached) return { status: "COMPLETED", eventId, operationKey, cached };
    if (existing.state === "RESERVED") return { status: "IN_PROGRESS", eventId, operationKey };
    return { status: "RELEASED", eventId, operationKey };
  }

  async markProviderStarted(eventId: string, providerCostReserveUsd?: number | null) {
    return this.usage.markProviderStarted(eventId, providerCostReserveUsd);
  }

  async setProgress(eventId: string, percent: number, stage: TextGenerationProgressStage) {
    const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
    return this.usage.mergeUsageEventMetadata(eventId, {
      progress_stage: stage,
      progress_percent: safePercent,
      progress_updated_at: new Date().toISOString(),
    });
  }

  async getOperationStatus(profileId: string, source: TextGenerationSource, operationIdentity: string): Promise<TextGenerationOperationStatus | null> {
    if (!profileId || !operationIdentity) return null;
    const rows = await this.sql`
      select id, state, metadata, created_at
      from public.capability_usage_events
      where profile_id=${profileId}::uuid
        and capability_key=${AI_CONTENT_TEXT_CAPABILITY}
        and source=${`AI_TEXT_${source}`}
        and metadata->>'client_operation_identity'=${operationIdentity}
      order by created_at desc
      limit 1
    ` as unknown as Array<{ id: string; state: UsageEventState; metadata: unknown; created_at: string }>;
    const row = rows[0];
    if (!row) return null;
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    const cached = metadata.cached_result && typeof metadata.cached_result === "object" ? metadata.cached_result as CachedResult : null;
    const rawStage = typeof metadata.progress_stage === "string" ? metadata.progress_stage : null;
    const rawPercent = typeof metadata.progress_percent === "number" ? metadata.progress_percent : null;
    const stage: TextGenerationProgressStage = row.state === "COMMITTED"
      ? "COMMITTED"
      : row.state === "RELEASED"
        ? "RELEASED"
        : rawStage === "PREPARING" || rawStage === "ANALYZING" || rawStage === "RESEARCHING" || rawStage === "WRITING" || rawStage === "COPY_READY" || rawStage === "VERIFYING" || rawStage === "VERIFIED" || rawStage === "FINALIZING"
          ? rawStage
          : "PREPARING";
    const percent = row.state === "COMMITTED" ? 100 : row.state === "RELEASED" ? Math.min(rawPercent ?? 95, 99) : Math.max(1, Math.min(rawPercent ?? 10, 99));
    return {
      eventId: row.id,
      state: row.state,
      stage,
      percent,
      releaseReason: typeof metadata.release_reason === "string" ? metadata.release_reason : null,
      cached,
      createdAt: row.created_at,
    };
  }

  async persistTechnicalEvents(profileId: string, eventId: string, events: TechnicalAiEvent[]) {
    if (!events.length) return;
    await this.usage.mergeUsageEventMetadata(eventId, {
      technical_usage_outbox: events,
      technical_usage_state: "PENDING",
    });
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const payload = events.map((event) => ({
          operation: event.operation,
          model: event.model,
          input_tokens: event.inputTokens,
          output_tokens: event.outputTokens,
          cost_usd: event.costUsd,
          metadata: { ...event.metadata, logical_usage_event_id: eventId, logical_capability: AI_CONTENT_TEXT_CAPABILITY },
        }));
        await this.sql`
          insert into public.ai_usage_events (profile_id,operation,model,input_tokens,output_tokens,cost_usd,metadata)
          select
            ${profileId}::uuid,
            item->>'operation',
            item->>'model',
            nullif(item->>'input_tokens','')::integer,
            nullif(item->>'output_tokens','')::integer,
            nullif(item->>'cost_usd','')::numeric,
            coalesce(item->'metadata','{}'::jsonb)
          from jsonb_array_elements(${JSON.stringify(payload)}::jsonb) item
          where not exists (
            select 1 from public.ai_usage_events
            where profile_id=${profileId}::uuid
              and operation=item->>'operation'
              and metadata->>'logical_usage_event_id'=${eventId}
          )
        `;
        await this.usage.reconcileProviderCostAttempt(eventId);
        await this.usage.mergeUsageEventMetadata(eventId, {
          technical_usage_state: "PERSISTED",
          technical_usage_persisted_at: new Date().toISOString(),
          technical_usage_outbox: [],
        });
        return;
      } catch (reason) {
        lastError = reason;
      }
    }
    await this.usage.mergeUsageEventMetadata(eventId, {
      execution_state: "TECHNICAL_USAGE_PERSIST_FAILED",
      technical_usage_state: "PENDING_RECONCILIATION",
    }).catch(() => undefined);
    throw new Error(`METERING_FAILED:${lastError instanceof Error ? lastError.message : "AI_USAGE_PERSIST_FAILED"}`);
  }

  async storeResult(eventId: string, cached: CachedResult) {
    await this.usage.mergeUsageEventMetadata(eventId, {
      execution_state: "OUTPUT_PERSISTED",
      progress_stage: "FINALIZING",
      progress_percent: 98,
      progress_updated_at: new Date().toISOString(),
      cached_result: cached,
    });
  }

  async commit(eventId: string) {
    await this.usage.commitUsage(eventId);
    await this.usage.mergeUsageEventMetadata(eventId, {
      execution_state: "COMMITTED",
      progress_stage: "COMMITTED",
      progress_percent: 100,
      progress_updated_at: new Date().toISOString(),
    });
  }

  async release(eventId: string, reason: string) {
    await this.usage.mergeUsageEventMetadata(eventId, {
      execution_state: "RELEASED",
      progress_stage: "RELEASED",
      release_reason: reason.slice(0, 200),
      progress_updated_at: new Date().toISOString(),
    }).catch(() => undefined);
    await this.usage.releaseUsage(eventId);
  }
}

export function technicalEventsFromTextResult(result: OpenAITextResult, metadata: Record<string, unknown> = {}): TechnicalAiEvent[] {
  return result.technicalEvents.map((event) => ({
    operation: event.operation,
    model: event.model,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    costUsd: event.costUsd,
    metadata: { ...metadata, ...event.metadata },
  }));
}
