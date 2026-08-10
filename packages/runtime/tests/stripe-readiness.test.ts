import { describe,expect,it } from 'vitest';
import { MockStripeProvider } from '../src/provider-readiness.js';

describe('Stripe readiness fixture',()=>{
  it('maps plan checkout through idempotent abstraction',async()=>{const stripe=new MockStripeProvider();const input={tenantId:'tenant-a',planCode:'starter',successUrl:'https://example.test/success',cancelUrl:'https://example.test/cancel',idempotencyKey:'checkout-idem-123'};const first=await stripe.createCheckout(input);const replay=await stripe.createCheckout(input);expect(first).toEqual(replay);expect(first.checkoutId).toMatch(/^cs_mock_/);});
  it('supports upgrade/downgrade, cancel and entitlement sync contracts',async()=>{const stripe=new MockStripeProvider();expect((await stripe.changePlan({subscriptionId:'sub-1',planCode:'pro',idempotencyKey:'change-1'})).status).toBe('updated:pro');expect((await stripe.changePlan({subscriptionId:'sub-1',planCode:'starter',idempotencyKey:'change-2'})).status).toBe('updated:starter');expect((await stripe.cancel({subscriptionId:'sub-1',atPeriodEnd:true,idempotencyKey:'cancel-1'})).status).toBe('cancel_at_period_end');expect((await stripe.cancel({subscriptionId:'sub-1',atPeriodEnd:false,idempotencyKey:'cancel-2'})).status).toBe('canceled');expect(await stripe.syncEntitlements({tenantId:'tenant-a',subscriptionId:'sub-1'})).toMatchObject({synced:true});});
});
