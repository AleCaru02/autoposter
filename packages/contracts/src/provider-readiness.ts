import { z } from 'zod';

export const ProviderSocialPlatformSchema = z.enum(['facebook','instagram','linkedin','google_business_profile']);
export type ProviderSocialPlatform = z.infer<typeof ProviderSocialPlatformSchema>;
export const ProviderKeySchema = z.enum(['meta','facebook','instagram','linkedin','google_business_profile','telegram','stripe','openai']);
export type ProviderKey = z.infer<typeof ProviderKeySchema>;

export const ProviderCapabilitySchema = z.enum([
  'TEXT_POST','IMAGE_POST','MULTI_IMAGE','CAROUSEL','VIDEO','REEL','DOCUMENT_POST','ANALYTICS','DELETE','SCHEDULE_NATIVE','LOCAL_POST','CTA','WEBHOOKS',
]);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;
export const ConnectionHealthStatusSchema = z.enum(['CONNECTED','DEGRADED','EXPIRING','EXPIRED','REAUTH_REQUIRED','PERMISSION_MISSING','RATE_LIMITED','PROVIDER_ERROR','DISCONNECTED']);
export type ConnectionHealthStatus = z.infer<typeof ConnectionHealthStatusSchema>;

export const ProviderAccountSchema = z.object({
  id:z.string(),connectionId:z.string(),provider:ProviderKeySchema,externalAccountId:z.string(),accountType:z.string(),displayName:z.string(),
  username:z.string().optional(),locationId:z.string().optional(),selected:z.boolean().default(false),capabilities:z.array(ProviderCapabilitySchema).default([]),
  grantedScopes:z.array(z.string()).default([]),missingPermissions:z.array(z.string()).default([]),health:ConnectionHealthStatusSchema.default('CONNECTED'),
  tokenExpiresAt:z.string().datetime().optional(),lastCheckedAt:z.string().datetime().optional(),lastPublishAt:z.string().datetime().optional(),
  lastErrorCode:z.string().optional(),lastErrorMessage:z.string().optional(),metadata:z.record(z.string(),z.unknown()).default({}),
});
export type ProviderAccount = z.infer<typeof ProviderAccountSchema>;
export const ProviderConnectionSchema = z.object({
  id:z.string(),tenantId:z.string(),provider:ProviderKeySchema,platform:ProviderSocialPlatformSchema.optional(),status:ConnectionHealthStatusSchema,
  providerSubjectId:z.string().optional(),grantedScopes:z.array(z.string()).default([]),missingPermissions:z.array(z.string()).default([]),
  tokenExpiresAt:z.string().datetime().optional(),connectedAt:z.string().datetime().optional(),lastCheckedAt:z.string().datetime().optional(),lastPublishAt:z.string().datetime().optional(),
  lastErrorCode:z.string().optional(),lastErrorMessage:z.string().optional(),recommendedAction:z.string().optional(),accounts:z.array(ProviderAccountSchema).default([]),
});
export type ProviderConnection = z.infer<typeof ProviderConnectionSchema>;

export const PermissionRequirementSchema = z.object({provider:ProviderKeySchema,feature:z.string(),requiredScopes:z.array(z.string()).default([]),optionalScopes:z.array(z.string()).default([]),accountTypes:z.array(z.string()).default([]),message:z.string()});
export type PermissionRequirement = z.infer<typeof PermissionRequirementSchema>;
export const PublishMediaSchema = z.object({assetId:z.string().optional(),url:z.string().optional(),mimeType:z.string(),width:z.number().int().positive().optional(),height:z.number().int().positive().optional(),bytes:z.number().int().nonnegative().optional(),altText:z.string().optional()});
export type PublishMedia = z.infer<typeof PublishMediaSchema>;
export const NormalizedPublishPayloadSchema = z.object({platform:ProviderSocialPlatformSchema,accountId:z.string(),format:z.string(),text:z.string().default(''),cta:z.string().optional(),link:z.string().url().optional(),media:z.array(PublishMediaSchema).default([]),scheduledAt:z.string().datetime().optional(),idempotencyKey:z.string().min(8),correlationId:z.string().min(8)});
export type NormalizedPublishPayload = z.infer<typeof NormalizedPublishPayloadSchema>;
export const ProviderValidationIssueSchema = z.object({code:z.string(),severity:z.enum(['warning','error','blocker']),field:z.string().optional(),message:z.string(),remediation:z.string().optional()});
export type ProviderValidationIssue = z.infer<typeof ProviderValidationIssueSchema>;
export const ProviderValidationResultSchema = z.object({valid:z.boolean(),provider:ProviderKeySchema,accountId:z.string(),requiredCapabilities:z.array(ProviderCapabilitySchema).default([]),supportedCapabilities:z.array(ProviderCapabilitySchema).default([]),convertedFormat:z.string().optional(),issues:z.array(ProviderValidationIssueSchema).default([])});
export type ProviderValidationResult = z.infer<typeof ProviderValidationResultSchema>;
export const PublishDryRunSchema = z.object({mode:z.literal('DRY_RUN'),provider:ProviderKeySchema,account:ProviderAccountSchema,payload:NormalizedPublishPayloadSchema,validation:ProviderValidationResultSchema,wouldPublish:z.boolean(),note:z.string()});
export type PublishDryRun = z.infer<typeof PublishDryRunSchema>;
export const ProviderPublishResultSchema = z.object({externalPostId:z.string(),externalUrl:z.string().optional(),providerRequestId:z.string().optional(),publishedAt:z.string().datetime(),idempotentReplay:z.boolean().default(false)});
export type ProviderPublishResult = z.infer<typeof ProviderPublishResultSchema>;

