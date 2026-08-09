import { describe, expect, it } from 'vitest';
import { DeterministicAIOrchestratorMock, decidePlatformTreatment } from '../src/ai-orchestrator-mock.js';

const context = {
  tenantId: 'tenant-a',
  brand: {
    brandName: 'Demo Studio',
    description: 'Studio locale',
    industry: 'servizi professionali',
    locations: ['Milano'],
    audiences: ['PMI'],
    services: ['consulenza'],
    products: [],
    differentiators: ['analisi trasparente'],
    valuePropositions: ['decisioni migliori'],
    toneRules: ['chiaro'],
    bannedWords: [],
    allowedClaims: [],
    forbiddenClaims: [],
    ctaPreferences: ['Prenota una consulenza'],
    palette: ['#ffffff'],
    contentThemes: ['come valutare un servizio'],
    lockedFacts: { sede: 'Milano' },
    sourceVersion: 1,
  },
  strategyVersion: 1,
  recentFingerprintIds: [],
  correlationId: 'corr-a',
};

describe('DeterministicAIOrchestratorMock', () => {
  it('creates one core concept and channel-specific variants', async () => {
    const orchestrator = new DeterministicAIOrchestratorMock();
    const concept = await orchestrator.generateCoreConcept(context);
    const variants = await orchestrator.generatePlatformVariants(context, concept, [
      'instagram',
      'facebook',
      'linkedin',
      'google_business_profile',
    ]);

    expect(concept.factualClaims[0]?.confidence).toBe('confirmed');
    expect(variants).toHaveLength(4);
    expect(variants.find((variant) => variant.platform === 'google_business_profile')?.format).toBe('local_post');
    expect(variants.every((variant) => variant.caption.length > 0)).toBe(true);

    const score = await orchestrator.scoreAndValidate(context, concept, variants);
    expect(score.brandMatch).toBeGreaterThan(0.9);
    expect(score.factConfidence).toBeGreaterThan(0.9);
  });

  it('skips Google Business Profile when the tenant has no physical/local context', async () => {
    const orchestrator = new DeterministicAIOrchestratorMock();
    const noLocation = { ...context, brand: { ...context.brand, locations: [] } };
    const concept = await orchestrator.generateCoreConcept(noLocation);
    const variants = await orchestrator.generatePlatformVariants(noLocation, concept, ['google_business_profile']);
    expect(variants[0]?.decision).toBe('skip');
  });

  it('can choose a separate LinkedIn concept when the idea is not professionally aligned', () => {
    const casualContext = {
      ...context,
      brand: { ...context.brand, industry: 'gelateria artigianale' },
    };
    const concept = {
      topic: 'gusto del mese',
      angle: 'momento divertente con gli amici',
      objective: 'engagement consumer',
      pillarId: null,
      hookIntent: 'Il gusto che sorprende',
      ctaIntent: 'Passa a trovarci',
      factualClaims: [],
    };
    expect(decidePlatformTreatment('linkedin', casualContext, concept)).toBe('separate_concept');
  });
});
