import { neon } from "@neondatabase/serverless";
import { EntitlementUsageService } from "./entitlement-usage.js";
import { estimateTerraCostUsd } from "./openai-text.js";

export const STRATEGY_GENERATE_CAPABILITY = "ai.strategy.generate" as const;
export const STRATEGY_TECHNICAL_OPERATIONS = ["AGENT_STRATEGIST", "AGENT_PLANNER"] as const;

export type StrategyPlannerCycle = "STRATEGY_PLAN" | "PLAN";
export type StrategyTechnicalOperation = (typeof STRATEGY_TECHNICAL_OPERATIONS)[number];

type CachedResult = { response: unknown };

export type StrategyPlannerTechnicalResult = {
  operation: StrategyTechnicalOperation;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  responseId: string;
  requestId: string | null;
  metadata?: Record<string, unknown>;
};

export type StrategyPlannerReservation =
  | { status: "RESERVED"; eventId: string; operationKey: string }
  | { status: "COMPLETED"; eventId: string; operationKey: string; cached: CachedResult }
  | { status: "IN_PROGRESS"; eventId: string; operationKey: string }
  | { status: "RELEASED"; eventId: string; operationKey: string }
  | { status: "DENIED"; code: "CAPABILITY_DISABLED" | "CAPABILITY_LIMIT_REACHED"; operationKey: string };

export function deriveStrategyPlannerOperationKey(profileId: string, cycle: StrategyPlannerCycle, now = new Date()) {
  if (!profileId) throw new Error("STRATEGY_GENERATION_IDENTITY_REQUIRED");
  const day = now.toISOString().slice(0, 10);
  return `ai-strategy:v1:${profileId}:${cycle.toLowerCase()}:${day}`;
}

export class StrategyPlannerMetering {
  private readonly usage: EntitlementUsageService;
  private readonly sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
    this.usage = new EntitlementUsageService(databaseUrl);
    this.sql = neon(databaseUrl);
  }

  async reserve(input: { profileId: string; cycle: StrategyPlannerCycle; now?: Date }): Promise<StrategyPlannerReservation> {
    const operationKey = deriveStrategyPlannerOperationKey(input.profileId, input.cycle, input.now);
    const reserved = await this.usage.reserveUsage({
      profileId: input.profileId,
      capabilityKey: STRATEGY_GENERATE_CAPABILITY,
      quantity: 1,
      idempotencyKey: operationKey,
      source: "OPENAI_STRATEGY_PLANNER",
      referenceId: input.cycle,
      metadata: { logical_unit: 1, cycle: input.cycle, execution_state: "RESERVED" },
      now: input.now,
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

  async markProviderStarted(eventId: string) {
    return this.usage.markProviderStarted(eventId);
  }

  async persistTechnicalUsage(profileId: string, eventId: string, result: StrategyPlannerTechnicalResult) {
    const costUsd = result.inputTokens !== null && result.outputTokens !== null
      ? estimateTerraCostUsd(result.inputTokens, result.outputTokens)
      : null;
    const event = {
      operation: result.operation,
      model: result.model,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      cost_usd: costUsd,
      metadata: {
        ...(result.metadata ?? {}),
        openai_response_id: result.responseId,
        openai_request_id: result.requestId,
        logical_usage_event_id: eventId,
        logical_capability: STRATEGY_GENERATE_CAPABILITY,
      },
    };
    await this.usage.mergeUsageEventMetadata(eventId, {
      technical_usage_outbox: [event],
      technical_usage_state: "PENDING",
    });

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.sql`
          insert into public.ai_usage_events (
            profile_id, operation, model, input_tokens, output_tokens, cost_usd, metadata
          )
          select
            ${profileId}::uuid,
            ${event.operation},
            ${event.model},
            ${event.input_tokens}::integer,
            ${event.output_tokens}::integer,
            ${event.cost_usd}::numeric,
            ${JSON.stringify(event.metadata)}::jsonb
          where not exists (
            select 1
            from public.ai_usage_events
            where profile_id=${profileId}::uuid
              and operation=${event.operation}
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
      cached_result: cached,
    });
  }

  async commit(eventId: string) {
    await this.usage.commitUsage(eventId);
    await this.usage.mergeUsageEventMetadata(eventId, { execution_state: "COMMITTED" });
  }

  async release(eventId: string, reason: string) {
    await this.usage.mergeUsageEventMetadata(eventId, {
      execution_state: "RELEASED",
      release_reason: reason.slice(0, 200),
    }).catch(() => undefined);
    await this.usage.releaseUsage(eventId);
  }
}
