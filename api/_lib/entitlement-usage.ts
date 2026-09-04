import { neon } from "@neondatabase/serverless";
import {
  CAPABILITY_REGISTRY,
  capabilityDefinition,
  capabilityOrNull,
  type CapabilityKey,
  type CapabilityLimitType,
} from "./capabilities.js";

export type UsagePeriodType = "NONE" | "DAY" | "MONTH" | "CUSTOM";

export type EntitlementRow = {
  profile_id: string;
  capability_key: string;
  enabled: boolean;
  limit_type: CapabilityLimitType;
  limit_value: number | string | null;
  period_type: UsagePeriodType;
  source: string;
  starts_at: string | null;
  ends_at: string | null;
  metadata?: unknown;
};

export type ResolvedEntitlement = {
  capabilityKey: CapabilityKey;
  classification: (typeof CAPABILITY_REGISTRY)[CapabilityKey]["classification"];
  enabled: boolean;
  limitType: CapabilityLimitType;
  limitValue: number | null;
  periodType: UsagePeriodType;
  source: "CORE_DEFAULT" | string;
  startsAt: string | null;
  endsAt: string | null;
};

export type UsageSnapshot = {
  committed: number;
  reserved: number;
  used: number;
  remaining: number | null;
  periodStart: string;
  periodEnd: string;
};

function finiteOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function periodBounds(periodType: UsagePeriodType, now = new Date(), custom?: { start: Date; end: Date }) {
  if (periodType === "CUSTOM") {
    if (!custom || custom.end <= custom.start) throw new Error("CUSTOM_PERIOD_REQUIRED");
    return { start: custom.start.toISOString(), end: custom.end.toISOString() };
  }
  if (periodType === "DAY") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString() };
  }
  if (periodType === "MONTH") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start: start.toISOString(), end: end.toISOString() };
  }
  const start = new Date(0);
  const end = new Date("9999-12-31T23:59:59.999Z");
  return { start: start.toISOString(), end: end.toISOString() };
}

function activeAt(row: EntitlementRow, now: Date) {
  if (row.starts_at && new Date(row.starts_at) > now) return false;
  if (row.ends_at && new Date(row.ends_at) <= now) return false;
  return true;
}

