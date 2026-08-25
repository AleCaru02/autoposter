import { describe, expect, it } from 'vitest';
import { DeterministicAIOrchestratorMock } from '../src/ai-orchestrator-mock.js';

type BrandFixture = {
  brandName: string;
  industry: string;
  service: string;
  theme: string;
  differentiator: string;
  audience: string;
};

const fixtures: BrandFixture[] = [
  { brandName: 'Forno Vesuvio', industry: 'pizzeria', service: 'pizza napoletana', theme: 'impasto e maturazione', differentiator: 'fermentazione lunga e forno molto caldo', audience: 'famiglie e residenti' },
  { brandName: 'Lievito 24', industry: 'pizzeria', service: 'pizza contemporanea', theme: 'ingredienti stagionali', differentiator: 'menu che cambia con piccoli produttori locali', audience: 'food lover' },
  { brandName: 'Piazza Madre', industry: 'pizzeria', service: 'pizza da condividere', theme: 'serata in compagnia', differentiator: 'servizio rapido e tavolate informali', audience: 'gruppi di amici' },
  { brandName: 'Gestione Chiara', industry: 'property management', service: 'gestione affitti brevi', theme: 'redditività misurabile', differentiator: 'report mensile con costi e ricavi leggibili', audience: 'proprietari investitori' },
  { brandName: 'Ospitalità Locale', industry: 'property management', service: 'gestione casa vacanze', theme: 'esperienza ospite', differentiator: 'procedure operative e assistenza locale', audience: 'proprietari seconda casa' },
  { brandName: 'Yield Casa', industry: 'property management', service: 'ottimizzazione affitti', theme: 'pricing dinamico', differentiator: 'decisioni basate su domanda e calendario eventi', audience: 'proprietari orientati al rendimento' },
];

const contextFor = (fixture: BrandFixture, index: number) => ({
  tenantId: `tenant-${index}`,
  brand: {
    brandName: fixture.brandName,
    description: `${fixture.industry} demo`,
    industry: fixture.industry,
    locations: ['Milano'],
    audiences: [fixture.audience],
    services: [fixture.service],
    products: [],
    differentiators: [fixture.differentiator],
    valuePropositions: [fixture.differentiator],
    toneRules: ['chiaro', 'specifico'],
    bannedWords: ['migliore'],
    allowedClaims: [],
    forbiddenClaims: ['risultato garantito'],
    ctaPreferences: [`Scopri come ${fixture.service} può essere valutato`],
    palette: ['#ffffff'],
    contentThemes: [fixture.theme],
    lockedFacts: { sede: 'Milano' },
    sourceVersion: 1,
  },
  strategyVersion: 1,
  recentFingerprintIds: [],
  correlationId: `corr-${index}`,
});

const normalizeBeyondBrandName = (value: string, brandName: string): string => value
  .toLowerCase()
  .replaceAll(brandName.toLowerCase(), '<brand>')
  .replace(/\s+/g, ' ')
  .trim();

describe('anti-clone acceptance', () => {
  it('produces distinct topic, angle and Instagram copy across similar businesses', async () => {
    const orchestrator = new DeterministicAIOrchestratorMock();
    const signatures: string[] = [];

    for (const [index, fixture] of fixtures.entries()) {
      const context = contextFor(fixture, index);
      const concept = await orchestrator.generateCoreConcept(context);
      const [variant] = await orchestrator.generatePlatformVariants(context, concept, ['instagram']);
      expect(variant).toBeDefined();

      signatures.push(normalizeBeyondBrandName(
        `${concept.topic}|${concept.angle}|${variant!.hook}|${variant!.caption}|${variant!.cta}`,
        fixture.brandName,
      ));
    }

    expect(new Set(signatures).size).toBe(fixtures.length);
  });

  it('keeps the three pizzeria concepts and three property-manager concepts distinct within category', async () => {
    const orchestrator = new DeterministicAIOrchestratorMock();
    const concepts = await Promise.all(fixtures.map(async (fixture, index) => {
      const concept = await orchestrator.generateCoreConcept(contextFor(fixture, index));
      return `${concept.topic}|${concept.angle}|${concept.hookIntent}|${concept.ctaIntent}`;
    }));

    expect(new Set(concepts.slice(0, 3)).size).toBe(3);
    expect(new Set(concepts.slice(3, 6)).size).toBe(3);
  });
});
