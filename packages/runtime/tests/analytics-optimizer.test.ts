import { describe, expect, it } from 'vitest';
import { EvidenceGatedAnalyticsOptimizer, type ContentPerformanceSample } from '../src/analytics-optimizer.js';

const optimizer = new EvidenceGatedAnalyticsOptimizer({
  minimumPosts: 5,
  minimumObservedImpressions: 1_000,
  primaryMetric: 'engagements',
});

const sample = (id: string, pillar: string, impressions: number, engagements: number): ContentPerformanceSample => ({
  id,
  platform: 'instagram',
  pillar,
  publishedAt: '2026-08-09T10:00:00.000Z',
  metrics: { impressions, engagements },
});

describe('EvidenceGatedAnalyticsOptimizer', () => {
  it('refuses strategy changes when the sample is too small', () => {
    const result = optimizer.analyze([
      sample('p1', 'education', 300, 40),
      sample('p2', 'authority', 400, 50),
    ]);

    expect(result.status).toBe('insufficient_sample');
    expect(result.bestPillar).toBeUndefined();
    expect(result.recommendations[0]).toContain('Raccogli almeno 5 post');
  });

  it('refuses optimization when impressions are unavailable even if other metrics exist', () => {
    const result = optimizer.analyze(Array.from({ length: 5 }, (_, index) => ({
      id: `p${index}`,
      platform: 'linkedin' as const,
      pillar: 'authority',
      publishedAt: '2026-08-09T10:00:00.000Z',
      metrics: { engagements: 20 + index },
    })));

    expect(result.status).toBe('insufficient_sample');
    expect(result.totalObservedImpressions).toBeUndefined();
  });

  it('ranks pillars only after thresholds are satisfied and keeps causal caveat', () => {
    const result = optimizer.analyze([
      sample('e1', 'education', 500, 80),
      sample('e2', 'education', 500, 70),
      sample('a1', 'authority', 400, 40),
      sample('a2', 'authority', 400, 35),
      sample('c1', 'conversion', 300, 20),
      sample('c2', 'conversion', 300, 25),
    ]);

    expect(result.status).toBe('ready');
    expect(result.bestPillar?.pillar).toBe('education');
    expect(result.weakestPillar?.pillar).toBe('conversion');
    expect(result.recommendations.join(' ')).toContain('non prova una causalità');
    expect(result.evidenceIds).toHaveLength(6);
  });

  it('uses only metrics actually present in the evidence', () => {
    const result = optimizer.analyze([
      sample('1', 'education', 250, 30),
      sample('2', 'education', 250, 35),
      sample('3', 'authority', 250, 20),
      sample('4', 'authority', 250, 15),
      sample('5', 'conversion', 250, 10),
    ]);

    expect(result.availableMetrics).toEqual(['impressions', 'engagements']);
    expect(result.availableMetrics).not.toContain('reach');
    expect(result.availableMetrics).not.toContain('clicks');
  });

  it('drops invalid negative metric samples instead of treating them as real evidence', () => {
    const result = optimizer.analyze([
      sample('valid', 'education', 1200, 100),
      {
        id: 'invalid',
        platform: 'facebook',
        pillar: 'authority',
        publishedAt: '2026-08-09T10:00:00.000Z',
        metrics: { impressions: -10, engagements: 999 },
      },
    ]);

    expect(result.observedPostCount).toBe(1);
    expect(result.evidenceIds).toEqual(['valid']);
  });
});
