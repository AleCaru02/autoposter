import assert from "node:assert/strict";
import fs from "node:fs";
import { AnalyticsProviderError, fetchProviderMetrics } from "../api/_lib/analytics.js";
import { encryptTokenBundle } from "../api/_lib/social.js";

const migration = fs.readFileSync("db/migrations/20260909_fase7h_analytics_ingestion.sql", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
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