export const OAuthStartSchema = z.object({tenantId:z.string().uuid(),userId:z.string().uuid(),provider:ProviderKeySchema,redirectUri:z.string().url(),scopes:z.array(z.string()).default([]),usePkce:z.boolean().default(true)});
export type OAuthStart = z.infer<typeof OAuthStartSchema>;
export const OAuthAuthorizationSchema = z.object({authorizationUrl:z.string().url(),state:z.string().min(32),expiresAt:z.string().datetime(),codeChallenge:z.string().optional(),codeChallengeMethod:z.literal('S256').optional()});
export type OAuthAuthorization = z.infer<typeof OAuthAuthorizationSchema>;
export const OAuthCallbackSchema = z.object({state:z.string().min(32),provider:ProviderKeySchema,tenantId:z.string().uuid(),userId:z.string().uuid(),redirectUri:z.string().url(),code:z.string().min(1)});
export type OAuthCallback = z.infer<typeof OAuthCallbackSchema>;
export const OAuthExchangeResultSchema = z.object({providerSubjectId:z.string(),grantedScopes:z.array(z.string()).default([]),expiresAt:z.string().datetime().optional(),hasRefreshCredential:z.boolean().default(false),accounts:z.array(ProviderAccountSchema)});
export type OAuthExchangeResult = z.infer<typeof OAuthExchangeResultSchema>;

export const WebhookProcessingStatusSchema = z.enum(['RECEIVED','VERIFIED','PROCESSING','PROCESSED','FAILED','IGNORED_DUPLICATE']);
export type WebhookProcessingStatus = z.infer<typeof WebhookProcessingStatusSchema>;
export const WebhookSignatureStatusSchema = z.enum(['verified','invalid','not_applicable']);
export const ProviderWebhookEnvelopeSchema = z.object({provider:ProviderKeySchema,eventType:z.string(),externalId:z.string().optional(),tenantId:z.string().uuid().optional(),connectionId:z.string().uuid().optional(),accountId:z.string().uuid().optional(),providerTimestamp:z.string().datetime().optional(),payload:z.unknown(),signature:z.string().optional(),correlationId:z.string()});
export type ProviderWebhookEnvelope = z.infer<typeof ProviderWebhookEnvelopeSchema>;

export const AICapabilitySchema = z.enum(['TEXT_CHEAP','TEXT_STANDARD','TEXT_REASONING','STRUCTURED_OUTPUT','EMBEDDING','VISION','IMAGE_GENERATION','IMAGE_EDIT','WEB_RESEARCH']);
export type AICapability = z.infer<typeof AICapabilitySchema>;
export const AIErrorCodeSchema = z.enum(['TIMEOUT','MALFORMED_OUTPUT','VALIDATION_FAILURE','RATE_LIMIT','PROVIDER_UNAVAILABLE','SAFETY_REJECTION','EMPTY_RESPONSE','PARTIAL_RESPONSE','COST_LIMIT']);
export type AIErrorCode = z.infer<typeof AIErrorCodeSchema>;
export const AIExecutionPolicySchema = z.object({timeoutMs:z.number().int().positive(),maxAttempts:z.number().int().min(1).max(3).default(2),maxCostMicrounits:z.number().int().nonnegative().optional(),retryableErrors:z.array(AIErrorCodeSchema).default(['TIMEOUT','RATE_LIMIT','PROVIDER_UNAVAILABLE'])});
export type AIExecutionPolicy = z.infer<typeof AIExecutionPolicySchema>;

