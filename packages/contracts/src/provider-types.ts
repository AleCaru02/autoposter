import type { ZodType } from 'zod';

export type ProviderSocialPlatform='facebook'|'instagram'|'linkedin'|'google_business_profile';
export type ProviderKey='meta'|'facebook'|'instagram'|'linkedin'|'google_business_profile'|'telegram'|'stripe'|'openai';
export type ProviderCapability='TEXT_POST'|'IMAGE_POST'|'MULTI_IMAGE'|'CAROUSEL'|'VIDEO'|'REEL'|'DOCUMENT_POST'|'ANALYTICS'|'DELETE'|'SCHEDULE_NATIVE'|'LOCAL_POST'|'CTA'|'WEBHOOKS';
export type ConnectionHealthStatus='CONNECTED'|'DEGRADED'|'EXPIRING'|'EXPIRED'|'REAUTH_REQUIRED'|'PERMISSION_MISSING'|'RATE_LIMITED'|'PROVIDER_ERROR'|'DISCONNECTED';

export interface ProviderAccount {
  id:string;connectionId:string;provider:ProviderKey;externalAccountId:string;accountType:string;displayName:string;
  username?:string;locationId?:string;selected:boolean;capabilities:ProviderCapability[];grantedScopes:string[];missingPermissions:string[];
  health:ConnectionHealthStatus;tokenExpiresAt?:string;lastCheckedAt?:string;lastPublishAt?:string;lastErrorCode?:string;lastErrorMessage?:string;
  metadata:Record<string,unknown>;
}
export interface ProviderConnection {
  id:string;tenantId:string;provider:ProviderKey;platform?:ProviderSocialPlatform;status:ConnectionHealthStatus;providerSubjectId?:string;
  grantedScopes:string[];missingPermissions:string[];tokenExpiresAt?:string;connectedAt?:string;lastCheckedAt?:string;lastPublishAt?:string;
  lastErrorCode?:string;lastErrorMessage?:string;recommendedAction?:string;accounts:ProviderAccount[];
}
export interface PermissionRequirement {provider:ProviderKey;feature:string;requiredScopes:string[];optionalScopes:string[];accountTypes:string[];message:string;}
export interface PublishMedia {assetId?:string;url?:string;mimeType:string;width?:number;height?:number;bytes?:number;altText?:string;}
export interface NormalizedPublishPayload {platform:ProviderSocialPlatform;accountId:string;format:string;text:string;cta?:string;link?:string;media:PublishMedia[];scheduledAt?:string;idempotencyKey:string;correlationId:string;}
export interface ProviderValidationIssue {code:string;severity:'warning'|'error'|'blocker';field?:string;message:string;remediation?:string;}
export interface ProviderValidationResult {valid:boolean;provider:ProviderKey;accountId:string;requiredCapabilities:ProviderCapability[];supportedCapabilities:ProviderCapability[];convertedFormat?:string;issues:ProviderValidationIssue[];}
export interface PublishDryRun {mode:'DRY_RUN';provider:ProviderKey;account:ProviderAccount;payload:NormalizedPublishPayload;validation:ProviderValidationResult;wouldPublish:boolean;note:string;}
export interface ProviderPublishResult {externalPostId:string;externalUrl?:string;providerRequestId?:string;publishedAt:string;idempotentReplay:boolean;}

export interface OAuthStart {tenantId:string;userId:string;provider:ProviderKey;redirectUri:string;scopes:string[];usePkce:boolean;}
export interface OAuthAuthorization {authorizationUrl:string;state:string;expiresAt:string;codeChallenge?:string;codeChallengeMethod?:'S256';}
export interface OAuthCallback {state:string;provider:ProviderKey;tenantId:string;userId:string;redirectUri:string;code:string;}
export interface OAuthExchangeResult {providerSubjectId:string;grantedScopes:string[];expiresAt?:string;hasRefreshCredential:boolean;accounts:ProviderAccount[];}
export type WebhookProcessingStatus='RECEIVED'|'VERIFIED'|'PROCESSING'|'PROCESSED'|'FAILED'|'IGNORED_DUPLICATE';
export interface ProviderWebhookEnvelope {provider:ProviderKey;eventType:string;externalId?:string;tenantId?:string;connectionId?:string;accountId?:string;providerTimestamp?:string;payload:unknown;signature?:string;correlationId:string;}

export type AICapability='TEXT_CHEAP'|'TEXT_STANDARD'|'TEXT_REASONING'|'STRUCTURED_OUTPUT'|'EMBEDDING'|'VISION'|'IMAGE_GENERATION'|'IMAGE_EDIT'|'WEB_RESEARCH';
export type AIErrorCode='TIMEOUT'|'MALFORMED_OUTPUT'|'VALIDATION_FAILURE'|'RATE_LIMIT'|'PROVIDER_UNAVAILABLE'|'SAFETY_REJECTION'|'EMPTY_RESPONSE'|'PARTIAL_RESPONSE'|'COST_LIMIT';
export interface AIExecutionPolicy {timeoutMs:number;maxAttempts:number;maxCostMicrounits?:number;retryableErrors:AIErrorCode[];}
export type SourceType='WEBSITE'|'DOCUMENT'|'USER_CONFIRMED'|'USER_INPUT'|'PUBLIC_RESEARCH'|'SOCIAL'|'SYSTEM_INFERENCE';
export interface SourceEvidence {sourceType:SourceType;sourceId?:string;confidence:number;confirmed:boolean;observedAt:string;}
export type DocumentIngestionStatus='UPLOADED'|'PROCESSING'|'INDEXED'|'FAILED'|'REQUIRES_AI';
export interface DocumentChunk {index:number;content:string;contentHash:string;metadata:Record<string,unknown>;}

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
  generateStructured<T>(input:{capability:AICapability;prompt:string;schema:ZodType<T>;policy:AIExecutionPolicy}):Promise<T>;
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
export interface WebhookSignatureVerifier {readonly provider:ProviderKey;verify(input:{rawBody:string;headers:Record<string,string|undefined>;nowMs:number}):{valid:boolean;timestampMs?:number;reason?:string};}
export interface BillingProvider {
  readonly key:'stripe'|'mock-stripe';
  createCheckout(input:{tenantId:string;planCode:string;successUrl:string;cancelUrl:string;idempotencyKey:string}):Promise<{checkoutId:string;url:string}>;
  changePlan(input:{subscriptionId:string;planCode:string;idempotencyKey:string}):Promise<{status:string}>;
  cancel(input:{subscriptionId:string;atPeriodEnd:boolean;idempotencyKey:string}):Promise<{status:string}>;
  syncEntitlements(input:{tenantId:string;subscriptionId:string}):Promise<Record<string,unknown>>;
}
