import { neonClient } from "../../lib/neon-client";
import {
  clampPostsPerWeek,
  createCalendarIdempotencyKey,
  normalizePreferredSlots,
  type PreferredSlot,
  type SocialProvider,
} from "./calendar-workflow";

export type ScheduleRow = {
  id: string;
  profile_id: string;
  provider: SocialProvider;
  timezone: string;
  posts_per_week: number;
  preferred_slots: PreferredSlot[];
  auto_choose: boolean;
  enabled: boolean;
  updated_at: string;
};

export type CalendarVariantRow = {
  id: string;
  content_id: string;
  profile_id: string;
  provider: SocialProvider;
  format: string;
  hook: string | null;
  caption: string;
  approval_status: string;
  eligible: boolean;
};

export type CalendarJobRow = {
  id: string;
  profile_id: string;
  variant_id: string;
  provider: SocialProvider;
  state: "SCHEDULED" | "BLOCKED_APPROVAL" | string;
  scheduled_at: string;
  idempotency_key: string;
  attempt_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentTitleRow = {
  id: string;
  topic: string;
  title: string | null;
};

export type CalendarState = {
  schedules: ScheduleRow[];
  variants: CalendarVariantRow[];
  jobs: CalendarJobRow[];
  contentTitles: Record<string, string>;
};

export async function loadCalendarState(profileId: string): Promise<CalendarState> {
  const [scheduleResult, variantsResult, jobsResult] = await Promise.all([
    neonClient.from("schedules")
      .select("id,profile_id,provider,timezone,posts_per_week,preferred_slots,auto_choose,enabled,updated_at")
      .eq("profile_id", profileId)
      .not("provider", "is", null)
      .order("provider", { ascending: true }),
    neonClient.from("content_variants")
      .select("id,content_id,profile_id,provider,format,hook,caption,approval_status,eligible")
      .eq("profile_id", profileId)
      .eq("eligible", true)
      .order("updated_at", { ascending: false })
      .limit(200),
    neonClient.from("publication_jobs")
      .select("id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,last_error,created_at,updated_at")
      .eq("profile_id", profileId)
      .in("state", ["SCHEDULED", "BLOCKED_APPROVAL"])
      .order("scheduled_at", { ascending: true })
      .limit(200),
  ]);
  if (scheduleResult.error) throw new Error(scheduleResult.error.message);
  if (variantsResult.error) throw new Error(variantsResult.error.message);
  if (jobsResult.error) throw new Error(jobsResult.error.message);

  const schedules = (scheduleResult.data ?? []).map((row) => ({ ...row, preferred_slots: normalizePreferredSlots(row.preferred_slots) })) as ScheduleRow[];
  const variants = (variantsResult.data ?? []) as CalendarVariantRow[];
  const jobs = (jobsResult.data ?? []) as CalendarJobRow[];
  const contentIds = Array.from(new Set(variants.map((variant) => variant.content_id)));
  let contentTitles: Record<string, string> = {};
  if (contentIds.length) {
    const contentResult = await neonClient.from("content_items").select("id,topic,title").eq("profile_id", profileId).in("id", contentIds);
    if (contentResult.error) throw new Error(contentResult.error.message);
    contentTitles = Object.fromEntries(((contentResult.data ?? []) as ContentTitleRow[]).map((item) => [item.id, item.title || item.topic]));
  }
  return { schedules, variants, jobs, contentTitles };
}

export async function saveProviderSchedule(input: {
  profileId: string;
  provider: SocialProvider;
  timezone: string;
  postsPerWeek: number;
  preferredSlots: PreferredSlot[];
  autoChoose: boolean;
  enabled: boolean;
}) {
  const rowsResult = await neonClient.from("schedules").select("id").eq("profile_id", input.profileId).eq("provider", input.provider).limit(5);
  if (rowsResult.error) throw new Error(rowsResult.error.message);
  const existing = rowsResult.data ?? [];
  const payload = {
    timezone: input.timezone,
    posts_per_week: clampPostsPerWeek(input.postsPerWeek),
    preferred_slots: normalizePreferredSlots(input.preferredSlots),
    auto_choose: input.autoChoose,
    enabled: input.enabled,
    updated_at: new Date().toISOString(),
  };
  if (existing[0]?.id) {
    const update = await neonClient.from("schedules").update(payload).eq("id", existing[0].id).eq("profile_id", input.profileId).select("id").single();
    if (update.error) throw new Error(update.error.message);
    if (existing.length > 1) {
      const duplicates = existing.slice(1).map((row) => row.id);
      const cleanup = await neonClient.from("schedules").delete().eq("profile_id", input.profileId).in("id", duplicates);
      if (cleanup.error) throw new Error(cleanup.error.message);
    }
    return existing[0].id as string;
  }
  const insert = await neonClient.from("schedules").insert({ profile_id: input.profileId, provider: input.provider, ...payload }).select("id").single();
  if (insert.error || !insert.data) throw new Error(insert.error?.message ?? "Impossibile salvare la frequenza.");
  return insert.data.id as string;
}

export async function createCalendarJob(input: {
  profileId: string;
  variantId: string;
  scheduledAt: string;
}) {
  const instant = new Date(input.scheduledAt);
  if (!Number.isFinite(instant.getTime()) || instant.getTime() <= Date.now() + 60_000) throw new Error("Scegli una data futura di almeno un minuto.");
  const variantResult = await neonClient.from("content_variants")
    .select("id,profile_id,provider,approval_status,eligible")
    .eq("id", input.variantId)
    .eq("profile_id", input.profileId)
    .eq("approval_status", "APPROVED")
    .eq("eligible", true)
    .limit(1);
  if (variantResult.error) throw new Error(variantResult.error.message);
  const variant = variantResult.data?.[0];
  if (!variant?.provider) throw new Error("La variante deve essere idonea e approvata prima della programmazione.");

  const connection = await neonClient.from("social_connections")
    .select("id,status")
    .eq("profile_id", input.profileId)
    .eq("provider", variant.provider)
    .eq("status", "ACTIVE")
    .limit(1);
  if (connection.error) throw new Error(connection.error.message);
  if (!connection.data?.length) throw new Error("Collega prima questo social nella sezione Social.");

  const duplicate = await neonClient.from("publication_jobs")
    .select("id")
    .eq("profile_id", input.profileId)
    .eq("variant_id", input.variantId)
    .in("state", ["SCHEDULED", "BLOCKED_APPROVAL"])
    .limit(1);
  if (duplicate.error) throw new Error(duplicate.error.message);
  if (duplicate.data?.length) throw new Error("Questa variante è già presente nel calendario. Modifica o rimuovi la programmazione esistente.");

  const id = crypto.randomUUID();
  const result = await neonClient.from("publication_jobs").insert({
    id,
    profile_id: input.profileId,
    variant_id: input.variantId,
    provider: variant.provider,
    state: "SCHEDULED",
    scheduled_at: instant.toISOString(),
    idempotency_key: createCalendarIdempotencyKey(id),
    attempt_count: 0,
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (result.error || !result.data) throw new Error(result.error?.message ?? "Impossibile programmare il contenuto.");
  return result.data.id as string;
}

export async function rescheduleCalendarJob(input: {
  profileId: string;
  jobId: string;
  scheduledAt: string;
}) {
  const instant = new Date(input.scheduledAt);
  if (!Number.isFinite(instant.getTime()) || instant.getTime() <= Date.now() + 60_000) throw new Error("Scegli una data futura di almeno un minuto.");
  const result = await neonClient.from("publication_jobs")
    .update({ scheduled_at: instant.toISOString(), state: "SCHEDULED", updated_at: new Date().toISOString() })
    .eq("id", input.jobId)
    .eq("profile_id", input.profileId)
    .select("id")
    .single();
  if (result.error) throw new Error(result.error.message);
}

export async function removeCalendarJob(profileId: string, jobId: string) {
  const result = await neonClient.from("publication_jobs").delete().eq("id", jobId).eq("profile_id", profileId).select("id");
  if (result.error) throw new Error(result.error.message);
}
