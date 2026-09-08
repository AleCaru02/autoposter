import { neonClient } from "../../lib/neon-client";
import { authenticatedApiToken } from "../../lib/auth-token";
import {
  clampPostsPerWeek,
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
  next_attempt_at: string | null;
  failure_code: string | null;
  outcome_unknown: boolean;
  remote_post_id: string | null;
  published_at: string | null;
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

type CalendarMutationResponse = {
  action?: string;
  scheduleId?: string;
  jobId?: string;
  state?: string;
  scheduledAt?: string;
  updatedAt?: string;
  removed?: boolean;
  error?: string;
};

async function calendarMutation(body: Record<string, unknown>) {
  const token = await authenticatedApiToken();
  const response = await fetch("/api/calendar", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as CalendarMutationResponse;
  if (!response.ok) {
    if (response.status === 409) throw new Error(result.error === "GENERATION_IN_PROGRESS" ? "La programmazione è già in corso. Attendi qualche secondo." : "Il calendario è stato modificato in un’altra sessione. Aggiorna la pagina.");
    if (result.error === "CAPABILITY_LIMIT_REACHED") throw new Error("Hai raggiunto il limite mensile di programmazioni.");
    if (result.error === "CAPABILITY_DISABLED") throw new Error("La programmazione non è disponibile per questa attività.");
    if (result.error === "CALENDAR_SOCIAL_NOT_CONNECTED") throw new Error("Collega prima questo social nella sezione Social.");
    if (result.error === "CALENDAR_DUPLICATE_VARIANT") throw new Error("Questa variante è già presente nel calendario.");
    if (response.status === 401) throw new Error("Sessione non valida. Accedi di nuovo.");
    if (response.status === 403 || response.status === 404) throw new Error("Non puoi modificare questo calendario.");
    throw new Error("Operazione calendario non riuscita. Riprova.");
  }
  return result;
}

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
      .select("id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,next_attempt_at,failure_code,outcome_unknown,remote_post_id,published_at,last_error,created_at,updated_at")
      .eq("profile_id", profileId)
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
  const result = await calendarMutation({
    action: "SAVE_SCHEDULE",
    profileId: input.profileId,
    provider: input.provider,
    timezone: input.timezone,
    postsPerWeek: clampPostsPerWeek(input.postsPerWeek),
    preferredSlots: normalizePreferredSlots(input.preferredSlots),
    autoChoose: input.autoChoose,
    enabled: input.enabled,
  });
  if (!result.scheduleId) throw new Error("Frequenza non salvata. Riprova.");
  return result.scheduleId;
}

export async function createCalendarJob(input: {
  profileId: string;
  variantId: string;
  scheduledAt: string;
}) {
  const instant = new Date(input.scheduledAt);
  if (!Number.isFinite(instant.getTime()) || instant.getTime() <= Date.now() + 60_000) throw new Error("Scegli una data futura di almeno un minuto.");
  const operationId = crypto.randomUUID();
  const result = await calendarMutation({ action: "CREATE_JOB", profileId: input.profileId, variantId: input.variantId, scheduledAt: instant.toISOString(), operationId });
  if (!result.jobId) throw new Error("Impossibile programmare il contenuto.");
  return result.jobId;
}

export async function rescheduleCalendarJob(input: {
  profileId: string;
  jobId: string;
  scheduledAt: string;
  expectedUpdatedAt: string;
}) {
  const instant = new Date(input.scheduledAt);
  if (!Number.isFinite(instant.getTime()) || instant.getTime() <= Date.now() + 60_000) throw new Error("Scegli una data futura di almeno un minuto.");
  await calendarMutation({ action: "RESCHEDULE_JOB", profileId: input.profileId, jobId: input.jobId, scheduledAt: instant.toISOString(), expectedUpdatedAt: input.expectedUpdatedAt });
}

export async function removeCalendarJob(profileId: string, jobId: string, expectedUpdatedAt: string) {
  await calendarMutation({ action: "REMOVE_JOB", profileId, jobId, expectedUpdatedAt });
}