export const SourceEvidenceSchema = z.object({sourceType:z.enum(['WEBSITE','DOCUMENT','USER_CONFIRMED','USER_INPUT','PUBLIC_RESEARCH','SOCIAL','SYSTEM_INFERENCE']),sourceId:z.string().optional(),confidence:z.number().min(0).max(1),confirmed:z.boolean(),observedAt:z.string().datetime()});
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;
export const BrandIntelligenceOutputSchema = z.object({brandName:z.string(),industry:z.string(),description:z.string(),services:z.array(z.string()),products:z.array(z.string()),audiences:z.array(z.string()),differentiators:z.array(z.string()),toneRules:z.array(z.string()),allowedClaims:z.array(z.string()),forbiddenClaims:z.array(z.string()),evidence:z.array(SourceEvidenceSchema)});
export const ContentStrategyOutputSchema = z.object({objectives:z.array(z.string()),pillars:z.array(z.object({name:z.string(),description:z.string(),targetShare:z.number().min(0).max(1)})),platformStrategy:z.record(z.string(),z.string()),cadence:z.object({postsPerWeek:z.number().int().positive()})});
export const TopicResearchOutputSchema = z.object({topics:z.array(z.object({topic:z.string(),angle:z.string(),relevance:z.number().min(0).max(1),evidence:z.array(SourceEvidenceSchema)})),notes:z.array(z.string()).default([])});
export const CoreConceptOutputSchema = z.object({topic:z.string(),angle:z.string(),objective:z.string(),hookIntent:z.string(),ctaIntent:z.string(),claims:z.array(z.object({claim:z.string(),evidence:z.array(SourceEvidenceSchema)}))});
export const PlatformVariantOutputSchema = z.object({platform:ProviderSocialPlatformSchema,decision:z.enum(['native_variant','separate_concept','skip']),format:z.string(),hook:z.string(),caption:z.string(),cta:z.string().optional(),hashtags:z.array(z.string()).default([]),altText:z.string().optional(),visualBrief:z.record(z.string(),z.unknown()).default({}),approvalMode:z.enum(['auto','manual'])});
export const CaptionOutputSchema = z.object({caption:z.string(),hashtags:z.array(z.string()),cta:z.string().optional(),altText:z.string().optional()});
export const VisualBriefOutputSchema = z.object({visualType:z.string(),subject:z.string(),composition:z.string(),textOverlay:z.array(z.string()).default([]),assetHints:z.array(z.string()).default([]),avoid:z.array(z.string()).default([])});
export const QAOutputSchema = z.object({pass:z.boolean(),score:z.number().min(0).max(1),issues:z.array(z.object({code:z.string(),severity:z.enum(['warning','error','blocker']),component:z.string(),repair:z.string().optional()}))});
export const FactCheckOutputSchema = z.object({pass:z.boolean(),claims:z.array(z.object({claim:z.string(),status:z.enum(['CONFIRMED','SUPPORTED','UNVERIFIED','CONTRADICTED']),confidence:z.number().min(0).max(1),evidence:z.array(SourceEvidenceSchema)}))});
export const CompetitorAnalysisOutputSchema = z.object({competitors:z.array(z.object({name:z.string(),positioning:z.string(),strengths:z.array(z.string()),weaknesses:z.array(z.string()),evidence:z.array(SourceEvidenceSchema)})),opportunities:z.array(z.string())});
export const AnalyticsInsightOutputSchema = z.object({summary:z.string(),signals:z.array(z.object({metric:z.string(),direction:z.enum(['up','down','flat']),confidence:z.number().min(0).max(1)})),actions:z.array(z.string()),sampleSize:z.number().int().nonnegative()});
export const ImagePromptOutputSchema = z.object({prompt:z.string(),negativePrompt:z.string().optional(),aspectRatio:z.enum(['square','portrait','landscape']),referenceAssetIds:z.array(z.string()).default([]),brandConstraints:z.array(z.string()).default([])});
export const DocumentIntelligenceOutputSchema = z.object({documentType:z.string(),summary:z.string(),services:z.array(z.string()),products:z.array(z.string()),prices:z.array(z.object({label:z.string(),value:z.string()})),faqs:z.array(z.object({question:z.string(),answer:z.string()})),claims:z.array(z.object({claim:z.string(),confidence:z.number().min(0).max(1)})),requiresAi:z.boolean()});
export const StructuredOutputSchemas = {brand_intelligence:BrandIntelligenceOutputSchema,content_strategy:ContentStrategyOutputSchema,topic_research:TopicResearchOutputSchema,core_concept:CoreConceptOutputSchema,platform_variant:PlatformVariantOutputSchema,caption:CaptionOutputSchema,visual_brief:VisualBriefOutputSchema,qa:QAOutputSchema,fact_check:FactCheckOutputSchema,competitor_analysis:CompetitorAnalysisOutputSchema,analytics_insight:AnalyticsInsightOutputSchema,image_prompt:ImagePromptOutputSchema,document_intelligence:DocumentIntelligenceOutputSchema} as const;
export type StructuredOutputName = keyof typeof StructuredOutputSchemas;

