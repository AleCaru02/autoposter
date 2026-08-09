import { describe, expect, it } from 'vitest';
import { DeterministicStrategyPlannerMock } from '../src/strategy-planner-mock.js';

const planner = new DeterministicStrategyPlannerMock();

const base = {
  tenantId: 'tenant-a',
  brandName: 'Brand A',
  selectedPlatforms: ['instagram','facebook','linkedin','google_business_profile'] as const,
  postsPerWeek: 3,
  goals: ['lead','notorietà'],
  target: ['clienti locali'],
  services: ['servizio principale'],
  differentiators: ['metodo trasparente'],
};

describe('DeterministicStrategyPlannerMock', () => {
  it('adapts pillars and topic seeds across sectors', () => {
    const pizza = planner.plan({ ...base, industry: 'Pizzeria', services: ['pizza napoletana'] });
    const property = planner.plan({ ...base, tenantId: 'tenant-b', brandName: 'PM B', industry: 'Property management', services: ['gestione affitti brevi'] });
    const networker = planner.plan({ ...base, tenantId: 'tenant-c', brandName: 'Network C', industry: 'Networker', services: ['formazione community'] });
    const local = planner.plan({ ...base, tenantId: 'tenant-d', brandName: 'Local D', industry: 'Servizi locali', services: ['assistenza locale'] });

    expect(pizza.pillars.map((pillar) => pillar.name)).not.toEqual(property.pillars.map((pillar) => pillar.name));
    expect(property.pillars.map((pillar) => pillar.name)).not.toEqual(networker.pillars.map((pillar) => pillar.name));
    expect(local.pillars.some((pillar) => pillar.name.includes('Presenza locale'))).toBe(true);
    expect(pizza.pillars.flatMap((pillar) => pillar.topicSeeds).join(' ')).toContain('pizza napoletana');
  });

  it('keeps GBP only on locally appropriate pillars', () => {
    const strategy = planner.plan({ ...base, industry: 'Property Manager', location: 'Milano' });
    const gbpPillars = strategy.pillars.filter((pillar) => pillar.platforms.includes('google_business_profile'));
    expect(gbpPillars.length).toBeGreaterThan(0);
    expect(gbpPillars.every((pillar) => ['lead','locale','territorio','conversione'].includes(pillar.key))).toBe(true);
  });

  it('builds 3 posts per week for four weeks with varied pillars/platforms', () => {
    const strategy = planner.plan({ ...base, industry: 'Pizzeria', preferredDays: [1,3,5], preferredTimes: ['09:30','18:00'] });
    const calendar = planner.buildCalendar({ strategy, startDate: '2026-08-10T00:00:00.000Z', weeks: 4 });
    expect(calendar).toHaveLength(12);
    expect(new Set(calendar.map((slot) => slot.pillarKey)).size).toBeGreaterThan(1);
    expect(new Set(calendar.map((slot) => slot.platform)).size).toBeGreaterThan(1);
    expect(calendar.every((slot) => slot.status === 'idea')).toBe(true);
  });

  it('does not reuse editorial-memory topics when alternatives exist', () => {
    const strategy = planner.plan({ ...base, industry: 'Pizzeria', services: ['pizza napoletana'], editorialMemoryTopics: ['pizza napoletana','impasto'] });
    expect(strategy.pillars.flatMap((pillar) => pillar.topicSeeds)).not.toContain('pizza napoletana');
    expect(strategy.pillars.flatMap((pillar) => pillar.topicSeeds)).not.toContain('impasto');
  });
});
