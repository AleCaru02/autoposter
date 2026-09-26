import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type PersistedLearningInsight = {
  profile_id: string;
  dimension: "PROVIDER" | "FORMAT" | "TOPIC" | "WEEKDAY" | "HOUR";
  dimension_value: string;
  sample_size: number;
  total_scorable_samples: number;
  uplift_pct: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  recommendation: string;
  metric_basis: string;
  observed_from: string;
  observed_to: string;
  generated_at: string;
  active: boolean;
};

export type LearningDecision = {
  dimension: PersistedLearningInsight["dimension"];
  value: string;
  confidence: "MEDIUM" | "HIGH";
  upliftPct: number;
  sampleSize: number;
  metricBasis: string;
  observedFrom: string;
  observedTo: string;
};

export type LearnedTimingPreference = {
  weekday: number | null;
  time: string | null;
  source: "LEARNING";
};

const confidenceRank = { HIGH: 2, MEDIUM: 1 } as const;

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function usableLearningDecisions(profileId: string, rows: PersistedLearningInsight[], max = 8): LearningDecision[] {
  return rows
    .filter((row) => row.profile_id === profileId && row.active)
    .filter((row): row is PersistedLearningInsight & { confidence: "MEDIUM" | "HIGH" } => row.confidence === "MEDIUM" || row.confidence === "HIGH")
    .filter((row) => row.sample_size >= 5 && row.total_scorable_samples >= 10 && row.uplift_pct >= 18)
    .map((row) => ({
      dimension: row.dimension,
      value: row.dimension_value.trim(),
      confidence: row.confidence,
      upliftPct: finite(row.uplift_pct) ?? 0,
      sampleSize: row.sample_size,
      metricBasis: row.metric_basis,
      observedFrom: row.observed_from,
      observedTo: row.observed_to,
    }))
    .filter((row) => Boolean(row.value))
    .sort((a, b) => confidenceRank[b.confidence] - confidenceRank[a.confidence] || b.upliftPct - a.upliftPct || b.sampleSize - a.sampleSize)
    .slice(0, Math.min(Math.max(max, 1), 20));
}

export function learningContext(profileId: string, rows: PersistedLearningInsight[]) {
  return usableLearningDecisions(profileId, rows).map((row) => ({
    dimension: row.dimension,
    value: row.value,
    confidence: row.confidence,
    upliftPct: row.upliftPct,
    sampleSize: row.sampleSize,
    metricBasis: row.metricBasis,
    observedFrom: row.observedFrom,
    observedTo: row.observedTo,
  }));
}

export function learnedFormatPreference(
  profileId: string,
  provider: SocialProvider,
  supported: SocialFormat[],
  rows: PersistedLearningInsight[],
): SocialFormat | null {
  const decisions = usableLearningDecisions(profileId, rows);
  const providerIsSupported = decisions.some((row) => row.dimension === "PROVIDER" && row.value === provider);
  const format = decisions.find((row) => row.dimension === "FORMAT" && supported.includes(row.value as SocialFormat));
  return providerIsSupported && format ? format.value as SocialFormat : null;
}

const WEEKDAY_NUMBER: Record<string, number> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

export function learnedTimingPreference(profileId: string, provider: SocialProvider, rows: PersistedLearningInsight[]): LearnedTimingPreference | null {
  const decisions = usableLearningDecisions(profileId, rows);
  if (!decisions.some((row) => row.dimension === "PROVIDER" && row.value === provider)) return null;
  const weekday = decisions.find((row) => row.dimension === "WEEKDAY");
  const hour = decisions.find((row) => row.dimension === "HOUR");
  const weekdayNumber = weekday ? WEEKDAY_NUMBER[weekday.value.trim().slice(0, 3).toLowerCase()] ?? null : null;
  const hourNumber = hour ? Number(hour.value) : Number.NaN;
  const time = Number.isInteger(hourNumber) && hourNumber >= 0 && hourNumber <= 23 ? `${String(hourNumber).padStart(2, "0")}:00` : null;
  return weekdayNumber || time ? { weekday: weekdayNumber, time, source: "LEARNING" } : null;
}

export function buildAutopilotLearningInstruction(profileId: string, provider: SocialProvider, rows: PersistedLearningInsight[]) {
  const decisions = usableLearningDecisions(profileId, rows).filter((row) =>
    row.dimension !== "PROVIDER" || row.value === provider,
  );
  if (!decisions.length) return null;
  const topic = decisions.find((row) => row.dimension === "TOPIC");
  const timing = decisions.find((row) => row.dimension === "WEEKDAY" || row.dimension === "HOUR");
  const evidence = decisions.slice(0, 4).map((row) =>
    `${row.dimension}=${row.value} (${row.confidence}, +${row.upliftPct}%, ${row.sampleSize} campioni)`,
  ).join("; ");
  return [
    "Applica soltanto gli apprendimenti seguenti, derivati da metriche provider reali e con confidenza sufficiente.",
    topic ? `Dai priorità a un nuovo angolo coerente con il tema performante “${topic.value}”, senza duplicare contenuti precedenti.` : null,
    timing ? `Il timing performante rilevato è ${timing.dimension}=${timing.value}; non trasformarlo in un fatto da citare nel copy.` : null,
    `Evidenza: ${evidence}.`,
  ].filter(Boolean).join(" ");
}