export const DocumentIngestionStatusSchema = z.enum(['UPLOADED','PROCESSING','INDEXED','FAILED','REQUIRES_AI']);
export type DocumentIngestionStatus = z.infer<typeof DocumentIngestionStatusSchema>;
export const DocumentChunkSchema = z.object({index:z.number().int().nonnegative(),content:z.string(),contentHash:z.string(),metadata:z.record(z.string(),z.unknown()).default({})});
export type DocumentChunk = z.infer<typeof DocumentChunkSchema>;

export interface DocumentIngestionProvider {
  readonly key:string;
  extractText(input:{mimeType:string;bytes:Uint8Array;filename:string}):Promise<string>;
  extractMetadata(input:{mimeType:string;bytes:Uint8Array;filename:string}):Promise<Record<string,unknown>>;
  chunk(input:{text:string;maxChars?:number}):Promise<DocumentChunk[]>;
  classify(input:{text:string;metadata:Record<string,unknown>}):Promise<Record<string,unknown>>;
  summarize(input:{text:string;metadata:Record<string,unknown>}):Promise<string>;
  index(input:{tenantId:string;assetId:string;chunks:DocumentChunk[]}):Promise<{indexed:number}>;
}
export interface AIProvider {
  readonly key:string;
  supports(capability:AICapability):boolean;
  generateText(input:{capability:AICapability;prompt:string;policy:AIExecutionPolicy}):Promise<{text:string;usage?:Record<string,number>}>;
  generateStructured<T>(input:{capability:AICapability;prompt:string;schema:z.ZodType<T>;policy:AIExecutionPolicy}):Promise<T>;
  embed(input:{texts:string[];policy:AIExecutionPolicy}):Promise<number[][]>;
  analyzeVision(input:{prompt:string;images:Array<{url?:string;dataBase64?:string}>;policy:AIExecutionPolicy}):Promise<Record<string,unknown>>;
  generateImage(input:{prompt:string;aspectRatio:'square'|'portrait'|'landscape';policy:AIExecutionPolicy}):Promise<{dataBase64:string;mimeType:string}>;
  editImage(input:{prompt:string;imageBase64:string;maskBase64?:string;policy:AIExecutionPolicy}):Promise<{dataBase64:string;mimeType:string}>;
  webResearch(input:{query:string;policy:AIExecutionPolicy}):Promise<{summary:string;sources:Array<{url:string;title?:string}>}>;
}
export interface ProviderOAuthAdapter {
  readonly provider:ProviderKey;
  buildAuthorization(input:OAuthStart&{state:string;codeChallenge?:string}):Promise<{authorizationUrl:string}>;
  exchangeCode(input:OAuthCallback&{codeVerifier?:string}):Promise<OAuthExchangeResult>;
  revoke(connectionId:string):Promise<void>;
}
export interface SocialProviderV2 {
  readonly provider:ProviderKey;
  readonly platform:ProviderSocialPlatform;
  capabilities(account:ProviderAccount):Promise<ProviderCapability[]>;
  permissionRequirements(feature:string,accountType?:string):PermissionRequirement[];
  listAccounts(connectionId:string):Promise<ProviderAccount[]>;
  validateConnection(connectionId:string):Promise<{status:ConnectionHealthStatus;missingPermissions:string[];recommendedAction?:string}>;
  validateContent(account:ProviderAccount,payload:NormalizedPublishPayload):Promise<ProviderValidationResult>;
  dryRun(account:ProviderAccount,payload:NormalizedPublishPayload):Promise<PublishDryRun>;
  publish(account:ProviderAccount,payload:NormalizedPublishPayload):Promise<ProviderPublishResult>;
  reconcile(input:{connectionId:string;accountId:string;idempotencyKey:string;externalPostId?:string}):Promise<ProviderPublishResult|null>;
  analytics(input:{connectionId:string;accountId:string;externalPostId:string}):Promise<{capturedAt:string;metrics:Record<string,number|null>;availableMetricKeys:string[]}>;
  disconnect(connectionId:string):Promise<void>;
}
export interface WebhookSignatureVerifier { readonly provider:ProviderKey; verify(input:{rawBody:string;headers:Record<string,string|undefined>;nowMs:number}):{valid:boolean;timestampMs?:number;reason?:string}; }
export interface BillingProvider {
  readonly key:'stripe'|'mock-stripe';
  createCheckout(input:{tenantId:string;planCode:string;successUrl:string;cancelUrl:string;idempotencyKey:string}):Promise<{checkoutId:string;url:string}>;
  changePlan(input:{subscriptionId:string;planCode:string;idempotencyKey:string}):Promise<{status:string}>;
  cancel(input:{subscriptionId:string;atPeriodEnd:boolean;idempotencyKey:string}):Promise<{status:string}>;
  syncEntitlements(input:{tenantId:string;subscriptionId:string}):Promise<Record<string,unknown>>;
}
