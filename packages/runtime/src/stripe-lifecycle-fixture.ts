export type MockStripeSubscriptionStatus='active'|'past_due'|'cancel_at_period_end'|'canceled';
export type MockStripeWebhookType='checkout.session.completed'|'customer.subscription.updated'|'invoice.payment_failed'|'customer.subscription.deleted';
export interface MockStripeSubscription {subscriptionId:string;tenantId:string;planCode:string;status:MockStripeSubscriptionStatus;entitlementsVersion:number;}
export interface MockStripeWebhookEvent {eventId:string;type:MockStripeWebhookType;tenantId:string;subscriptionId:string;planCode?:string;atPeriodEnd?:boolean;}
export interface MockStripeWebhookResult {duplicate:boolean;processed:boolean;subscription:MockStripeSubscription|null;}

export class MockStripeLifecycleFixture {
  private readonly subscriptions=new Map<string,MockStripeSubscription>();
  private readonly processedEvents=new Set<string>();

  seed(input:{tenantId:string;subscriptionId:string;planCode:string;status?:MockStripeSubscriptionStatus}){
    const row:MockStripeSubscription={subscriptionId:input.subscriptionId,tenantId:input.tenantId,planCode:input.planCode,status:input.status??'active',entitlementsVersion:1};
    this.subscriptions.set(row.subscriptionId,row);return structuredClone(row);
  }

  processWebhook(event:MockStripeWebhookEvent):MockStripeWebhookResult{
    if(this.processedEvents.has(event.eventId))return{duplicate:true,processed:false,subscription:this.get(event.subscriptionId)};
    this.processedEvents.add(event.eventId);
    const existing=this.subscriptions.get(event.subscriptionId);
    let next:MockStripeSubscription|null=existing?{...existing}:null;
    if(event.type==='checkout.session.completed'){
      next={subscriptionId:event.subscriptionId,tenantId:event.tenantId,planCode:event.planCode??'starter',status:'active',entitlementsVersion:(existing?.entitlementsVersion??0)+1};
    }else if(event.type==='customer.subscription.updated'){
      if(!existing)throw new Error('STRIPE_SUBSCRIPTION_NOT_FOUND');
      next={...existing,planCode:event.planCode??existing.planCode,status:event.atPeriodEnd?'cancel_at_period_end':'active',entitlementsVersion:existing.entitlementsVersion+1};
    }else if(event.type==='invoice.payment_failed'){
      if(!existing)throw new Error('STRIPE_SUBSCRIPTION_NOT_FOUND');next={...existing,status:'past_due',entitlementsVersion:existing.entitlementsVersion+1};
    }else if(event.type==='customer.subscription.deleted'){
      if(!existing)throw new Error('STRIPE_SUBSCRIPTION_NOT_FOUND');next={...existing,status:'canceled',entitlementsVersion:existing.entitlementsVersion+1};
    }
    if(next)this.subscriptions.set(next.subscriptionId,next);
    return{duplicate:false,processed:true,subscription:next?structuredClone(next):null};
  }

  syncEntitlements(subscriptionId:string){const row=this.subscriptions.get(subscriptionId);if(!row)throw new Error('STRIPE_SUBSCRIPTION_NOT_FOUND');return{tenantId:row.tenantId,subscriptionId:row.subscriptionId,planCode:row.planCode,status:row.status,entitlementsVersion:row.entitlementsVersion,synced:true};}
  get(subscriptionId:string){const row=this.subscriptions.get(subscriptionId);return row?structuredClone(row):null;}
}
