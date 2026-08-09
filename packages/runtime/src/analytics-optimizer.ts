export type AnalyticsMetric = 'impressions' | 'reach' | 'engagements' | 'clicks';

export interface ContentPerformanceSample {
  id: string;
  platform: 'facebook' | 'instagram' | 'linkedin' | 'google_business_profile';
  pillar: string;
  publishedAt: string;
  metrics: Partial<Record<AnalyticsMetric, number>>;
}

export interface AnalyticsOptimizationResult {
  status: 'insufficient_sample' | 'ready';
  observedPostCount: number;
  availableMetrics: AnalyticsMetric[];
  totalObservedImpressions?: number;
  bestPillar?: { pillar: string; score: number; sampleSize: number };
  weakestPillar?: { pillar: string; score: number; sampleSize: number };
  recommendations: string[];
  evidenceIds: string[];
}

export interface AnalyticsOptimizerConfig {
  minimumPosts: number;
  minimumObservedImpressions: number;
  primaryMetric: AnalyticsMetric;
}

const metricOrder: AnalyticsMetric[] = ['impressions', 'reach', 'engagements', 'clicks'];

const average = (values: number[]): number => values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export class EvidenceGatedAnalyticsOptimizer {
  constructor(private readonly config: AnalyticsOptimizerConfig) {
    if (!Number.isInteger(config.minimumPosts) || config.minimumPosts < 1) throw new Error('analytics_invalid_minimum_posts');
    if (!Number.isFinite(config.minimumObservedImpressions) || config.minimumObservedImpressions < 0) throw new Error('analytics_invalid_impression_threshold');
  }

  analyze(samples: ContentPerformanceSample[]): AnalyticsOptimizationResult {
    const valid = samples.filter((sample) => this.isValidSample(sample));
    const availableMetrics = metricOrder.filter((metric) => valid.some((sample) => sample.metrics[metric] !== undefined));
    const impressionsValues = valid.map((sample) => sample.metrics.impressions).filter((value): value is number => value !== undefined);
    const totalObservedImpressions = impressionsValues.length > 0 ? impressionsValues.reduce((sum, value) => sum + value, 0) : undefined;

    const base = {
      observedPostCount: valid.length,
      availableMetrics,
      ...(totalObservedImpressions !== undefined ? { totalObservedImpressions } : {}),
      evidenceIds: valid.map((sample) => sample.id),
    };

    const hasEnoughPosts = valid.length >= this.config.minimumPosts;
    const hasEnoughImpressions = totalObservedImpressions !== undefined && totalObservedImpressions >= this.config.minimumObservedImpressions;
    const hasPrimaryMetric = valid.some((sample) => sample.metrics[this.config.primaryMetric] !== undefined);

    if (!hasEnoughPosts || !hasEnoughImpressions || !hasPrimaryMetric) {
      return {
        status: 'insufficient_sample',
        ...base,
        recommendations: [
          `Raccogli almeno ${this.config.minimumPosts} post con dati osservati e ${this.config.minimumObservedImpressions} impression complessive prima di modificare automaticamente la strategia.`,
        ],
      };
    }

    const byPillar = new Map<string, { scores: number[]; sampleIds: string[] }>();
    for (const sample of valid) {
      const metric = sample.metrics[this.config.primaryMetric];
      if (metric === undefined) continue;
      const group = byPillar.get(sample.pillar) ?? { scores: [], sampleIds: [] };
      group.scores.push(metric);
      group.sampleIds.push(sample.id);
      byPillar.set(sample.pillar, group);
    }

    const ranked = [...byPillar.entries()]
      .map(([pillar, group]) => ({ pillar, score: average(group.scores), sampleSize: group.scores.length }))
      .sort((left, right) => right.score - left.score || right.sampleSize - left.sampleSize || left.pillar.localeCompare(right.pillar));

    const best = ranked[0];
    const weakest = ranked.at(-1);
    const recommendations: string[] = [];

    if (best && weakest && best.pillar !== weakest.pillar) {
      recommendations.push(`Mantieni o testa più contenuti nel pillar “${best.pillar}”: ha la media osservata più alta su ${this.config.primaryMetric}.`);
      recommendations.push(`Rivedi hook, formato o targeting del pillar “${weakest.pillar}” prima di ridurne la frequenza: il dato è associativo, non prova una causalità.`);
    } else if (best) {
      recommendations.push(`Il campione osservato è concentrato sul pillar “${best.pillar}”; aggiungi varietà prima di riallocare il mix editoriale.`);
    }

    return {
      status: 'ready',
      ...base,
      ...(best ? { bestPillar: best } : {}),
      ...(weakest ? { weakestPillar: weakest } : {}),
      recommendations,
    };
  }

  private isValidSample(sample: ContentPerformanceSample): boolean {
    if (!sample.id.trim() || !sample.pillar.trim() || !Number.isFinite(Date.parse(sample.publishedAt))) return false;
    return Object.values(sample.metrics).every((value) => value === undefined || (Number.isFinite(value) && value >= 0));
  }
}
