import assert from "node:assert/strict";
import fs from "node:fs";
import { AnalyticsProviderError, fetchProviderMetrics } from "../api/_lib/analytics.js";
import { encryptTokenBundle } from "../api/_lib/social.js";

const migration = fs.readFileSync("db/migrations/20260909_fase7h_analytics_ingestion.sql", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
const social = fs.readFileSync("api/_lib/social.ts", "utf8");
const analyticsUi = fs.readFileSync("src/pages/analytics-page.tsx", "utf8");
const dashboard = fs.readFileSync("src/pages/dashboard-page.tsx", "utf8");

for (const fragment of [
  "FOR UPDATE OF target SKIP LOCKED", "metric_snapshots_post_hour_unique", "complete_analytics_sync",
  "fail_analytics_sync", "consecutive_failures", "lease_expires_at", "FORCE ROW LEVEL SECURITY",
  "REVOKE ALL ON TABLE public.analytics_sync_targets", "GRANT SELECT ON TABLE public.metric_snapshots TO authenticated",
]) assert.ok(migration.includes(fragment), `missing analytics invariant: ${fragment}`);
assert.match(migration, /CREATE POLICY metric_snapshots_customer_read[\s\S]*public\.owns_profile\(profile_id\)/);
assert.match(migration, /p_retry_after_seconds<60[\s\S]*p_retry_after_seconds>86400/);
assert.match(entry, /processDueAnalytics\(env\)/);
assert.match(analyticsUi, /external_post_id,format,topic,published_at,captured_at,metrics/);
assert.equal(analyticsUi.includes("result.error.message"), false, "customer UI must not expose raw Data API errors");
assert.match(dashboard, /latestByPost/);
assert.match(social, /\["openid", "profile", "rw_organization_admin", "w_organization_social"\]/, "organization OAuth must request the analytics-capable admin scope");
assert.equal(social.includes('["openid", "profile", "r_organization_admin", "w_organization_social"]'), false);

const secret = "analytics-test-secret-0123456789";
const tokenReference = await encryptTokenBundle({ accessToken: "provider-secret-token" }, secret);
const claim = {
  job_id: "00000000-0000-0000-0000-000000000001", profile_id: "00000000-0000-0000-0000-000000000002",
  variant_id: "00000000-0000-0000-0000-000000000003", content_id: "00000000-0000-0000-0000-000000000004",
  provider: "FACEBOOK" as const, external_post_id: "page_post", format: "POST", topic: "QA",
  published_at: "2026-09-09T00:00:00Z", claim_token: "00000000-0000-0000-0000-000000000005", lease_expires_at: "2026-09-09T00:02:00Z",
};
const connection = { status: "ACTIVE", provider_account_id: "page", token_reference: tokenReference, permissions: ["pages_read_engagement"], expires_at: null, metadata: {} };
const seen: Array<{ url: string; authorization: string | null }> = [];
const providerFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input)); const headers = new Headers(init?.headers); seen.push({ url: url.toString(), authorization: headers.get("authorization") });
  if (!url.pathname.endsWith("/insights")) return Response.json({ reactions: { summary: { total_count: 8 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } });
  const metric = url.searchParams.get("metric");
  return Response.json({ data: [{ name: metric, values: [{ value: metric === "post_impressions" ? 100 : metric === "post_impressions_unique" ? 70 : 4 }] }] });
};
const metrics = await fetchProviderMetrics(claim, connection, { SOCIAL_TOKEN_KEY: secret, META_GRAPH_VERSION: "v23.0" }, { fetch: providerFetch });
assert.deepEqual(metrics, { reactions: 8, comments: 2, shares: 1, impressions: 100, reach: 70, engagement: 4, clicks: 4 });
assert.ok(seen.every((item) => item.authorization === "Bearer provider-secret-token"));
assert.ok(seen.every((item) => !item.url.includes("provider-secret-token")), "provider token must never enter URLs/logs");

