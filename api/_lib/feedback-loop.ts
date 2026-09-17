import { buildLearningInsights, type LearningInsight, type LearningProvider, type PerformanceSample } from "./learning-engine.js";

export type MetricSnapshotRecord = {
  profile_id: string;
  provider: LearningProvider;
  external_post_id: string;
  format: string;
  topic: string;
  published_at: string;
  captured_at: string;
  metrics: Record<string, number | string | null | undefined>;
};

export type LearningInsightRecord = {
  profile_id: string;
  dimension: LearningInsight["dimension"];
  dimension_value: string;
  sample_size: number;
  total_scorable_samples: number;
  baseline_score: number;
  segment_score: number;
  uplift_pct: number;
  confidence: LearningInsight["confidence"];
  recommendation: string;
  metric_basis: LearningInsight["evidence"]["metricBasis"];
  observed_from: string;
  observed_to: string;
  generated_at: string;
  active: true;
};

function validIso(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}

export function snapshotsToPerformanceSamples(profileId: string, rows: MetricSnapshotRecord[]): PerformanceSample[] {
  const latestByRemotePost = new Map<string, MetricSnapshotRecord>();
  for (const row of rows
    .filter((row) => row.profile_id === profileId)
    .filter((row) => validIso(row.published_at))
    .filter((row) => validIso(row.captured_at))
    .filter((row) => row.external_post_id.trim().length > 0)
    .filter((row) => row.provider === "INSTAGRAM" || row.provider === "FACEBOOK" || row.provider === "LINKEDIN" || row.provider === "GBP")) {
    const key = `${row.provider}\u0000${row.external_post_id}`;
    const previous = latestByRemotePost.get(key);
    if (!previous || new Date(row.captured_at).getTime() > new Date(previous.captured_at).getTime()) latestByRemotePost.set(key, row);
  }
  return [...latestByRemotePost.values()]
    .map((row) => ({
      profileId: row.profile_id,
      provider: row.provider,
      format: row.format,
      topic: row.topic,
      publishedAt: row.published_at,
      metrics: row.metrics,
    }));
}

export function learningInsightsToRecords(insights: LearningInsight[], generatedAt = new Date().toISOString()): LearningInsightRecord[] {
  if (!validIso(generatedAt)) throw new Error("INVALID_GENERATED_AT");
  return insights.map((insight) => ({
    profile_id: insight.profileId,
    dimension: insight.dimension,
    dimension_value: insight.value,
    sample_size: insight.sampleSize,
    total_scorable_samples: insight.totalScorableSamples,
    baseline_score: insight.baselineScore,
    segment_score: insight.segmentScore,
    uplift_pct: insight.upliftPct,
    confidence: insight.confidence,
    recommendation: insight.recommendation,
    metric_basis: insight.evidence.metricBasis,
    observed_from: insight.evidence.observedFrom,
    observed_to: insight.evidence.observedTo,
    generated_at: generatedAt,
    active: true,
  }));
}

export function buildFeedbackLoopRecords(
  profileId: string,
  snapshots: MetricSnapshotRecord[],
  options: { timezone?: string; generatedAt?: string } = {},
) {
  const samples = snapshotsToPerformanceSamples(profileId, snapshots);
  const result = buildLearningInsights(profileId, samples, { timezone: options.timezone ?? "Europe/Rome" });
  return {
    result,
    records: learningInsightsToRecords(result.insights, options.generatedAt ?? new Date().toISOString()),
  };
}
