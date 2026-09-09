import { neon } from "@neondatabase/serverless";
import { decryptTokenBundle, type SocialEnv, type SocialProvider } from "./social.js";
import { metricsCapability, normalizeFacebookPostMetrics, normalizeInstagramMediaMetrics, normalizeLinkedInMetrics, type MetricPoint } from "./social-metrics.js";

type Sql = ReturnType<typeof neon>;
type AnalyticsProvider = Exclude<SocialProvider, "GBP">;
type Claim = {
  job_id: string; profile_id: string; variant_id: string; content_id: string;
  provider: AnalyticsProvider; external_post_id: string; format: string; topic: string;
  published_at: string; claim_token: string; lease_expires_at: string;
};
type Connection = {
  status: string; provider_account_id: string | null; token_reference: string | null;
  permissions: unknown; expires_at: string | null; metadata: unknown;
};
type FetchRuntime = { fetch?: typeof fetch; timeoutMs?: number };

export class AnalyticsProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly terminalState: "BLOCKED" | "NOT_FOUND" | null,
    public readonly customerMessage: string,
    public readonly retryAfterSeconds = 900,
  ) { super(code); this.name = "AnalyticsProviderError"; }
}

function failure(provider: AnalyticsProvider, status: number | null, retryAfterSeconds = 900) {
  if (status === 401 || status === 403) return new AnalyticsProviderError(`${provider}_ANALYTICS_RECONNECT_REQUIRED`, false, "BLOCKED", "Ricollega il social per aggiornare i risultati.");
  if (status === 404) return new AnalyticsProviderError(`${provider}_REMOTE_POST_NOT_FOUND`, false, "NOT_FOUND", "Il contenuto remoto non è più disponibile.");
  if (status === 429) return new AnalyticsProviderError(`${provider}_ANALYTICS_RATE_LIMITED`, true, null, "Aggiornamento rimandato per limite del social.", retryAfterSeconds);
  if (status !== null && status >= 400 && status < 500) return new AnalyticsProviderError(`${provider}_ANALYTICS_REQUEST_REJECTED`, false, "BLOCKED", "Il social non consente di leggere questi risultati.");
  return new AnalyticsProviderError(`${provider}_ANALYTICS_TEMPORARY`, true, null, "Risultati temporaneamente non aggiornabili.", retryAfterSeconds);
}

function retryAfter(response: Response) {
  const raw = Number(response.headers.get("retry-after"));
  return Number.isFinite(raw) ? Math.min(Math.max(Math.ceil(raw), 60), 86400) : 900;
}