const partialFacebook = await fetchProviderMetrics(claim, connection, { SOCIAL_TOKEN_KEY: secret, META_GRAPH_VERSION: "v23.0" }, { fetch: async (input) => {
  const url = new URL(String(input)); const fields = url.searchParams.get("fields") || "";
  if (fields === "id") return Response.json({ id: "page_post" });
  if (fields.startsWith("reactions") || fields.startsWith("comments")) return new Response("{}", { status: 400 });
  if (fields === "shares") return Response.json({ shares: { count: 2 } });
  return new Response("{}", { status: 400 });
} });
assert.deepEqual(partialFacebook, { shares: 2 }, "unsupported optional counters must not discard valid real metrics");

const linkedInClaim = { ...claim, provider: "LINKEDIN" as const, external_post_id: "urn:li:share:7503297798210113536" };
const linkedInConnection = { ...connection, provider_account_id: "member-1", permissions: ["w_member_social", "r_member_postAnalytics"], metadata: { accountType: "MEMBER" } };
const linkedInCalls: Array<{ url: URL; headers: Headers; method: string }> = [];
const linkedInCounts: Record<string, number> = { IMPRESSION: 101, MEMBERS_REACHED: 73, REACTION: 8, COMMENT: 3, RESHARE: 2, LINK_CLICKS: 11 };
const linkedInMetrics = await fetchProviderMetrics(linkedInClaim, linkedInConnection, { SOCIAL_TOKEN_KEY: secret }, { fetch: async (input, init) => {
  const url = new URL(String(input)); const headers = new Headers(init?.headers); const queryType = url.searchParams.get("queryType") || "";
  linkedInCalls.push({ url, headers, method: init?.method || "GET" });
  const metricType = queryType === "REACTION" ? { "com.linkedin.adsexternalapi.memberanalytics.v1.CreatorPostAnalyticsMetricTypeV1": queryType } : queryType;
  return Response.json({ elements: [{ metricType, count: linkedInCounts[queryType] }] });
} });
assert.deepEqual(linkedInMetrics, { impressions: 101, reach: 73, reactions: 8, comments: 3, shares: 2, link_clicks: 11 });
assert.deepEqual(linkedInCalls.map((item) => item.url.searchParams.get("queryType")), ["IMPRESSION", "MEMBERS_REACHED", "REACTION", "COMMENT", "RESHARE", "LINK_CLICKS"]);
for (const item of linkedInCalls) {
  assert.equal(item.method, "GET");
  assert.equal(item.url.pathname, "/rest/memberCreatorPostAnalytics");
  assert.equal(item.url.searchParams.get("q"), "entity");
  assert.equal(item.url.searchParams.get("entity"), "(share:urn:li:share:7503297798210113536)");
  assert.equal(item.url.searchParams.get("aggregation"), "TOTAL");
  assert.equal(item.url.searchParams.has("pageType"), false);
  assert.equal(item.headers.get("X-Restli-Protocol-Version"), "2.0.0");
  assert.equal(item.headers.get("Linkedin-Version"), "202608");
  assert.equal(item.headers.get("authorization"), "Bearer provider-secret-token");
}

const ugcEntities: string[] = []; const ugcVersions: string[] = [];
await fetchProviderMetrics({ ...linkedInClaim, external_post_id: "urn:li:ugcPost:7503297798210113537" }, linkedInConnection, { SOCIAL_TOKEN_KEY: secret, LINKEDIN_API_VERSION: "invalid" }, { fetch: async (input, init) => {
  const url = new URL(String(input)); ugcEntities.push(url.searchParams.get("entity") || ""); ugcVersions.push(new Headers(init?.headers).get("Linkedin-Version") || "");
  return Response.json({ elements: [{ metricType: url.searchParams.get("queryType"), count: 0 }] });
} });
assert.deepEqual([...new Set(ugcEntities)], ["(ugc:urn:li:ugcPost:7503297798210113537)"], "ugcPost must use the Rest.li ugc entity wrapper");
assert.deepEqual([...new Set(ugcVersions)], ["202608"], "invalid LinkedIn versions must fail closed to the supported fallback");

