export type LearningProvider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";
export type LearningFormat = "POST" | "CAROUSEL" | "STORY" | string;

export type PerformanceSample = {
  profileId: string;
  provider: LearningProvider;
  format: LearningFormat;
  topic: string;
  publishedAt: string;
  metrics: Record<string, number | string | null | undefined>;
};

export type LearningDimension = "PROVIDER" | "FORMAT" | "TOPIC" | "WEEKDAY" | "HOUR";
export type LearningConfidence = "LOW" | "MEDIUM" | "HIGH";

export type LearningInsight = {
  profileId: string;
  dimension: LearningDimension;
  value: string;
  sampleSize: number;
  totalScorableSamples: number;
  baselineScore: number;
  segmentScore: number;
  upliftPct: number;
  confidence: LearningConfidence;
  recommendation: string;
  evidence: {
    metricBasis: "ENGAGEMENT_RATE" | "WEIGHTED_ENGAGEMENT_PER_EXPOSURE";
    observedFrom: string;
    observedTo: string;
  };
};

export type LearningResult = {
  profileId: string;
  totalInputSamples: number;
  profileSamples: number;
  scorableSamples: number;
  ignoredOtherProfiles: number;
  ignoredUnscorable: number;
  status: "READY" | "INSUFFICIENT_DATA";
  insights: LearningInsight[];
};

type ScoredSample = PerformanceSample & {
  score: number;
  basis: LearningInsight["evidence"]["metricBasis"];
  date: Date;
};

type Segment = {
  dimension: LearningDimension;
  value: string;
  samples: ScoredSample[];
};

const DEFAULT_MIN_TOTAL = 6;
const DEFAULT_MIN_SEGMENT = 3;
const DEFAULT_MIN_UPLIFT = 0.15;

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function metric(metrics: PerformanceSample["metrics"], ...names: string[]) {
  for (const name of names) {
    const value = finite(metrics[name]);
    if (value !== null) return value;
  }
  return null;
}

function explicitEngagementRate(metrics: PerformanceSample["metrics"]) {
  const raw = metric(metrics, "engagement_rate", "engagementRate", "engagement");
  if (raw === null || raw < 0) return null;
  if (raw <= 1) return raw;
  if (raw <= 100) return raw / 100;
  return null;
}

function weightedEngagement(metrics: PerformanceSample["metrics"]) {
  const reactions = metric(metrics, "reactions", "likes", "like_count") ?? 0;
  const comments = metric(metrics, "comments", "comment_count") ?? 0;
  const shares = metric(metrics, "shares", "reshares", "share_count") ?? 0;
  const saves = metric(metrics, "saves", "saved") ?? 0;
  const clicks = metric(metrics, "clicks", "link_clicks") ?? 0;
  return reactions + comments * 2 + shares * 3 + saves * 3 + clicks * 1.5;
}

function exposure(metrics: PerformanceSample["metrics"]) {
  const reach = metric(metrics, "reach", "members_reached", "post_impressions_unique");
  if (reach !== null && reach > 0) return reach;
  const impressions = metric(metrics, "impressions", "impression_count", "post_impressions");
  return impressions !== null && impressions > 0 ? impressions : null;
}

export function scorePerformanceSample(sample: PerformanceSample): { score: number; basis: ScoredSample["basis"] } | null {
  const direct = explicitEngagementRate(sample.metrics);
  if (direct !== null) return { score: Math.min(Math.max(direct, 0), 1), basis: "ENGAGEMENT_RATE" };
  const denominator = exposure(sample.metrics);
  if (denominator === null) return null;
  const numerator = weightedEngagement(sample.metrics);
  if (!Number.isFinite(numerator) || numerator < 0) return null;
  return { score: Math.min(numerator / denominator, 1), basis: "WEIGHTED_ENGAGEMENT_PER_EXPOSURE" };
}

function normalizedTopic(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function mean(samples: ScoredSample[]) {
  if (!samples.length) return 0;
  return samples.reduce((sum, sample) => sum + sample.score, 0) / samples.length;
}

function confidence(sampleSize: number, total: number, uplift: number): LearningConfidence {
  if (sampleSize >= 10 && total >= 20 && uplift >= 0.25) return "HIGH";
  if (sampleSize >= 5 && total >= 10 && uplift >= 0.18) return "MEDIUM";
  return "LOW";
}

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    weekday: parts.find((part) => part.type === "weekday")?.value ?? "",
    hour: parts.find((part) => part.type === "hour")?.value ?? "",
  };
}

function group(samples: ScoredSample[], dimension: LearningDimension, getter: (sample: ScoredSample) => string) {
  const map = new Map<string, ScoredSample[]>();
  for (const sample of samples) {
    const value = getter(sample).trim();
    if (!value) continue;
    const bucket = map.get(value) ?? [];
    bucket.push(sample);
    map.set(value, bucket);
  }
  return [...map.entries()].map(([value, segmentSamples]): Segment => ({ dimension, value, samples: segmentSamples }));
}

