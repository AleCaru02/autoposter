import { neon } from "@neondatabase/serverless";
import { EntitlementUsageService } from "../entitlement-usage.js";
import type { CapabilityKey } from "../capabilities.js";

/**
 * Generic metered paid-provider call for the Reel engine, same contract as
 * ImageGenerationMetering: entitlement reserve -> provider cost budget -> provider call ->
 * technical ai_usage_events -> reconcile -> commit (or release with reason).
 */
export type TechnicalUsage = { operation: string; model: string; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; metadata?: Record<string, unknown> };

export type MeterReservation =
  | { status: "RESERVED"; eventId: string }
  | { status: "COMPLETED"; eventId: string; cached: Record<string, unknown> }
  | { status: "IN_PROGRESS"; eventId: string }
  | { status: "RELEASED"; eventId: string }
  | { status: "DENIED"; code: "CAPABILITY_DISABLED" | "CAPABILITY_LIMIT_REACHED" };

export class CapabilityMeter {
  private readonly usage: EntitlementUsageService;
  private readonly sql: ReturnType<typeof neon>;

  constructor(databaseUrl: string, private readonly capability: CapabilityKey) {
    if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
    this.usage = new EntitlementUsageService(databaseUrl);
    this.sql = neon(databaseUrl);
  }

  async reserve(input: { profileId: string; idempotencyKey: string; source: string; referenceId?: string | null }): Promise<MeterReservation> {
    const reserved = await this.usage.reserveUsage({
      profileId: input.profileId,
      capabilityKey: this.capability,
      quantity: 1,
      idempotencyKey: input.idempotencyKey,
      source: input.source,
      referenceId: input.referenceId ?? null,
      metadata: { logical_unit: 1, execution_state: "RESERVED" },
    });
    if (!reserved.allowed) return { status: "DENIED", code: reserved.reason === "ENTITLEMENT_DISABLED" || reserved.reason === "UNKNOWN_CAPABILITY" ? "CAPABILITY_DISABLED" : "CAPABILITY_LIMIT_REACHED" };
    const eventId = reserved.result?.event_id;
    if (!eventId) throw new Error("METERING_FAILED");
    if (!reserved.result?.duplicate) return { status: "RESERVED", eventId };
    const existing = await this.usage.getUsageEvent(eventId);
    if (!existing) throw new Error("METERING_FAILED");
    const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata as Record<string, unknown> : {};
    const cached = metadata.cached_result && typeof metadata.cached_result === "object" ? metadata.cached_result as Record<string, unknown> : null;
    if (existing.state === "COMMITTED" && cached) return { status: "COMPLETED", eventId, cached };
    if (existing.state === "RESERVED") return { status: "IN_PROGRESS", eventId };
    return { status: "RELEASED", eventId };
  }

  markProviderStarted(eventId: string) {
    return this.usage.markProviderStarted(eventId);
  }

  async persistUsage(profileId: string, eventId: string, events: TechnicalUsage[]) {
    if (!events.length) return;
    const payload = events.map((event) => ({
      operation: event.operation,
      model: event.model,
      input_tokens: event.inputTokens,
      output_tokens: event.outputTokens,
      cost_usd: event.costUsd,
      metadata: { ...(event.metadata ?? {}), logical_usage_event_id: eventId, logical_capability: this.capability },
    }));
    await this.sql`
      insert into public.ai_usage_events (profile_id,operation,model,input_tokens,output_tokens,cost_usd,metadata)
      select ${profileId}::uuid, item->>'operation', item->>'model', nullif(item->>'input_tokens','')::integer,
             nullif(item->>'output_tokens','')::integer, nullif(item->>'cost_usd','')::numeric,
             coalesce(item->'metadata','{}'::jsonb)
      from jsonb_array_elements(${JSON.stringify(payload)}::jsonb) item
      where not exists (
        select 1 from public.ai_usage_events
        where profile_id=${profileId}::uuid and operation=item->>'operation'
          and metadata->>'logical_usage_event_id'=${eventId}
      )
    `;
    await this.usage.reconcileProviderCostAttempt(eventId);
  }

  async commit(eventId: string, cached: Record<string, unknown>) {
    await this.usage.mergeUsageEventMetadata(eventId, { execution_state: "OUTPUT_PERSISTED", cached_result: cached });
    await this.usage.commitUsage(eventId);
    await this.usage.mergeUsageEventMetadata(eventId, { execution_state: "COMMITTED" });
  }

  async release(eventId: string, reason: string) {
    await this.usage.mergeUsageEventMetadata(eventId, { execution_state: "RELEASED", release_reason: reason.slice(0, 200) }).catch(() => undefined);
    await this.usage.releaseUsage(eventId);
  }
}
