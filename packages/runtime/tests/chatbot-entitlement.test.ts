import { describe,expect,it } from 'vitest';
import { ChatbotEntitlementGuard } from '../src/chatbot-entitlement.js';

describe('chatbot entitlement isolation',()=>{
  const guard=new ChatbotEntitlementGuard();
  it('keeps public knowledge available without tenant access',()=>{expect(guard.canReadPublicKnowledge({tenantScoped:false,premiumChatAllowed:false})).toBe(true);expect(guard.canReadTenantKnowledge({tenantScoped:false,premiumChatAllowed:true})).toBe(false);});
  it('allows tenant knowledge based on authorization context, not plan tier',()=>{expect(guard.canReadTenantKnowledge({tenantScoped:true,premiumChatAllowed:false})).toBe(true);});
  it('gates only premium actions by entitlement',()=>{expect(guard.canUsePremiumActions({tenantScoped:true,premiumChatAllowed:false})).toBe(false);expect(()=>guard.assertPremiumActions({tenantScoped:true,premiumChatAllowed:false})).toThrow('FEATURE_NOT_ENTITLED:premium_chat');expect(guard.canUsePremiumActions({tenantScoped:true,premiumChatAllowed:true})).toBe(true);});
  it('never lets premium entitlement substitute for tenant context',()=>{expect(()=>guard.assertPremiumActions({tenantScoped:false,premiumChatAllowed:true})).toThrow('TENANT_CONTEXT_REQUIRED');});
});