function recommendation(dimension: LearningDimension, value: string, upliftPct: number) {
  const pct = Math.round(upliftPct);
  if (dimension === "PROVIDER") return `Su ${value} i contenuti osservati rendono circa ${pct}% sopra la media del profilo. Mantieni o aumenta gradualmente i test su questo canale.`;
  if (dimension === "FORMAT") return `Il formato ${value} rende circa ${pct}% sopra la media del profilo. Provalo più spesso senza eliminare gli altri formati.`;
  if (dimension === "TOPIC") return `Il tema “${value}” rende circa ${pct}% sopra la media del profilo. Sviluppa nuovi angoli sullo stesso pilastro evitando duplicazioni.`;
  if (dimension === "WEEKDAY") return `${value} rende circa ${pct}% sopra la media del profilo. Dai priorità a questo giorno nei prossimi test, mantenendo un gruppo di confronto.`;
  return `La fascia delle ${value}:00 rende circa ${pct}% sopra la media del profilo. Testala più spesso mantenendo altri orari di confronto.`;
}

export function buildLearningInsights(
  profileId: string,
  input: PerformanceSample[],
  options: { timezone?: string; minTotalSamples?: number; minSegmentSamples?: number; minUplift?: number; maxInsights?: number } = {},
): LearningResult {
  const timezone = options.timezone ?? "Europe/Rome";
  const minTotal = Math.max(Math.floor(options.minTotalSamples ?? DEFAULT_MIN_TOTAL), 3);
  const minSegment = Math.max(Math.floor(options.minSegmentSamples ?? DEFAULT_MIN_SEGMENT), 2);
  const minUplift = Math.max(options.minUplift ?? DEFAULT_MIN_UPLIFT, 0.05);
  const maxInsights = Math.min(Math.max(Math.floor(options.maxInsights ?? 8), 1), 20);
  const own = input.filter((sample) => sample.profileId === profileId);
  const scored: ScoredSample[] = [];

  for (const sample of own) {
    const date = new Date(sample.publishedAt);
    if (Number.isNaN(date.getTime())) continue;
    const scoredValue = scorePerformanceSample(sample);
    if (!scoredValue) continue;
    scored.push({ ...sample, ...scoredValue, date });
  }

  const base: Omit<LearningResult, "status" | "insights"> = {
    profileId,
    totalInputSamples: input.length,
    profileSamples: own.length,
    scorableSamples: scored.length,
    ignoredOtherProfiles: input.length - own.length,
    ignoredUnscorable: own.length - scored.length,
  };
  if (scored.length < minTotal) return { ...base, status: "INSUFFICIENT_DATA", insights: [] };

  const baseline = mean(scored);
  if (baseline <= 0) return { ...base, status: "INSUFFICIENT_DATA", insights: [] };
  const segments: Segment[] = [
    ...group(scored, "PROVIDER", (sample) => sample.provider),
    ...group(scored, "FORMAT", (sample) => sample.format),
    ...group(scored, "TOPIC", (sample) => normalizedTopic(sample.topic)),
    ...group(scored, "WEEKDAY", (sample) => localParts(sample.date, timezone).weekday),
    ...group(scored, "HOUR", (sample) => localParts(sample.date, timezone).hour),
  ];

  const insights: LearningInsight[] = [];
  for (const segment of segments) {
    if (segment.samples.length < minSegment || segment.samples.length >= scored.length) continue;
    const segmentScore = mean(segment.samples);
    const uplift = segmentScore / baseline - 1;
    if (!Number.isFinite(uplift) || uplift < minUplift) continue;
    const sortedDates = segment.samples.map((sample) => sample.date.toISOString()).sort();
    const basisCounts = new Map<ScoredSample["basis"], number>();
    for (const sample of segment.samples) basisCounts.set(sample.basis, (basisCounts.get(sample.basis) ?? 0) + 1);
    const basis = [...basisCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "WEIGHTED_ENGAGEMENT_PER_EXPOSURE";
    insights.push({
      profileId,
      dimension: segment.dimension,
      value: segment.value,
      sampleSize: segment.samples.length,
      totalScorableSamples: scored.length,
      baselineScore: Number(baseline.toFixed(6)),
      segmentScore: Number(segmentScore.toFixed(6)),
      upliftPct: Number((uplift * 100).toFixed(1)),
      confidence: confidence(segment.samples.length, scored.length, uplift),
      recommendation: recommendation(segment.dimension, segment.value, uplift * 100),
      evidence: { metricBasis: basis, observedFrom: sortedDates[0], observedTo: sortedDates[sortedDates.length - 1] },
    });
  }

  insights.sort((a, b) => {
    const confidenceRank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
    return confidenceRank[b.confidence] - confidenceRank[a.confidence] || b.upliftPct - a.upliftPct || b.sampleSize - a.sampleSize;
  });

  return { ...base, status: insights.length ? "READY" : "INSUFFICIENT_DATA", insights: insights.slice(0, maxInsights) };
}
