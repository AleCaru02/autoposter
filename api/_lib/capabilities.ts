export type CapabilityClassification =
  | "CORE_ALL_PLANS"
  | "PLAN_GATED"
  | "USAGE_LIMITED"
  | "ADMIN_ONLY"
  | "INTERNAL"
  | "NOT_READY";

export type CapabilityStatus =
  | "LIVE_VERIFIED"
  | "LIVE_NOT_RUNTIME_VERIFIED"
  | "PARTIAL"
  | "SCAFFOLD_ONLY"
  | "PLANNED"
  | "DEPRECATED";

export type CapabilityLimitType =
  | "BOOLEAN"
  | "COUNT_PER_DAY"
  | "COUNT_PER_MONTH"
  | "CONCURRENT"
  | "MAX_CONNECTED_ACCOUNTS"
  | "STORAGE"
  | "SEATS"
  | "UNLIMITED"
  | "NOT_APPLICABLE";

export type CapabilityDefinition = {
  key: string;
  classification: CapabilityClassification;
  limitType: CapabilityLimitType;
  status: CapabilityStatus;
};

const define = <T extends Record<string, Omit<CapabilityDefinition, "key">>>(value: T) => value;

export const CAPABILITY_REGISTRY = define({
  "auth.email.signup": { classification: "CORE_ALL_PLANS", limitType: "BOOLEAN", status: "LIVE_VERIFIED" },
  "auth.session.manage": { classification: "CORE_ALL_PLANS", limitType: "BOOLEAN", status: "LIVE_VERIFIED" },
  "auth.google.signin": { classification: "CORE_ALL_PLANS", limitType: "BOOLEAN", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "auth.password.reset": { classification: "CORE_ALL_PLANS", limitType: "BOOLEAN", status: "LIVE_VERIFIED" },
  "workspace.profile.manage": { classification: "USAGE_LIMITED", limitType: "CONCURRENT", status: "LIVE_VERIFIED" },
  "workspace.profile.settings": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "website.scan": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "website.pages.persist": { classification: "USAGE_LIMITED", limitType: "STORAGE", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "brand.analyze": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_VERIFIED" },
  "brand.manage": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "ai.content.generate_text": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_VERIFIED" },
  "ai.research.web": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "ai.research.factcheck": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "ai.strategy.generate": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_VERIFIED" },
  "content.dedupe": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "content.format.post": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "content.format.carousel": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "content.format.story": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "ai.image.generate": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_VERIFIED" },
  "media.image.persist": { classification: "USAGE_LIMITED", limitType: "STORAGE", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "media.object_storage": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PLANNED" },
  "content.draft.persist": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "content.approval.manual": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "content.approval.auto": { classification: "PLAN_GATED", limitType: "BOOLEAN", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "autopilot.manage": { classification: "PLAN_GATED", limitType: "BOOLEAN", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "autopilot.hourly": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_DAY", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "schedule.frequency.manage": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "schedule.calendar.read": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "schedule.job.create": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "schedule.job.manage": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "schedule.job.integrity": { classification: "INTERNAL", limitType: "NOT_APPLICABLE", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.facebook.connect": { classification: "PLAN_GATED", limitType: "MAX_CONNECTED_ACCOUNTS", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.instagram.connect": { classification: "PLAN_GATED", limitType: "MAX_CONNECTED_ACCOUNTS", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.linkedin.connect": { classification: "PLAN_GATED", limitType: "MAX_CONNECTED_ACCOUNTS", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.gbp.connect": { classification: "PLAN_GATED", limitType: "MAX_CONNECTED_ACCOUNTS", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.token.secure_store": { classification: "INTERNAL", limitType: "NOT_APPLICABLE", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.connection.lifecycle": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "social.facebook.publish": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.instagram.publish": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.linkedin.publish": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.gbp.publish": { classification: "USAGE_LIMITED", limitType: "COUNT_PER_MONTH", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.publish.scheduled": { classification: "PLAN_GATED", limitType: "BOOLEAN", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "social.publish.retry": { classification: "CORE_ALL_PLANS", limitType: "UNLIMITED", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "analytics.instagram.normalize": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "analytics.facebook.normalize": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "analytics.linkedin.normalize": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "analytics.gbp.normalize": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "analytics.sync": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PLANNED" },
  "analytics.read": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "learning.compute": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "learning.read": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PARTIAL" },
  "usage.ai.ledger": { classification: "INTERNAL", limitType: "NOT_APPLICABLE", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "usage.ai.text_budget": { classification: "INTERNAL", limitType: "NOT_APPLICABLE", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "usage.ai.image_limit": { classification: "INTERNAL", limitType: "NOT_APPLICABLE", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "usage.ai.policy": { classification: "INTERNAL", limitType: "NOT_APPLICABLE", status: "LIVE_NOT_RUNTIME_VERIFIED" },
  "admin.customer.manage": { classification: "ADMIN_ONLY", limitType: "NOT_APPLICABLE", status: "LIVE_VERIFIED" },
  "admin.audit.read": { classification: "ADMIN_ONLY", limitType: "NOT_APPLICABLE", status: "LIVE_VERIFIED" },
  "admin.session.manage": { classification: "ADMIN_ONLY", limitType: "NOT_APPLICABLE", status: "LIVE_VERIFIED" },
  "admin.customer.ban": { classification: "ADMIN_ONLY", limitType: "NOT_APPLICABLE", status: "LIVE_VERIFIED" },
  "admin.customer.impersonate": { classification: "ADMIN_ONLY", limitType: "NOT_APPLICABLE", status: "LIVE_VERIFIED" },
  "billing.subscription": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PLANNED" },
  "billing.pricing_ui": { classification: "NOT_READY", limitType: "NOT_APPLICABLE", status: "PLANNED" },
} as const);

export type CapabilityKey = keyof typeof CAPABILITY_REGISTRY;

export function isCapabilityKey(value: string): value is CapabilityKey {
  return Object.prototype.hasOwnProperty.call(CAPABILITY_REGISTRY, value);
}

export function capabilityDefinition(key: CapabilityKey): CapabilityDefinition {
  return { key, ...CAPABILITY_REGISTRY[key] };
}

export function capabilityOrNull(value: string): CapabilityDefinition | null {
  return isCapabilityKey(value) ? capabilityDefinition(value) : null;
}

export function capabilityCanBeCommerciallyAssigned(key: CapabilityKey) {
  const classification = CAPABILITY_REGISTRY[key].classification;
  return classification === "PLAN_GATED" || classification === "USAGE_LIMITED";
}
