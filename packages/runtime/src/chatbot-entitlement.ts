export interface ChatbotEntitlementContext {
  tenantScoped: boolean;
  premiumChatAllowed: boolean;
}

export class ChatbotEntitlementGuard {
  canReadPublicKnowledge(_context:ChatbotEntitlementContext):boolean { return true; }
  canReadTenantKnowledge(context:ChatbotEntitlementContext):boolean { return context.tenantScoped; }
  canUsePremiumActions(context:ChatbotEntitlementContext):boolean { return context.tenantScoped && context.premiumChatAllowed; }
  assertTenantIsolation(context:ChatbotEntitlementContext){ if(!context.tenantScoped)throw new Error('TENANT_CONTEXT_REQUIRED'); }
  assertPremiumActions(context:ChatbotEntitlementContext){ this.assertTenantIsolation(context);if(!context.premiumChatAllowed)throw new Error('FEATURE_NOT_ENTITLED:premium_chat'); }
}