let organizationUrl: URL | null = null;
const organizationMetrics = await fetchProviderMetrics(linkedInClaim, { ...linkedInConnection, provider_account_id: "12345", permissions: ["rw_organization_admin", "w_organization_social"], metadata: { accountType: "ORGANIZATION" } }, { SOCIAL_TOKEN_KEY: secret }, { fetch: async (input) => {
  organizationUrl = new URL(String(input));
  return Response.json({ elements: [{ totalShareStatistics: { impressionCount: 90, uniqueImpressionsCount: 55, clickCount: 7, likeCount: 4, commentCount: 2, shareCount: 1 } }] });
} });
assert.deepEqual(organizationMetrics, { impressions: 90, reach: 55, clicks: 7, likes: 4, comments: 2, shares: 1 });
assert.equal(organizationUrl?.pathname, "/rest/organizationalEntityShareStatistics");
assert.equal(organizationUrl?.searchParams.get("organizationalEntity"), "urn:li:organization:12345");
assert.equal(organizationUrl?.searchParams.get("shares"), "List(urn:li:share:7503297798210113536)");

let linkedInProviderCalls = 0;
await assert.rejects(
  fetchProviderMetrics(linkedInClaim, { ...linkedInConnection, permissions: ["w_member_social"] }, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => { linkedInProviderCalls += 1; return Response.json({}); } }),
  (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === "MISSING_PERMISSIONS:r_member_postAnalytics" && reason.terminalState === "BLOCKED",
);
assert.equal(linkedInProviderCalls, 0, "missing analytics scope must fail before a provider call");
await assert.rejects(
  fetchProviderMetrics(linkedInClaim, { ...linkedInConnection, permissions: ["r_organization_admin", "w_organization_social"], metadata: { accountType: "ORGANIZATION" } }, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => { linkedInProviderCalls += 1; return Response.json({}); } }),
  (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === "MISSING_PERMISSIONS:rw_organization_admin" && reason.terminalState === "BLOCKED",
);
assert.equal(linkedInProviderCalls, 0, "read-only organization admin scope must not claim analytics capability");

for (const [status, expectedCode] of [[401, "LINKEDIN_ANALYTICS_RECONNECT_REQUIRED"], [403, "LINKEDIN_ANALYTICS_RECONNECT_REQUIRED"], [400, "LINKEDIN_ANALYTICS_REQUEST_REJECTED"]] as const) {
  await assert.rejects(
    fetchProviderMetrics(linkedInClaim, linkedInConnection, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => new Response("{}", { status }) }),
    (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === expectedCode && !reason.retryable && reason.terminalState === "BLOCKED",
  );
}

linkedInProviderCalls = 0;
await assert.rejects(
  fetchProviderMetrics({ ...linkedInClaim, external_post_id: "urn:li:post:not-valid" }, linkedInConnection, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => { linkedInProviderCalls += 1; return Response.json({}); } }),
  (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === "LINKEDIN_REMOTE_POST_ID_INVALID" && reason.terminalState === "NOT_FOUND",
);
assert.equal(linkedInProviderCalls, 0, "invalid LinkedIn URN must fail before a provider call");

for (const [status, expectedCode, retryable, terminal] of [[401, "FACEBOOK_ANALYTICS_RECONNECT_REQUIRED", false, "BLOCKED"], [429, "FACEBOOK_ANALYTICS_RATE_LIMITED", true, null]] as const) {
  await assert.rejects(
    fetchProviderMetrics(claim, connection, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => new Response("{}", { status, headers: status === 429 ? { "retry-after": "120" } : {} }) }),
    (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === expectedCode && reason.retryable === retryable && reason.terminalState === terminal,
  );
}

await assert.rejects(
  fetchProviderMetrics(claim, connection, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => new Response("not-json", { status: 200 }) }),
  (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === "FACEBOOK_ANALYTICS_MALFORMED" && reason.retryable,
);

console.log("PASS FASE 7H analytics: server scheduling, atomic claim, idempotent snapshots, RLS, safe errors and real provider payload normalization verified.");
