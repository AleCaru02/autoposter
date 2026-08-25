import type {
  AIOrchestrator,
  CoreConcept,
  GenerationContext,
  PlatformDecision,
  PostVariant,
  QualityScore,
  SocialPlatform,
} from '@socialpilot/contracts';

const first = (values: string[], fallback: string): string => values[0] ?? fallback;
const stableIndex = (value: string, modulo: number): number => {
  if (modulo <= 1) return 0;
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return Math.abs(hash >>> 0) % modulo;
};
const pick = (values: string[], seed: string, fallback: string): string => values.length ? values[stableIndex(seed, values.length)]! : fallback;

const platformDecision = (platform: SocialPlatform, context: GenerationContext, concept: CoreConcept): PlatformDecision => {
  if (platform === 'google_business_profile') {
    if (context.brand.locations.length === 0) return 'skip';
    return /local|lead|visit|prenot|contatt/i.test(`${concept.objective} ${concept.ctaIntent}`) ? 'native_variant' : 'separate_concept';
  }
  if (platform === 'linkedin') {
    return /b2b|autor|profession|azienda|business/i.test(`${concept.objective} ${context.brand.industry ?? ''} ${concept.angle}`) ? 'native_variant' : 'separate_concept';
  }
  return 'native_variant';
};

const captionFor = (platform: SocialPlatform, context: GenerationContext, concept: CoreConcept): string => {
  const brand = context.brand.brandName;
  const service = first(context.brand.services, first(context.brand.products, concept.topic));
  const location = first(context.brand.locations, 'la tua zona');
  switch (platform) {
    case 'instagram': return `${concept.hookIntent}. ${brand} racconta ${concept.topic.toLowerCase()} partendo da ${concept.angle.toLowerCase()}. Un dettaglio concreto su ${service}, pensato per essere utile e visuale.`;
    case 'facebook': return `${concept.hookIntent}. Per la community che cerca ${service} a ${location}, ${brand} apre una conversazione su ${concept.topic.toLowerCase()}: ${concept.angle.toLowerCase()}.`;
    case 'linkedin': return `${concept.hookIntent}. In chiave professionale, ${brand} analizza ${concept.topic.toLowerCase()} attraverso ${concept.angle.toLowerCase()}, con un punto operativo applicabile.`;
    case 'google_business_profile': return `${brand} a ${location}: ${concept.topic}. ${concept.angle}. Un aggiornamento locale legato ai servizi disponibili e a un'azione concreta.`;
  }
};

const ctaFor = (platform: SocialPlatform, context: GenerationContext, concept: CoreConcept): string => {
  const preferred = concept.ctaIntent.trim();
  const location = first(context.brand.locations, '');
  if (platform === 'instagram') return /salva|condivid/i.test(preferred) ? preferred : `Salva il contenuto o ${preferred.charAt(0).toLowerCase()}${preferred.slice(1)}`;
  if (platform === 'facebook') return /scriv|comment|contatt/i.test(preferred) ? preferred : `Scrivici: ${preferred}`;
  if (platform === 'linkedin') return /approfond|confront|scopr/i.test(preferred) ? preferred : `Approfondisci il tema e ${preferred.charAt(0).toLowerCase()}${preferred.slice(1)}`;
  if (platform === 'google_business_profile') return /prenot|contatt|chiama|visita/i.test(preferred) ? preferred : `${location ? `A ${location}: ` : ''}contattaci per disponibilità e dettagli`;
  return preferred;
};

