import { z } from 'zod';

export const socialPlatforms = ['facebook', 'instagram', 'linkedin', 'google_business_profile'] as const;
export const SocialPlatformSchema = z.enum(socialPlatforms);
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

export const ApprovalModeSchema = z.enum(['auto', 'manual']);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const FactConfidenceSchema = z.enum(['confirmed', 'inferred', 'unknown']);
export type FactConfidence = z.infer<typeof FactConfidenceSchema>;

export const PostStatusSchema = z.enum([
  'idea','generating','draft','qa','ready','awaiting_approval','approved','scheduled','publishing','published','failed','rejected','needs_review',
]);
export type PostStatus = z.infer<typeof PostStatusSchema>;

export const PlatformDecisionSchema = z.enum(['native_variant', 'separate_concept', 'skip']);
export type PlatformDecision = z.infer<typeof PlatformDecisionSchema>;

export const QualityScoreSchema = z.object({
  brandMatch: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  clarity: z.number().min(0).max(1),
  platformFit: z.number().min(0).max(1),
  visualFit: z.number().min(0).max(1),
  factConfidence: z.number().min(0).max(1),
  ctaQuality: z.number().min(0).max(1),
  duplicateRisk: z.number().min(0).max(1),
  duplicateSignals: z.object({
    exact: z.number().min(0).max(1), normalized: z.number().min(0).max(1), semantic: z.number().min(0).max(1), topic: z.number().min(0).max(1), hook: z.number().min(0).max(1), visual: z.number().min(0).max(1), sameTenant: z.number().min(0).max(1), crossTenantTemplate: z.number().min(0).max(1),
  }),
});
export type QualityScore = z.infer<typeof QualityScoreSchema>;

export const BrandContextCompactSchema = z.object({
  brandName:z.string(),description:z.string().optional(),industry:z.string().optional(),locations:z.array(z.string()).default([]),audiences:z.array(z.string()).default([]),services:z.array(z.string()).default([]),products:z.array(z.string()).default([]),differentiators:z.array(z.string()).default([]),valuePropositions:z.array(z.string()).default([]),toneRules:z.array(z.string()).default([]),bannedWords:z.array(z.string()).default([]),allowedClaims:z.array(z.string()).default([]),forbiddenClaims:z.array(z.string()).default([]),ctaPreferences:z.array(z.string()).default([]),palette:z.array(z.string()).default([]),contentThemes:z.array(z.string()).default([]),lockedFacts:z.record(z.string(),z.unknown()).default({}),sourceVersion:z.number().int().positive(),estimatedTokens:z.number().int().nonnegative().optional(),
});
export type BrandContextCompact = z.infer<typeof BrandContextCompactSchema>;

export const CoreConceptSchema = z.object({
  topic:z.string(),angle:z.string(),objective:z.string(),pillarId:z.string().uuid().nullable(),hookIntent:z.string(),ctaIntent:z.string(),factualClaims:z.array(z.object({claim:z.string(),confidence:FactConfidenceSchema,evidenceRefs:z.array(z.string()).default([])})).default([]),
});
export type CoreConcept = z.infer<typeof CoreConceptSchema>;

export const PostVariantSchema = z.object({
  platform:SocialPlatformSchema,decision:PlatformDecisionSchema,format:z.string(),hook:z.string(),caption:z.string(),cta:z.string().optional(),hashtags:z.array(z.string()).default([]),altText:z.string().optional(),visualBrief:z.record(z.string(),z.unknown()).default({}),approvalMode:ApprovalModeSchema,
});
export type PostVariant = z.infer<typeof PostVariantSchema>;

export const FeatureFlagKeySchema = z.enum([
  'autoPublishing','meta','linkedin','googleBusinessProfile','telegram','aiImagery','competitorResearch','advancedAnalytics','billing',
  'openaiLive','metaLive','linkedinLive','googleBusinessProfileLive','telegramLive','stripeLive','realAnalytics','imageGenerationLive',
]);
export type FeatureFlagKey = z.infer<typeof FeatureFlagKeySchema>;

export interface ModelRoute { task:string; tier:'simple'|'medium'|'complex'|'image'|'embedding'; modelConfigKey:string; fallbackConfigKey?:string; webSearchAllowed:boolean; imageGenerationAllowed:boolean; }
export interface ModelRouter { resolve(task:string,context:{risk:'low'|'medium'|'high';budgetRemainingMicrounits?:number}):Promise<ModelRoute>; }
export interface GenerationContext { tenantId:string;brand:BrandContextCompact;strategyVersion:number;recentFingerprintIds:string[];correlationId:string; }
export interface AIOrchestrator { generateCoreConcept(context:GenerationContext):Promise<CoreConcept>;generatePlatformVariants(context:GenerationContext,concept:CoreConcept,platforms:SocialPlatform[]):Promise<PostVariant[]>;scoreAndValidate(context:GenerationContext,concept:CoreConcept,variants:PostVariant[]):Promise<QualityScore>; }

export interface SocialConnectionHealth { status:'connected'|'expiring'|'expired'|'reauth_required'|'permission_error'|'disabled';expiresAt?:string;missingScopes?:string[];message?:string; }
export interface PublishResult { externalPostId:string;externalUrl?:string;providerRequestId?:string;publishedAt:string; }
export interface SocialAnalyticsSnapshot { platform:SocialPlatform;capturedAt:string;metrics:Record<string,number|null>;availableMetricKeys:string[]; }
export interface SocialProvider {
  readonly platform:SocialPlatform;
  connect(input:{tenantId:string;redirectUri:string;state:string}):Promise<{authorizationUrl:string}>;
  refreshToken(connectionId:string):Promise<SocialConnectionHealth>;
  validateConnection(connectionId:string):Promise<SocialConnectionHealth>;
  publishPost(input:{connectionId:string;accountId:string;variant:PostVariant;idempotencyKey:string}):Promise<PublishResult>;
  publishImage(input:{connectionId:string;accountId:string;mediaUrl:string;variant:PostVariant;idempotencyKey:string}):Promise<PublishResult>;
  getPost(input:{connectionId:string;externalPostId:string}):Promise<Record<string,unknown>>;
  deletePost(input:{connectionId:string;externalPostId:string}):Promise<void>;
  getAnalytics(input:{connectionId:string;externalPostId:string}):Promise<SocialAnalyticsSnapshot>;
}

export type PublicationErrorClass = 'retryable'|'non_retryable'|'auth'|'rate_limit'|'validation'|'platform_rejection';
export interface PublicationJob { id:string;tenantId:string;postVariantId:string;platform:SocialPlatform;scheduledAt:string;idempotencyKey:string;attempts:number;maxAttempts:number;externalPostId?:string;correlationId:string; }
export interface AIUsageEvent { tenantId:string;task:string;model:string;promptVersion?:string;inputTokens?:number;cachedInputTokens?:number;outputTokens?:number;imageCount:number;webSearchCalls:number;estimatedCostMicrounits?:number;correlationId?:string; }

export * from './provider-readiness.js';
