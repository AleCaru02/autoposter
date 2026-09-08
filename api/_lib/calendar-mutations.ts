import { neon } from "@neondatabase/serverless";
import { EntitlementUsageService } from "./entitlement-usage.js";

type Provider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";
type CalendarAction = "SAVE_SCHEDULE" | "CREATE_JOB" | "RESCHEDULE_JOB" | "REMOVE_JOB";

export type CalendarMutationInput = {
  action: CalendarAction;
  profileId: string;
  provider?: Provider;
  timezone?: string;
  postsPerWeek?: number;
  preferredSlots?: Array<{ day: number; time: string }>;
  autoChoose?: boolean;
  enabled?: boolean;
  variantId?: string;
  jobId?: string;
  scheduledAt?: string;
  expectedUpdatedAt?: string;
  operationId?: string;
};

type JobResult = { job_id: string; job_state: string; scheduled_at: string; updated_at: string; removed?: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION = /^[A-Za-z0-9_-]{16,80}$/;
const PROVIDERS = new Set<Provider>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);

function requiredUuid(value: unknown) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("CALENDAR_INPUT_INVALID");
  return value;
}

function requiredDate(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error("CALENDAR_INPUT_INVALID");
  return value;
}

function normalizeSlots(value: unknown) {
  if (!Array.isArray(value)) throw new Error("CALENDAR_INPUT_INVALID");
  const seen = new Set<string>();
  const slots: Array<{ day: number; time: string }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") throw new Error("CALENDAR_INPUT_INVALID");
    const day = Number((raw as { day?: unknown }).day);
    const time = String((raw as { time?: unknown }).time ?? "");
    if (!Number.isInteger(day) || day < 1 || day > 7 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("CALENDAR_INPUT_INVALID");
    const key = `${day}:${time}`;
    if (!seen.has(key)) slots.push({ day, time });
    seen.add(key);
  }
  return slots.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)).slice(0, 28);
}

function normalizeInput(raw: CalendarMutationInput) {
  if (!raw || typeof raw !== "object" || !["SAVE_SCHEDULE", "CREATE_JOB", "RESCHEDULE_JOB", "REMOVE_JOB"].includes(raw.action)) throw new Error("CALENDAR_INPUT_INVALID");
  const profileId = requiredUuid(raw.profileId);
  if (raw.action === "SAVE_SCHEDULE") {
    if (!PROVIDERS.has(raw.provider as Provider) || typeof raw.timezone !== "string" || raw.timezone.length > 100 || typeof raw.autoChoose !== "boolean" || typeof raw.enabled !== "boolean") throw new Error("CALENDAR_INPUT_INVALID");
    const postsPerWeek = Number(raw.postsPerWeek);
    if (!Number.isInteger(postsPerWeek) || postsPerWeek < 0 || postsPerWeek > 21) throw new Error("CALENDAR_INPUT_INVALID");
    return { action: raw.action, profileId, provider: raw.provider as Provider, timezone: raw.timezone, postsPerWeek, preferredSlots: normalizeSlots(raw.preferredSlots), autoChoose: raw.autoChoose, enabled: raw.enabled } as const;
  }
  if (raw.action === "CREATE_JOB") {
    if (typeof raw.operationId !== "string" || !OPERATION.test(raw.operationId)) throw new Error("OPERATION_ID_REQUIRED");
    return { action: raw.action, profileId, variantId: requiredUuid(raw.variantId), scheduledAt: requiredDate(raw.scheduledAt), operationId: raw.operationId } as const;
  }
  return {
    action: raw.action,
    profileId,
    jobId: requiredUuid(raw.jobId),
    expectedUpdatedAt: requiredDate(raw.expectedUpdatedAt),
    scheduledAt: raw.action === "RESCHEDULE_JOB" ? requiredDate(raw.scheduledAt) : null,
  } as const;
}

export async function mutateCalendar(databaseUrl: string, authUserId: string, raw: CalendarMutationInput) {
  if (!databaseUrl || !authUserId.trim()) throw new Error("CALENDAR_UNAUTHENTICATED");
  const input = normalizeInput(raw);
  const sql = neon(databaseUrl);

  if (input.action === "SAVE_SCHEDULE") {
    const rows = await sql`
      select schedule_id::text, updated_at::text
      from public.save_profile_schedule(
        ${authUserId}, ${input.profileId}::uuid, ${input.provider}, ${input.timezone}, ${input.postsPerWeek},
        ${JSON.stringify(input.preferredSlots)}::jsonb, ${input.autoChoose}, ${input.enabled}
      )
    ` as unknown as Array<{ schedule_id: string; updated_at: string }>;
    if (!rows[0]) throw new Error("CALENDAR_MUTATION_FAILED");
    return { action: input.action, scheduleId: rows[0].schedule_id, updatedAt: rows[0].updated_at };
  }

  if (input.action === "CREATE_JOB") {
    const usage = new EntitlementUsageService(databaseUrl);
    const operationKey = `calendar-create:v1:${input.profileId}:${input.operationId}`;
    const reserved = await usage.reserveUsage({
      profileId: input.profileId,
      capabilityKey: "schedule.job.create",
      quantity: 1,
      idempotencyKey: operationKey,
      source: "CUSTOMER_CALENDAR",
      referenceId: input.variantId,
      metadata: { logical_unit: 1, execution_state: "RESERVED", variant_id: input.variantId },
    });
    if (!reserved.allowed) throw new Error(reserved.reason === "ENTITLEMENT_DISABLED" ? "CAPABILITY_DISABLED" : "CAPABILITY_LIMIT_REACHED");
    const eventId = reserved.result?.event_id;
    if (!eventId) throw new Error("METERING_FAILED");
    if (reserved.result?.duplicate) {
      const event = await usage.getUsageEvent(eventId);
      if (event?.state === "RELEASED") throw new Error("METERING_FAILED");
    }
    try {
      const rows = await sql`
        select job_id::text, job_state, scheduled_at::text, updated_at::text
        from public.create_profile_calendar_job(
          ${authUserId}, ${input.profileId}::uuid, ${input.variantId}::uuid, ${input.scheduledAt}::timestamptz,
          ${input.operationId}, ${eventId}::uuid
        )
      ` as unknown as JobResult[];
      if (!rows[0]) throw new Error("CALENDAR_MUTATION_FAILED");
      return { action: input.action, jobId: rows[0].job_id, state: rows[0].job_state, scheduledAt: rows[0].scheduled_at, updatedAt: rows[0].updated_at };
    } catch (reason) {
      if (!reserved.result?.duplicate) await usage.releaseUsage(eventId).catch(() => undefined);
      throw reason;
    }
  }

  const rows = await sql`
    select job_id::text, job_state, scheduled_at::text, updated_at::text, removed
    from public.manage_profile_calendar_job(
      ${authUserId}, ${input.profileId}::uuid, ${input.jobId}::uuid, ${input.expectedUpdatedAt}::timestamptz,
      ${input.action === "RESCHEDULE_JOB" ? "RESCHEDULE" : "REMOVE"}, ${input.scheduledAt}::timestamptz
    )
  ` as unknown as JobResult[];
  if (!rows[0]) throw new Error("CALENDAR_MUTATION_FAILED");
  return { action: input.action, jobId: rows[0].job_id, state: rows[0].job_state, scheduledAt: rows[0].scheduled_at, updatedAt: rows[0].updated_at, removed: rows[0].removed === true };
}
