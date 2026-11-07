import { neonClient } from "../../lib/neon-client";
import type { ApprovalMode } from "../../../api/_lib/autopilot";
import { normalizeEditorialResearchMode, type EditorialResearchMode } from "../../../api/_lib/editorial-research";

export type AutopilotSettings = {
  enabled: boolean;
  approvalMode: ApprovalMode;
  researchMode: EditorialResearchMode;
  websitePilotEnabled: boolean;
};

export type AutopilotSchedule = {
  provider: string;
  posts_per_week: number;
  enabled: boolean;
};

export type EditorialPlanPreview = {
  generatedAt: string | null;
  items: Array<{dayOffset:number;provider:string;contentType:string;topicDirection:string;objective:string}>;
};
export type CompetitorOverview = {
  status: string;
  competitors: Array<{name:string;website:string;editorialOpportunity:string}>;
};
export type AutopilotOverview = {
  settings: AutopilotSettings;
  editorialPlan: EditorialPlanPreview | null;
  competitorResearch: CompetitorOverview;
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
    websitePilotEnabled: row.instagramWebsitePilot === true,
  };
}

export async function loadAutopilotOverview(profileId: string): Promise<AutopilotOverview> {
  const [strategy, schedules, review, upcoming] = await Promise.all([
    neonClient.from("content_strategies").select("platform_strategy").eq("profile_id", profileId).maybeSingle(),
    neonClient.from("schedules").select("provider,posts_per_week,enabled").eq("profile_id", profileId).order("provider", { ascending: true }),
    neonClient.from("content_items").select("id", { count: "exact", head: true }).eq("profile_id", profileId).eq("status", "IN_REVIEW"),
    neonClient.from("publication_jobs").select("id", { count: "exact", head: true }).eq("profile_id", profileId).gt("scheduled_at", new Date().toISOString()).in("state", ["SCHEDULED", "BLOCKED_APPROVAL", "QUEUED"]),
  ]);
  if (strategy.error || schedules.error || review.error || upcoming.error) {
    throw new Error("Impossibile caricare l’automazione contenuti. Riprova.");
  }
  const strategyData = strategy.data as { platform_strategy?: unknown } | null;
  const strategyOptions = object(strategyData?.platform_strategy);
  const storedPlan = object(strategyOptions.aiEditorialPlan);
  const storedStrategy = object(strategyOptions.aiStrategy);
  const research = object(storedStrategy.competitorResearch);
  const planItems = Array.isArray(storedPlan.items) ? storedPlan.items.flatMap((value) => {
    const item = object(value);
    if (!Number.isInteger(item.dayOffset) || typeof item.provider !== "string" ||
        typeof item.topicDirection !== "string" || !item.topicDirection.trim()) return [];
    return [{
      dayOffset: item.dayOffset as number,
      provider: item.provider as string,
      contentType: typeof item.contentType === "string" ? item.contentType : "SINGLE_POST",
      topicDirection: (item.topicDirection as string).trim(),
      objective: typeof item.objective === "string" ? item.objective : "",
    }];
  }).sort((a,b)=>a.dayOffset-b.dayOffset).slice(0,60) : [];
  const competitors = research.status === "VERIFIED_PUBLIC_SOURCES" && Array.isArray(research.competitors)
    ? research.competitors.flatMap(value => {
      const item = object(value);
      if (typeof item.name !== "string" || typeof item.website !== "string" ||
          !item.verifiedSource || typeof item.verifiedSource !== "string") return [];
      return [{
        name: item.name as string,
        website: item.website as string,
        editorialOpportunity: typeof item.editorialOpportunity === "string" ? item.editorialOpportunity : "",
      }];
    }).slice(0,4) : [];
  return {
    settings: parseSettings(strategyData?.platform_strategy),
    editorialPlan: planItems.length ? {
      generatedAt: typeof strategyOptions.aiEditorialPlanGeneratedAt === "string" ? strategyOptions.aiEditorialPlanGeneratedAt : null,
      items: planItems,
    } : null,
    competitorResearch: {
      status: typeof research.status === "string" ? research.status : "NOT_SEARCHED",
      competitors,
    },
    schedules: (schedules.data ?? []) as AutopilotSchedule[],
    inReview: review.count ?? 0,
    upcoming: upcoming.count ?? 0,
  };
}

export async function saveAutopilotSettings(profileId: string, settings: AutopilotSettings) {
  const current = await neonClient.from("content_strategies").select("profile_id,platform_strategy").eq("profile_id", profileId).maybeSingle();
  if (current.error) throw new Error("Impostazione non salvata. Riprova.");
  const currentData = current.data as { profile_id?: string; platform_strategy?: unknown } | null;
  const platformStrategy = {
    ...object(currentData?.platform_strategy),
    autopilotEnabled: settings.enabled,
    approvalMode: settings.approvalMode,
    researchMode: normalizeEditorialResearchMode(settings.researchMode),
    instagramWebsitePilot: settings.websitePilotEnabled,
  };
  const payload = { platform_strategy: platformStrategy, updated_at: new Date().toISOString() };
  const write = currentData?.profile_id
    ? await neonClient.from("content_strategies").update(payload).eq("profile_id", profileId).select("profile_id")
    : await neonClient.from("content_strategies").insert({ profile_id: profileId, ...payload }).select("profile_id");
  if (write.error) throw new Error("Impostazione non salvata. Riprova.");
}