async function request(url: URL, provider: AnalyticsProvider, accessToken: string, runtime: FetchRuntime, tolerateUnsupported = false, providerVersion?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), runtime.timeoutMs ?? 20_000);
  try {
    const response = await (runtime.fetch ?? fetch)(url, { headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", ...(provider === "LINKEDIN" ? { "X-Restli-Protocol-Version": "2.0.0", "Linkedin-Version": providerVersion || "202508" } : {}) }, signal: controller.signal });
    if (!response.ok) {
      if (tolerateUnsupported && (response.status === 400 || response.status === 404)) return null;
      throw failure(provider, response.status, retryAfter(response));
    }
    try { return await response.json() as Record<string, unknown>; }
    catch { throw new AnalyticsProviderError(`${provider}_ANALYTICS_MALFORMED`, true, null, "Risposta del social non valida."); }
  } catch (reason) {
    if (reason instanceof AnalyticsProviderError) throw reason;
    throw failure(provider, null);
  } finally { clearTimeout(timeout); }
}

function metadata(value: unknown) { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function pointsToMetrics(points: MetricPoint[]) {
  const metrics: Record<string, number> = {};
  for (const point of points) metrics[point.metric] = point.value;
  return metrics;
}

async function metaInsightPoints(provider: "INSTAGRAM" | "FACEBOOK", remoteId: string, metrics: string[], token: string, capturedAt: string, env: SocialEnv, runtime: FetchRuntime) {
  const points: MetricPoint[] = [];
  for (const metric of metrics) {
    const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION || "v23.0"}/${encodeURIComponent(remoteId)}/insights`);
    url.searchParams.set("metric", metric);
    const body = await request(url, provider, token, runtime, true);
    if (!body) continue;
    const data = Array.isArray(body.data) ? body.data as Array<{ name?: unknown; values?: Array<{ value?: unknown }> }> : [];
    points.push(...(provider === "INSTAGRAM"
      ? normalizeInstagramMediaMetrics({ externalPostId: remoteId, capturedAt, insights: data })
      : normalizeFacebookPostMetrics({ externalPostId: remoteId, capturedAt, insights: data })));
  }
  return points;
}

async function fetchInstagram(claim: Claim, connection: Connection, token: string, env: SocialEnv, runtime: FetchRuntime) {
  const capturedAt = new Date().toISOString();
  const basicUrl = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION || "v23.0"}/${encodeURIComponent(claim.external_post_id)}`);
  basicUrl.searchParams.set("fields", "id,like_count,comments_count");
  const basic = await request(basicUrl, "INSTAGRAM", token, runtime) as { like_count?: unknown; comments_count?: unknown };
  const points = normalizeInstagramMediaMetrics({ externalPostId: claim.external_post_id, capturedAt, basic });
  points.push(...await metaInsightPoints("INSTAGRAM", claim.external_post_id, ["views", "reach", "saved", "shares", "total_interactions"], token, capturedAt, env, runtime));
  return pointsToMetrics(points);
}

async function fetchFacebook(claim: Claim, connection: Connection, token: string, env: SocialEnv, runtime: FetchRuntime) {
  const capturedAt = new Date().toISOString();
  const basicUrl = new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION || "v23.0"}/${encodeURIComponent(claim.external_post_id)}`);
  basicUrl.searchParams.set("fields", "id,reactions.limit(0).summary(true),comments.limit(0).summary(true),shares");
  const basic = await request(basicUrl, "FACEBOOK", token, runtime);
  const reactions = metadata(basic?.reactions); const comments = metadata(basic?.comments); const shares = metadata(basic?.shares);
  const points = normalizeFacebookPostMetrics({ externalPostId: claim.external_post_id, capturedAt, counters: {
    reactions: numeric(metadata(reactions.summary).total_count), comments: numeric(metadata(comments.summary).total_count), shares: numeric(shares.count),
  } });
  points.push(...await metaInsightPoints("FACEBOOK", claim.external_post_id, ["post_impressions", "post_impressions_unique", "post_engaged_users", "post_clicks"], token, capturedAt, env, runtime));
  return pointsToMetrics(points);
}

async function fetchLinkedIn(claim: Claim, connection: Connection, token: string, env: SocialEnv, runtime: FetchRuntime) {
  const capturedAt = new Date().toISOString();
  const permissions = new Set(Array.isArray(connection.permissions) ? connection.permissions.filter((item): item is string => typeof item === "string") : []);
  const info = metadata(connection.metadata);
  if (info.accountType === "ORGANIZATION") {
    const url = new URL("https://api.linkedin.com/rest/organizationalEntityShareStatistics");
    url.searchParams.set("q", "organizationalEntity");
    url.searchParams.set("organizationalEntity", `urn:li:organization:${connection.provider_account_id}`);
    url.searchParams.set("shares", `List(${claim.external_post_id})`);
    const body = await request(url, "LINKEDIN", token, runtime, false, env.LINKEDIN_API_VERSION);
    const element = Array.isArray(body?.elements) ? metadata(body.elements[0]) : {};
    return pointsToMetrics(normalizeLinkedInMetrics({ externalPostId: claim.external_post_id, capturedAt, statistics: metadata(element.totalShareStatistics) }));
  }
  if (permissions.has("r_member_postAnalytics")) {
    const url = new URL("https://api.linkedin.com/rest/memberCreatorPostAnalytics");
    url.searchParams.set("q", "entity"); url.searchParams.set("entity", claim.external_post_id);
    url.searchParams.set("queryType", "TOTAL"); url.searchParams.set("pageType", "MEMBER");
    const body = await request(url, "LINKEDIN", token, runtime, false, env.LINKEDIN_API_VERSION);
    const element = Array.isArray(body?.elements) ? metadata(body.elements[0]) : {};
    return pointsToMetrics(normalizeLinkedInMetrics({ externalPostId: claim.external_post_id, capturedAt, statistics: metadata(element.metrics) }));
  }
  // Publishing access still permits the real social-action counters for the
  // owned post. This is intentionally a partial metric set, never fabricated.
  const url = new URL(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(claim.external_post_id)}`);
  const body = await request(url, "LINKEDIN", token, runtime, false, env.LINKEDIN_API_VERSION);
  const stats = { likeCount: metadata(body?.likesSummary).totalLikes, commentCount: metadata(body?.commentsSummary).totalFirstLevelComments };
  return pointsToMetrics(normalizeLinkedInMetrics({ externalPostId: claim.external_post_id, capturedAt, statistics: stats }));
}

