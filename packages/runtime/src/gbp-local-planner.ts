export type GbpContentDecision = 'native_variant' | 'separate_concept' | 'skip';
export type GbpPostKind = 'standard' | 'event' | 'offer';

export interface GbpLocalContext {
  hasVerifiedLocation: boolean;
  locationName?: string;
  city?: string;
  localServices: string[];
  localAudience: string[];
}

export interface GbpConceptInput {
  topic: string;
  objective: string;
  ctaIntent: string;
  factualClaims: string[];
  hasLocalRelevance: boolean;
  hasDateBoundEvent: boolean;
  hasOfferTerms: boolean;
  requestedKind?: GbpPostKind;
}

export interface GbpContentPlan {
  decision: GbpContentDecision;
  kind?: GbpPostKind;
  reason: string;
  requiredFacts: string[];
  localAngle?: string;
  qualityWarnings: string[];
}

const includesLocalIntent = (value: string): boolean => /local|zona|citta|città|sede|visit|prenot|contatt|vicin|apert/i.test(value);

export class GbpLocalContentPlanner {
  plan(context: GbpLocalContext, concept: GbpConceptInput): GbpContentPlan {
    const qualityWarnings: string[] = [];

    if (!context.hasVerifiedLocation || !context.locationName?.trim()) {
      return {
        decision: 'skip',
        reason: 'Manca una location verificata nel contesto tenant: il canale locale viene saltato invece di inventare una presenza fisica.',
        requiredFacts: [],
        qualityWarnings: ['verified_location_missing'],
      };
    }

    const intentText = `${concept.objective} ${concept.ctaIntent} ${concept.topic}`;
    const localFit = concept.hasLocalRelevance || includesLocalIntent(intentText);
    const requiredFacts = [`location:${context.locationName}`];
    if (context.city?.trim()) requiredFacts.push(`city:${context.city}`);

    let kind: GbpPostKind = concept.requestedKind ?? 'standard';
    if (concept.hasDateBoundEvent) kind = 'event';
    if (concept.hasOfferTerms) kind = 'offer';

    if (kind === 'event' && !concept.hasDateBoundEvent) qualityWarnings.push('event_dates_missing');
    if (kind === 'offer' && !concept.hasOfferTerms) qualityWarnings.push('offer_terms_missing');

    if (qualityWarnings.length > 0) {
      return {
        decision: 'separate_concept',
        kind: 'standard',
        reason: 'Il formato richiesto non ha abbastanza fatti verificati; genera un contenuto locale standard separato invece di completare dati mancanti.',
        requiredFacts,
        localAngle: this.localAngle(context, concept),
        qualityWarnings,
      };
    }

    if (localFit) {
      return {
        decision: 'native_variant',
        kind,
        reason: 'Il concept ha rilevanza locale e può essere adattato mantenendo i fatti verificati della location.',
        requiredFacts,
        localAngle: this.localAngle(context, concept),
        qualityWarnings,
      };
    }

    const canCreateSeparateLocalConcept = context.localServices.length > 0 || context.localAudience.length > 0;
    if (canCreateSeparateLocalConcept) {
      return {
        decision: 'separate_concept',
        kind: 'standard',
        reason: 'Il concept principale non è locale, ma il tenant dispone di servizi o audience locali sufficienti per creare un contenuto GBP separato.',
        requiredFacts,
        localAngle: this.localAngle(context, concept),
        qualityWarnings,
      };
    }

    return {
      decision: 'skip',
      reason: 'Il concept non ha rilevanza locale e non esistono elementi tenant sufficienti per creare una variante utile senza forzature.',
      requiredFacts,
      qualityWarnings,
    };
  }

  private localAngle(context: GbpLocalContext, concept: GbpConceptInput): string {
    const service = context.localServices[0];
    const audience = context.localAudience[0];
    const pieces = [concept.topic, context.city ?? context.locationName, service, audience].filter((value): value is string => Boolean(value?.trim()));
    return pieces.join(' · ');
  }
}