export function resolveEntitlement(capabilityKey: string, row: EntitlementRow | null, now = new Date()): ResolvedEntitlement | null {
  const definition = capabilityOrNull(capabilityKey);
  if (!definition) return null;
  const key = definition.key as CapabilityKey;

  if (definition.classification === "ADMIN_ONLY" || definition.classification === "INTERNAL" || definition.classification === "NOT_READY") {
    return {
      capabilityKey: key,
      classification: definition.classification,
      enabled: false,
      limitType: definition.limitType,
      limitValue: null,
      periodType: "NONE",
      source: definition.classification,
      startsAt: null,
      endsAt: null,
    };
  }

  if (definition.classification === "CORE_ALL_PLANS") {
    return {
      capabilityKey: key,
      classification: definition.classification,
      enabled: true,
      limitType: definition.limitType,
      limitValue: null,
      periodType: "NONE",
      source: "CORE_DEFAULT",
      startsAt: null,
      endsAt: null,
    };
  }

  if (!row || row.capability_key !== capabilityKey || !activeAt(row, now)) {
    return {
      capabilityKey: key,
      classification: definition.classification,
      enabled: false,
      limitType: definition.limitType,
      limitValue: null,
      periodType: definition.limitType === "COUNT_PER_DAY" ? "DAY" : definition.limitType === "COUNT_PER_MONTH" ? "MONTH" : "NONE",
      source: "MISSING_ENTITLEMENT",
      startsAt: null,
      endsAt: null,
    };
  }

  return {
    capabilityKey: key,
    classification: definition.classification,
    enabled: row.enabled,
    limitType: row.limit_type,
    limitValue: row.limit_type === "UNLIMITED" ? null : finiteOrNull(row.limit_value),
    periodType: row.period_type,
    source: row.source,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

export function usageAllowed(entitlement: ResolvedEntitlement | null, used: number, requested = 1) {
  if (!entitlement?.enabled || requested <= 0) return false;
  if (entitlement.limitType === "UNLIMITED" || entitlement.limitValue === null) return true;
  return used + requested <= entitlement.limitValue;
}

type Sql = ReturnType<typeof neon>;

type UsageBucketRow = {
  committed_quantity: number | string;
  reserved_quantity: number | string;
};

type ReserveRow = {
  allowed: boolean;
  duplicate: boolean;
  event_id: string | null;
  committed: number | string;
  reserved: number | string;
  remaining: number | string | null;
};

export class EntitlementUsageService {
  private readonly sql: Sql;

  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
    this.sql = neon(databaseUrl);
  }

  async getEntitlement(profileId: string, capabilityKey: string, now = new Date()) {
    const definition = capabilityOrNull(capabilityKey);
    if (!definition) return null;

    const rows = await this.sql`
      select profile_id, capability_key, enabled, limit_type, limit_value, period_type, source,
             starts_at, ends_at, metadata
      from public.profile_entitlements
      where profile_id=${profileId}::uuid and capability_key=${capabilityKey}
      limit 1
    ` as unknown as EntitlementRow[];
    return resolveEntitlement(capabilityKey, rows[0] ?? null, now);
  }

  async getUsage(profileId: string, capabilityKey: CapabilityKey, now = new Date()): Promise<UsageSnapshot | null> {
    const entitlement = await this.getEntitlement(profileId, capabilityKey, now);
    if (!entitlement?.enabled) return null;
    const period = periodBounds(entitlement.periodType, now);
    const rows = await this.sql`
      select committed_quantity, reserved_quantity
      from public.capability_usage_buckets
      where profile_id=${profileId}::uuid
        and capability_key=${capabilityKey}
        and period_start=${period.start}::timestamptz
        and period_end=${period.end}::timestamptz
      limit 1
    ` as unknown as UsageBucketRow[];
    const committed = finiteOrNull(rows[0]?.committed_quantity) ?? 0;
    const reserved = finiteOrNull(rows[0]?.reserved_quantity) ?? 0;
    const used = committed + reserved;
    return {
      committed,
      reserved,
      used,
      remaining: entitlement.limitValue === null ? null : Math.max(entitlement.limitValue - used, 0),
      periodStart: period.start,
      periodEnd: period.end,
    };
  }

  async canUseCapability(profileId: string, capabilityKey: string, amount = 1, now = new Date()) {
    const entitlement = await this.getEntitlement(profileId, capabilityKey, now);
    if (!entitlement) return { allowed: false, reason: "UNKNOWN_CAPABILITY", entitlement: null, usage: null } as const;
    if (!entitlement.enabled) return { allowed: false, reason: "ENTITLEMENT_DISABLED", entitlement, usage: null } as const;
    if (entitlement.limitType === "UNLIMITED" || entitlement.limitValue === null) {
      return { allowed: true, reason: null, entitlement, usage: null } as const;
    }
    const usage = await this.getUsage(profileId, entitlement.capabilityKey, now);
    return {
      allowed: usageAllowed(entitlement, usage?.used ?? 0, amount),
      reason: usageAllowed(entitlement, usage?.used ?? 0, amount) ? null : "USAGE_LIMIT_REACHED",
      entitlement,
      usage,
    } as const;
  }

  async reserveUsage(input: {
    profileId: string;
    capabilityKey: CapabilityKey;
    quantity?: number;
    idempotencyKey: string;
    source?: string;
    referenceId?: string | null;
    metadata?: Record<string, unknown>;
    now?: Date;
  }) {
    const quantity = input.quantity ?? 1;
    const now = input.now ?? new Date();
    const entitlement = await this.getEntitlement(input.profileId, input.capabilityKey, now);
    if (!entitlement?.enabled) return { allowed: false, reason: entitlement ? "ENTITLEMENT_DISABLED" : "UNKNOWN_CAPABILITY" } as const;
    const period = periodBounds(entitlement.periodType, now);
    const rows = await this.sql`
      select * from public.reserve_capability_usage(
        ${input.profileId}::uuid,
        ${input.capabilityKey},
        ${quantity}::numeric,
        ${entitlement.limitValue}::numeric,
        ${period.start}::timestamptz,
        ${period.end}::timestamptz,
        ${input.idempotencyKey},
        ${input.source ?? "APPLICATION"},
        ${input.referenceId ?? null},
        ${JSON.stringify(input.metadata ?? {})}::jsonb
      )
    ` as unknown as ReserveRow[];
    const result = rows[0];
    if (!result?.allowed) return { allowed: false, reason: "USAGE_LIMIT_REACHED", result: result ?? null } as const;
    return { allowed: true, reason: null, result } as const;
  }

  async commitUsage(eventId: string) {
    const rows = await this.sql`select (public.commit_capability_usage(${eventId}::uuid)).*`;
    return rows[0] ?? null;
  }

  async releaseUsage(eventId: string) {
    const rows = await this.sql`select (public.release_capability_usage(${eventId}::uuid)).*`;
    return rows[0] ?? null;
  }

  async getUsageEvent(eventId: string) {
    const rows = await this.sql`
      select id, profile_id, capability_key, state, idempotency_key, metadata
      from public.capability_usage_events
      where id=${eventId}::uuid
      limit 1
    ` as unknown as Array<{ id: string; profile_id: string; capability_key: string; state: "RESERVED"|"COMMITTED"|"RELEASED"; idempotency_key: string; metadata: unknown }>;
    return rows[0] ?? null;
  }

  async mergeUsageEventMetadata(eventId: string, patch: Record<string, unknown>) {
    const rows = await this.sql`
      update public.capability_usage_events
      set metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
      where id=${eventId}::uuid
      returning id, state, metadata
    ` as unknown as Array<{ id: string; state: "RESERVED"|"COMMITTED"|"RELEASED"; metadata: unknown }>;
    return rows[0] ?? null;
  }
}

export function defaultEntitlementFor(key: CapabilityKey) {
  return resolveEntitlement(key, null);
}

export function requireCommercialAssignableCapability(key: string): CapabilityKey {
  const definition = capabilityOrNull(key);
  if (!definition) throw new Error("UNKNOWN_CAPABILITY");
  if (definition.classification === "NOT_READY") throw new Error("CAPABILITY_NOT_READY");
  if (definition.classification === "ADMIN_ONLY") throw new Error("CAPABILITY_ADMIN_ONLY");
  if (definition.classification === "INTERNAL") throw new Error("CAPABILITY_INTERNAL");
  return definition.key as CapabilityKey;
}

export function registryDefinition(key: CapabilityKey) {
  return capabilityDefinition(key);
}