export class DeterministicAIOrchestratorMock implements AIOrchestrator {
  async generateCoreConcept(context: GenerationContext): Promise<CoreConcept> {
    const theme = first(context.brand.contentThemes, first(context.brand.services, 'valore per il cliente'));
    const differentiator = pick(context.brand.differentiators, `${context.tenantId}:${context.correlationId}:${theme}`, 'un approccio chiaro e concreto');
    const cta = pick(context.brand.ctaPreferences, `${context.correlationId}:${theme}:cta`, 'Contattaci per saperne di più');
    const hookPatterns = [
      `Cosa cambia davvero quando parliamo di ${theme.toLowerCase()}`,
      `Tre elementi da osservare su ${theme.toLowerCase()}`,
      `${theme}: il dettaglio che spesso viene trascurato`,
      `Prima di scegliere, valuta questo aspetto di ${theme.toLowerCase()}`,
      `Dietro ${theme.toLowerCase()}: metodo, esperienza e una scelta concreta`,
    ];
    const hookIntent = hookPatterns[stableIndex(`${context.tenantId}:${context.correlationId}:${theme}`, hookPatterns.length)]!;

    return {
      topic: theme,
      angle: differentiator,
      objective: context.brand.locations.length > 0 ? 'local lead generation' : 'brand authority',
      pillarId: null,
      hookIntent,
      ctaIntent: cta,
      factualClaims: Object.entries(context.brand.lockedFacts).map(([key, value]) => ({ claim: `${key}: ${String(value)}`, confidence: 'confirmed' as const, evidenceRefs: [`brand-lock:${key}`] })),
    };
  }

  async generatePlatformVariants(context: GenerationContext, concept: CoreConcept, platforms: SocialPlatform[]): Promise<PostVariant[]> {
    return platforms.map((platform) => {
      const decision = platformDecision(platform, context, concept);
      const location = first(context.brand.locations, '');
      const cta = decision === 'skip' ? '' : ctaFor(platform, context, concept);
      return {
        platform,
        decision,
        format: platform === 'google_business_profile' ? 'local_post' : platform === 'linkedin' ? 'professional_single_image' : 'single_image',
        hook: platform === 'linkedin' ? `${concept.hookIntent} — prospettiva professionale` : platform === 'google_business_profile' ? `${concept.topic} a ${location || 'livello locale'}` : concept.hookIntent,
        caption: decision === 'skip' ? 'Canale non adatto a questo concept nel contesto corrente.' : captionFor(platform, context, concept),
        cta,
        hashtags: platform === 'instagram' ? [`#${context.brand.brandName.replace(/\s+/g, '')}`, `#${concept.topic.replace(/[^\p{L}\p{N}]+/gu, '')}`, ...(location ? [`#${location.replace(/\s+/g, '')}`] : [])] : [],
        altText: decision === 'skip' ? '' : `Visual informativo di ${context.brand.brandName} dedicato a ${concept.topic}.`,
        visualBrief: {
          subject: concept.topic,
          angle: concept.angle,
          composition: platform === 'instagram' ? 'soggetto forte, dettaglio concreto, lettura immediata' : platform === 'linkedin' ? 'composizione editoriale professionale e pulita' : platform === 'facebook' ? 'scena autentica orientata alla community' : 'immagine reale dell’attività o del servizio locale',
          palette: context.brand.palette,
          useRealAssetFirst: true,
          variantSeed: `${context.tenantId}:${context.correlationId}:${platform}`,
        },
        approvalMode: 'manual',
      } satisfies PostVariant;
    });
  }

  async scoreAndValidate(context: GenerationContext, concept: CoreConcept, variants: PostVariant[]): Promise<QualityScore> {
    const activeVariants = variants.filter((variant) => variant.decision !== 'skip');
    const platformFit = variants.length === 0 ? 0 : activeVariants.length / variants.length;
    const factConfidence = concept.factualClaims.some((claim) => claim.confidence === 'unknown') ? 0.55 : 0.95;
    const brandMatch = context.brand.brandName.trim().length > 0 ? 0.95 : 0.2;
    return {
      brandMatch,
      relevance: 0.9,
      novelty: 0.86,
      clarity: 0.9,
      platformFit,
      visualFit: 0.9,
      factConfidence,
      ctaQuality: activeVariants.some((variant) => (variant.cta ?? '').trim().length > 0) ? 0.9 : 0.6,
      duplicateRisk: 0.1,
      duplicateSignals: { exact: 0, normalized: 0.05, semantic: 0.1, topic: 0.1, hook: 0.05, visual: 0.05, sameTenant: context.recentFingerprintIds.length > 0 ? 0.1 : 0, crossTenantTemplate: 0 },
    };
  }
}

export { platformDecision as decidePlatformTreatment };
