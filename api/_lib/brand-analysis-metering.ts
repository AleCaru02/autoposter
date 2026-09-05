import { neon } from "@neondatabase/serverless";
import { EntitlementUsageService } from "./entitlement-usage.js";
import type { BrandAnalysisResult } from "./brand-analysis.js";

export const BRAND_ANALYZE_CAPABILITY = "brand.analyze" as const;
export const BRAND_ANALYZE_TECHNICAL_OPERATION = "ANALYZE_BRAND_ONBOARDING" as const;

type CachedResult = { response: unknown };

export type BrandAnalysisReservation =
  | { status: "RESERVED"; eventId: string; operationKey: string }
  | { status: "COMPLETED"; eventId: string; operationKey: string; cached: CachedResult }
  | { status: "IN_PROGRESS"; eventId: string; operationKey: string }
  | { status: "RELEASED"; eventId: string; operationKey: string }
  | { status: "DENIED"; code: "CAPABILITY_DISABLED" | "CAPABILITY_LIMIT_REACHED"; operationKey: string };

export function deriveBrandAnalysisOperationKey(profileId: string, scanId: string) {
  if (!profileId || !scanId) throw new Error("BRAND_ANALYSIS_IDENTITY_REQUIRED");
  return `brand-analyze:v1:${profileId}:${scanId}`;
}

export class BrandAnalysisMetering {
  private readonly usage: EntitlementUsageService;
  private readonly sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
    this.usage = new EntitlementUsageService(databaseUrl);
    this.sql = neon(databaseUrl);
  }

  async reserve(input: { profileId: string; scanId: string }): Promise<BrandAnalysisReservation> {
    const operationKey = deriveBrandAnalysisOperationKey(input.profileId, input.scanId);
    const reserved = await this.usage.reserveUsage({
      profileId: input.profileId,
      capabilityKey: BRAND_ANALYZE_CAPABILITY,
      quantity: 1,
      idempotencyKey: operationKey,
      source: "BRAND_ANALYZE_ONBOARDING",
      referenceId: input.scanId,
      metadata: { logical_unit: 1, scan_id: input.scanId, execution_state: "RESERVED" },
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

  async persistTechnicalUsage(
    profileId: string,
    eventId: string,
    result: BrandAnalysisResult,
    metadata: Record<string, unknown> = {},
  ) {
    const event = {
      operation: BRAND_ANALYZE_TECHNICAL_OPERATION,
      model: result.model,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      cost_usd: result.usage.estimatedCostUsd,
      metadata: {
        ...metadata,
        openai_response_id: result.responseId,
        openai_request_id: result.requestId,
        page_insights: result.analysis.pageInsights.length,
        content_pillars: result.analysis.contentPillars.length,
        logical_usage_event_id: eventId,
        logical_capability: BRAND_ANALYZE_CAPABILITY,
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
