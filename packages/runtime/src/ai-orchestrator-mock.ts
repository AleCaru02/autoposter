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

const platformDecision = (
  platform: SocialPlatform,
  context: GenerationContext,
  concept: CoreConcept,
): PlatformDecision => {
  if (platform === 'google_business_profile') {
    if (context.brand.locations.length === 0) return 'skip';
    return /local|lead|visit|prenot|contatt/i.test(`${concept.objective} ${concept.ctaIntent}`)
      ? 'native_variant'
      : 'separate_concept';
  }

  if (platform === 'linkedin') {
    return /b2b|autor|profession|azienda|business/i.test(
      `${concept.objective} ${context.brand.industry ?? ''} ${concept.angle}`,
    )
      ? 'native_variant'
      : 'separate_concept';
  }

  return 'native_variant';
};

const captionFor = (platform: SocialPlatform, context: GenerationContext, concept: CoreConcept): string => {
  const brand = context.brand.brandName;
  const service = first(context.brand.services, first(context.brand.products, concept.topic));
  const location = first(context.brand.locations, 'la tua zona');

  switch (platform) {
    case 'instagram':
      return `${concept.hookIntent}. ${brand} mostra un punto concreto su ${service}: ${concept.angle}.`;
    case 'facebook':
      return `${concept.hookIntent}. Per chi cerca ${service} a ${location}, ${brand} spiega ${concept.angle.toLowerCase()}.`;
    case 'linkedin':
      return `${concept.hookIntent}. Dal punto di vista professionale, ${brand} affronta ${concept.topic.toLowerCase()} con un focus su ${concept.angle.toLowerCase()}.`;
    case 'google_business_profile':
      return `${brand}: ${concept.topic}. ${concept.angle}. Disponibile a ${location}.`;
  }
};

export class DeterministicAIOrchestratorMock implements AIOrchestrator {
  async generateCoreConcept(context: GenerationContext): Promise<CoreConcept> {
    const theme = first(context.brand.contentThemes, first(context.brand.services, 'valore per il cliente'));
    const differentiator = first(context.brand.differentiators, 'un approccio chiaro e concreto');
    const cta = first(context.brand.ctaPreferences, 'Contattaci per saperne di più');

    return {
      topic: theme,
      angle: differentiator,
      objective: context.brand.locations.length > 0 ? 'local lead generation' : 'brand authority',
      pillarId: null,
      hookIntent: `Un modo concreto per capire ${theme.toLowerCase()}`,
      ctaIntent: cta,
      factualClaims: Object.entries(context.brand.lockedFacts).map(([key, value]) => ({
        claim: `${key}: ${String(value)}`,
        confidence: 'confirmed' as const,
        evidenceRefs: [`brand-lock:${key}`],
      })),
    };
  }

  async generatePlatformVariants(
    context: GenerationContext,
    concept: CoreConcept,
    platforms: SocialPlatform[],
  ): Promise<PostVariant[]> {
    return platforms.map((platform) => {
      const decision = platformDecision(platform, context, concept);
      const location = first(context.brand.locations, '');
      const base: PostVariant = {
        platform,
        decision,
        format: platform === 'google_business_profile' ? 'local_post' : 'single_image',
        hook: concept.hookIntent,
        caption: decision === 'skip' ? 'Canale non adatto a questo concept nel contesto corrente.' : captionFor(platform, context, concept),
        cta: decision === 'skip' ? '' : concept.ctaIntent,
        hashtags:
          platform === 'instagram'
            ? [`#${context.brand.brandName.replace(/\s+/g, '')}`, '#consigli', ...(location ? [`#${location.replace(/\s+/g, '')}`] : [])]
            : [],
        altText: decision === 'skip' ? '' : `Visual informativo di ${context.brand.brandName} dedicato a ${concept.topic}.`,
        visualBrief: {
          subject: concept.topic,
          angle: concept.angle,
          palette: context.brand.palette,
          useRealAssetFirst: true,
        },
        approvalMode: 'manual',
      };
      return base;
    });
  }

  async scoreAndValidate(
    context: GenerationContext,
    concept: CoreConcept,
    variants: PostVariant[],
  ): Promise<QualityScore> {
    const activeVariants = variants.filter((variant) => variant.decision !== 'skip');
    const platformFit = variants.length === 0 ? 0 : activeVariants.length / variants.length;
    const factConfidence = concept.factualClaims.some((claim) => claim.confidence === 'unknown') ? 0.55 : 0.95;
    const brandMatch = context.brand.brandName.trim().length > 0 ? 0.95 : 0.2;

    return {
      brandMatch,
      relevance: 0.9,
      novelty: 0.82,
      clarity: 0.9,
      platformFit,
      visualFit: 0.88,
      factConfidence,
      ctaQuality: activeVariants.some((variant) => (variant.cta ?? '').trim().length > 0) ? 0.9 : 0.6,
      duplicateRisk: 0.1,
      duplicateSignals: {
        exact: 0,
        normalized: 0.05,
        semantic: 0.1,
        topic: 0.1,
        hook: 0.05,
        visual: 0.05,
        sameTenant: context.recentFingerprintIds.length > 0 ? 0.1 : 0,
        crossTenantTemplate: 0,
      },
    };
  }
}

export { platformDecision as decidePlatformTreatment };
