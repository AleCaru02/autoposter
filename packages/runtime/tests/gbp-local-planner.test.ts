import { describe, expect, it } from 'vitest';
import { GbpLocalContentPlanner } from '../src/gbp-local-planner.js';

const planner = new GbpLocalContentPlanner();
const context = {
  hasVerifiedLocation: true,
  locationName: 'Demo Studio Milano Centro',
  city: 'Milano',
  localServices: ['consulenza'],
  localAudience: ['PMI locali'],
};

describe('GbpLocalContentPlanner', () => {
  it('skips GBP when no verified location exists', () => {
    const result = planner.plan(
      { hasVerifiedLocation: false, city: context.city, localServices: context.localServices, localAudience: context.localAudience },
      { topic: 'Consulenza', objective: 'lead', ctaIntent: 'Prenota', factualClaims: [], hasLocalRelevance: true, hasDateBoundEvent: false, hasOfferTerms: false },
    );
    expect(result.decision).toBe('skip');
    expect(result.qualityWarnings).toContain('verified_location_missing');
  });

  it('uses a native local variant when concept and CTA have local fit', () => {
    const result = planner.plan(context, { topic: 'Consulenza per attività di Milano', objective: 'local lead generation', ctaIntent: 'Prenota una visita', factualClaims: ['Sede Milano'], hasLocalRelevance: true, hasDateBoundEvent: false, hasOfferTerms: false });
    expect(result.decision).toBe('native_variant');
    expect(result.kind).toBe('standard');
    expect(result.requiredFacts).toEqual(expect.arrayContaining(['location:Demo Studio Milano Centro', 'city:Milano']));
  });

  it('creates a separate local concept when the main idea is non-local but tenant context is sufficient', () => {
    const result = planner.plan(context, { topic: 'Come organizzare un processo interno', objective: 'brand authority', ctaIntent: 'Leggi il metodo', factualClaims: [], hasLocalRelevance: false, hasDateBoundEvent: false, hasOfferTerms: false });
    expect(result.decision).toBe('separate_concept');
    expect(result.localAngle).toContain('Milano');
  });

  it('downgrades unsupported event/offer requests instead of inventing dates or terms', () => {
    const event = planner.plan(context, { topic: 'Incontro locale', objective: 'local awareness', ctaIntent: 'Partecipa', factualClaims: [], hasLocalRelevance: true, hasDateBoundEvent: false, hasOfferTerms: false, requestedKind: 'event' });
    expect(event.decision).toBe('separate_concept');
    expect(event.kind).toBe('standard');
    expect(event.qualityWarnings).toContain('event_dates_missing');
    const offer = planner.plan(context, { topic: 'Promozione locale', objective: 'local conversion', ctaIntent: 'Contattaci', factualClaims: [], hasLocalRelevance: true, hasDateBoundEvent: false, hasOfferTerms: false, requestedKind: 'offer' });
    expect(offer.qualityWarnings).toContain('offer_terms_missing');
  });

  it('selects event or offer only when supporting facts are present', () => {
    const event = planner.plan(context, { topic: 'Open day Milano', objective: 'local awareness', ctaIntent: 'Prenota visita', factualClaims: ['Data confermata'], hasLocalRelevance: true, hasDateBoundEvent: true, hasOfferTerms: false });
    expect(event.decision).toBe('native_variant');
    expect(event.kind).toBe('event');
    const offer = planner.plan(context, { topic: 'Offerta consulenza Milano', objective: 'local conversion', ctaIntent: 'Contattaci', factualClaims: ['Termini offerta confermati'], hasLocalRelevance: true, hasDateBoundEvent: false, hasOfferTerms: true });
    expect(offer.decision).toBe('native_variant');
    expect(offer.kind).toBe('offer');
  });
});
