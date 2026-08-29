import { mapContentTypeToSocialFormat, type ContentType, type EditorialIntent, type FunnelStage } from "./content-agents.js";
import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type PersistedPlanItem = { dayOffset: number; provider: SocialProvider; contentType: ContentType; intent: EditorialIntent; topicDirection: string; objective: string; funnelStage: FunnelStage };

function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export function persistedEditorialPlan(platformStrategy: unknown): PersistedPlanItem[] {
  const raw = object(object(platformStrategy).aiEditorialPlan).items;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is PersistedPlanItem => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return Number.isInteger(row.dayOffset) && typeof row.provider === "string" && typeof row.contentType === "string" && typeof row.intent === "string" && typeof row.topicDirection === "string" && Boolean(row.topicDirection) && typeof row.objective === "string" && typeof row.funnelStage === "string";
  });
}

export function selectPlanItem(platformStrategy: unknown, provider: SocialProvider, scheduledAt: string, now = new Date()): (PersistedPlanItem & { format: SocialFormat }) | null {
  const plan = persistedEditorialPlan(platformStrategy).filter((item) => item.provider === provider);
  if (!plan.length) return null;
  const targetOffset = Math.max(0, Math.round((new Date(scheduledAt).getTime() - now.getTime()) / 86_400_000));
  const chosen = [...plan].sort((a, b) => Math.abs(a.dayOffset - targetOffset) - Math.abs(b.dayOffset - targetOffset) || a.dayOffset - b.dayOffset)[0];
  if (!chosen) return null;
  return { ...chosen, format: mapContentTypeToSocialFormat(provider, chosen.contentType) };
}

export function buildPlanDrivenTopicRequest(item: PersistedPlanItem & { format: SocialFormat }, recentTopics: string[]) {
  return [
    `Segui il brief del Planner Agent: ${item.topicDirection}.`,
    `Intento editoriale: ${item.intent}. Funnel: ${item.funnelStage}. Obiettivo: ${item.objective}.`,
    `Tipo editoriale: ${item.contentType}; formato nativo richiesto: ${item.format}.`,
    "Non cambiare autonomamente il tema pianificato; sviluppalo con fatti verificabili e con adattamento nativo alla piattaforma.",
    recentTopics.length ? `Evita formulazioni e angoli già usati in questi temi recenti: ${recentTopics.join(" | ")}.` : "Evita formulazioni generiche o ripetitive.",
  ].join(" ");
}
