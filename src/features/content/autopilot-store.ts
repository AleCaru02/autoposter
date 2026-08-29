import { neonClient } from "../../lib/neon-client";
import type { ApprovalMode } from "../../../api/_lib/autopilot";
import { normalizeEditorialResearchMode, type EditorialResearchMode } from "../../../api/_lib/editorial-research";

export type AutopilotSettings = {
  enabled: boolean;
  approvalMode: ApprovalMode;
  researchMode: EditorialResearchMode;
};

export type AutopilotSchedule = {
  provider: string;
  posts_per_week: number;
  enabled: boolean;
};

export type AutopilotOverview = {
  settings: AutopilotSettings;
  schedules: AutopilotSchedule[];
  inReview: number;
  upcoming: number;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseSettings(value: unknown): AutopilotSettings {
  const row = object(value);
  return {
    enabled: row.autopilotEnabled !== false,
    approvalMode: row.approvalMode === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL_REVIEW",
    researchMode: normalizeEditorialResearchMode(row.researchMode),
  };
}

export async function loadAutopilotOverview(profileId: string): Promise<AutopilotOverview> {
  const [strategy, schedules, review, upcoming] = await Promise.all([
    neonClient.from("content_strategies").select("platform_strategy").eq("profile_id", profileId).maybeSingle(),
    neonClient.from("schedules").select("provider,posts_per_week,enabled").eq("profile_id", profileId).order("provider", { ascending: true }),
    neonClient.from("content_items").select("id", { count: "exact", head: true }).eq("profile_id", profileId).eq("status", "IN_REVIEW"),
    neonClient.from("publication_jobs").select("id", { count: "exact", head: true }).eq("profile_id", profileId).gt("scheduled_at", new Date().toISOString()).in("state", ["SCHEDULED", "BLOCKED_APPROVAL", "QUEUED"]),
  ]);
  if (strategy.error) throw new Error(strategy.error.message);
  if (schedules.error) throw new Error(schedules.error.message);
  if (review.error) throw new Error(review.error.message);
  if (upcoming.error) throw new Error(upcoming.error.message);
  const strategyData = strategy.data as { platform_strategy?: unknown } | null;
  return {
    settings: parseSettings(strategyData?.platform_strategy),
    schedules: (schedules.data ?? []) as AutopilotSchedule[],
    inReview: review.count ?? 0,
    upcoming: upcoming.count ?? 0,
  };
}

export async function saveAutopilotSettings(profileId: string, settings: AutopilotSettings) {
  const current = await neonClient.from("content_strategies").select("profile_id,platform_strategy").eq("profile_id", profileId).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  const currentData = current.data as { profile_id?: string; platform_strategy?: unknown } | null;
  const platformStrategy = {
    ...object(currentData?.platform_strategy),
    autopilotEnabled: settings.enabled,
    approvalMode: settings.approvalMode,
    researchMode: normalizeEditorialResearchMode(settings.researchMode),
  };
  const payload = { platform_strategy: platformStrategy, updated_at: new Date().toISOString() };
  const write = currentData?.profile_id
    ? await neonClient.from("content_strategies").update(payload).eq("profile_id", profileId).select("profile_id")
    : await neonClient.from("content_strategies").insert({ profile_id: profileId, ...payload }).select("profile_id");
  if (write.error) throw new Error(write.error.message);
}