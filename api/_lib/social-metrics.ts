export type MetricsProvider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";

export type MetricPoint = {
  provider: MetricsProvider;
  metric: string;
  value: number;
  capturedAt: string;
  externalPostId?: string | null;
  metadata?: Record<string, unknown>;
};

export type MetricsCapability = {
  provider: MetricsProvider;
  available: boolean;
  reason: string | null;
  requiredPermissions: string[];
  notes: string[];
};

const REQUIRED_PERMISSIONS: Record<MetricsProvider, string[]> = {
  INSTAGRAM: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement"],
  FACEBOOK: ["pages_read_engagement"],
  LINKEDIN: ["r_member_postAnalytics"],
  GBP: ["https://www.googleapis.com/auth/business.manage"],
};

function permissionSet(value: unknown) {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(value.filter((item): item is string => typeof item === "string"));
}

export function metricsCapability(input: {
  provider: MetricsProvider;
  connectionStatus: string | null | undefined;
  permissions: unknown;
  providerAccountId?: string | null;
  linkedinOrganizationMode?: boolean;
  googlePerformanceApiEnabled?: boolean;
}): MetricsCapability {
  const required = [...REQUIRED_PERMISSIONS[input.provider]];
  if (input.provider === "LINKEDIN" && input.linkedinOrganizationMode) {
    required.splice(0, required.length, "rw_organization_admin");
  }
  if (input.connectionStatus !== "ACTIVE") {
    return { provider: input.provider, available: false, reason: "SOCIAL_NOT_CONNECTED", requiredPermissions: required, notes: [] };
  }
  if (!input.providerAccountId) {
    return { provider: input.provider, available: false, reason: "PROVIDER_ACCOUNT_NOT_SELECTED", requiredPermissions: required, notes: [] };
  }
  const granted = permissionSet(input.permissions);
  const missing = required.filter((permission) => !granted.has(permission));
  if (missing.length) {
    return { provider: input.provider, available: false, reason: `MISSING_PERMISSIONS:${missing.join(",")}`, requiredPermissions: required, notes: [] };
  }
  if (input.provider === "GBP" && !input.googlePerformanceApiEnabled) {
    return { provider: input.provider, available: false, reason: "GBP_PERFORMANCE_API_NOT_ENABLED", requiredPermissions: required, notes: ["La Business Profile Performance API v1 deve essere abilitata separatamente."] };
  }
  if (input.provider === "LINKEDIN" && input.linkedinOrganizationMode) {
    return { provider: input.provider, available: true, reason: null, requiredPermissions: required, notes: ["Le statistiche organizzazione sono organiche; le sponsorizzate richiedono Ad Analytics."] };
  }
  return { provider: input.provider, available: true, reason: null, requiredPermissions: required, notes: [] };
}

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function pushMetric(target: MetricPoint[], provider: MetricsProvider, metric: string, value: unknown, capturedAt: string, externalPostId?: string | null, metadata?: Record<string, unknown>) {
  const parsed = finite(value);
  if (parsed === null) return;
  target.push({ provider, metric, value: parsed, capturedAt, externalPostId, metadata });
}

export function normalizeInstagramMediaMetrics(input: {
  externalPostId: string;
  capturedAt: string;
  basic?: { like_count?: unknown; comments_count?: unknown };
  insights?: Array<{ name?: unknown; values?: Array<{ value?: unknown }> }>;
}) {
  const result: MetricPoint[] = [];
  pushMetric(result, "INSTAGRAM", "likes", input.basic?.like_count, input.capturedAt, input.externalPostId);
  pushMetric(result, "INSTAGRAM", "comments", input.basic?.comments_count, input.capturedAt, input.externalPostId);
  for (const insight of input.insights ?? []) {
    if (typeof insight.name !== "string") continue;
    pushMetric(result, "INSTAGRAM", insight.name.toLowerCase(), insight.values?.[0]?.value, input.capturedAt, input.externalPostId);
  }
  return result;
}

export function normalizeFacebookPostMetrics(input: {
  externalPostId: string;
  capturedAt: string;
  counters?: { reactions?: unknown; comments?: unknown; shares?: unknown };
  insights?: Array<{ name?: unknown; values?: Array<{ value?: unknown }> }>;
}) {
  const result: MetricPoint[] = [];
  pushMetric(result, "FACEBOOK", "reactions", input.counters?.reactions, input.capturedAt, input.externalPostId);
  pushMetric(result, "FACEBOOK", "comments", input.counters?.comments, input.capturedAt, input.externalPostId);
  pushMetric(result, "FACEBOOK", "shares", input.counters?.shares, input.capturedAt, input.externalPostId);
  for (const insight of input.insights ?? []) {
    if (typeof insight.name !== "string") continue;
    pushMetric(result, "FACEBOOK", insight.name.toLowerCase(), insight.values?.[0]?.value, input.capturedAt, input.externalPostId);
  }
  return result;
}

export function normalizeLinkedInMetrics(input: {
  externalPostId: string;
  capturedAt: string;
  statistics?: Record<string, unknown>;
}) {
  const result: MetricPoint[] = [];
  const aliases: Record<string, string> = {
    impressionCount: "impressions",
    uniqueImpressionsCount: "reach",
    clickCount: "clicks",
    likeCount: "likes",
    reactionCount: "reactions",
    commentCount: "comments",
    shareCount: "shares",
    engagement: "engagement_rate",
    IMPRESSION: "impressions",
    MEMBERS_REACHED: "reach",
    RESHARE: "shares",
    REACTION: "reactions",
    COMMENT: "comments",
    POST_SAVE: "saves",
    LINK_CLICKS: "link_clicks",
  };
  for (const [key, raw] of Object.entries(input.statistics ?? {})) {
    pushMetric(result, "LINKEDIN", aliases[key] ?? key.toLowerCase(), raw, input.capturedAt, input.externalPostId);
  }
  return result;
}

export function normalizeGoogleBusinessMetrics(input: {
  capturedAt: string;
  dailyMetrics?: Array<{ dailyMetric?: unknown; timeSeries?: { datedValues?: Array<{ date?: unknown; value?: unknown }> } }>;
}) {
  const result: MetricPoint[] = [];
  for (const metric of input.dailyMetrics ?? []) {
    if (typeof metric.dailyMetric !== "string") continue;
    for (const point of metric.timeSeries?.datedValues ?? []) {
      if (!point.date || typeof point.date !== "object") continue;
      const date = point.date as Record<string, unknown>;
      const year = finite(date.year);
      const month = finite(date.month);
      const day = finite(date.day);
      if (year === null || month === null || day === null) continue;
      const capturedAt = new Date(Date.UTC(year, month - 1, day)).toISOString();
      pushMetric(result, "GBP", metric.dailyMetric.toLowerCase(), point.value, capturedAt, null, { source: "business_profile_performance_v1" });
    }
  }
  return result;
}