export async function fetchProviderMetrics(claim: Claim, connection: Connection, env: SocialEnv, runtime: FetchRuntime = {}) {
  if (connection.status !== "ACTIVE" || !connection.provider_account_id || !connection.token_reference) throw new AnalyticsProviderError("SOCIAL_NOT_CONNECTED", false, "BLOCKED", "Ricollega il social per aggiornare i risultati.");
  if (connection.expires_at && new Date(connection.expires_at).getTime() <= Date.now()) throw new AnalyticsProviderError(`${claim.provider}_TOKEN_EXPIRED`, false, "BLOCKED", "Ricollega il social per aggiornare i risultati.");
  const info = metadata(connection.metadata);
  const capability = metricsCapability({ provider: claim.provider, connectionStatus: connection.status, providerAccountId: connection.provider_account_id, permissions: connection.permissions, linkedinOrganizationMode: info.accountType === "ORGANIZATION" });
  const linkedinBasicFallback = claim.provider === "LINKEDIN" && Array.isArray(connection.permissions) && connection.permissions.includes("w_member_social");
  if (!capability.available && !linkedinBasicFallback) throw new AnalyticsProviderError(capability.reason || "ANALYTICS_PERMISSION_MISSING", false, "BLOCKED", "Autorizza la lettura dei risultati per questo social.");
  const bundle = await decryptTokenBundle(connection.token_reference, env.SOCIAL_TOKEN_KEY!);
  if (claim.provider === "INSTAGRAM") return fetchInstagram(claim, connection, bundle.accessToken, env, runtime);
  if (claim.provider === "FACEBOOK") return fetchFacebook(claim, connection, bundle.accessToken, env, runtime);
  return fetchLinkedIn(claim, connection, bundle.accessToken, env, runtime);
}

function retryDelay(jobId: string, failures: number) {
  let hash = 0; for (const char of jobId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return Math.min(900 * (2 ** Math.max(failures, 0)), 21600) + hash % 181;
}

async function connectionFor(sql: Sql, claim: Claim) {
  const rows = await sql`select status,provider_account_id,token_reference,permissions,expires_at,metadata from public.social_connections where profile_id=${claim.profile_id}::uuid and provider=${claim.provider} limit 1` as unknown as Connection[];
  return rows[0] ?? { status: "NOT_CONNECTED", provider_account_id: null, token_reference: null, permissions: [], expires_at: null, metadata: {} };
}

async function complete(sql: Sql, claim: Claim, metrics: Record<string, number>) {
  if (!Object.keys(metrics).length) throw new AnalyticsProviderError(`${claim.provider}_ANALYTICS_EMPTY`, true, null, "Il social non ha restituito metriche utilizzabili.");
  const rows = await sql`select public.complete_analytics_sync(${claim.job_id}::uuid,${claim.claim_token}::uuid,${JSON.stringify(metrics)}::jsonb,clock_timestamp(),'PROVIDER_API')::text snapshot_id` as unknown as Array<{ snapshot_id: string | null }>;
  return rows[0]?.snapshot_id ?? null;
}

async function fail(sql: Sql, claim: Claim, error: AnalyticsProviderError, failures = 0) {
  const delay = error.code.endsWith("RATE_LIMITED") ? error.retryAfterSeconds : retryDelay(claim.job_id, failures);
  const rows = await sql`select public.fail_analytics_sync(${claim.job_id}::uuid,${claim.claim_token}::uuid,${error.code},${error.customerMessage},${error.retryable},${error.terminalState},${delay}) result` as unknown as Array<{ result: string }>;
  return rows[0]?.result ?? "STALE_CLAIM";
}

export async function processDueAnalytics(env: SocialEnv, limit = 20, runtime: FetchRuntime = {}) {
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY) return { ready: false, reason: "ANALYTICS_SECURITY_NOT_CONFIGURED", checked: 0, synced: 0, failed: 0 };
  const sql = neon(env.DATABASE_URL);
  const claims = await sql`select * from public.claim_due_analytics_syncs(${Math.min(Math.max(limit, 1), 50)},120)` as unknown as Claim[];
  let synced = 0; let failed = 0; let blocked = 0; let notFound = 0;
  for (const claim of claims) {
    try {
      const metrics = await fetchProviderMetrics(claim, await connectionFor(sql, claim), env, runtime);
      if (await complete(sql, claim, metrics)) synced += 1;
    } catch (reason) {
      const error = reason instanceof AnalyticsProviderError ? reason : new AnalyticsProviderError("ANALYTICS_TEMPORARY", true, null, "Risultati temporaneamente non aggiornabili.");
      const state = await fail(sql, claim, error);
      failed += 1; if (state === "BLOCKED") blocked += 1; if (state === "NOT_FOUND") notFound += 1;
      console.error("analytics-sync-item-failed", { provider: claim.provider, jobId: claim.job_id, code: error.code, state });
    }
  }
  return { ready: true, checked: claims.length, synced, failed, blocked, notFound };
}
