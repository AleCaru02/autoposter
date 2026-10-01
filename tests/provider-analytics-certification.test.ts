import assert from "node:assert/strict";
import fs from "node:fs";
import { AnalyticsProviderError, fetchProviderMetrics } from "../api/_lib/analytics.js";
import { encryptTokenBundle } from "../api/_lib/social.js";

const analyticsSource = fs.readFileSync("api/_lib/analytics.ts", "utf8");
const probeSource = fs.readFileSync("cloudflare/provider-analytics-certify.ts", "utf8");
const migrationSource = fs.readFileSync("db/migrations/20260909_fase7h_analytics_ingestion.sql", "utf8");

assert.match(analyticsSource, /claim\.provider === "INSTAGRAM"[\s\S]*claim\.provider === "FACEBOOK"[\s\S]*fetchLinkedIn/);
assert.match(migrationSource, /provider IN \('INSTAGRAM','FACEBOOK','LINKEDIN'\)/);
assert.doesNotMatch(migrationSource, /provider IN \([^)]*GBP/);
assert.match(probeSource, /j\.state='PUBLISHED'/);
assert.match(probeSource, /j\.remote_post_id is not null/);
assert.match(probeSource, /contentId: candidate\.content_id[\s\S]*publicationJobId: candidate\.job_id[\s\S]*externalPostId: candidate\.external_post_id/);
assert.match(probeSource, /socialSafeModeState\(env\) !== "ON"/);
assert.match(probeSource, /method !== "GET" \|\| init\?\.body/);
assert.doesNotMatch(probeSource, /\b(?:insert into|update public|delete from)\b/i, "certification probe must query production read-only");

const secret = "provider-analytics-certification-test-secret";
const tokenReference = await encryptTokenBundle({ accessToken: "provider-read-token" }, secret);
const claim = {
  job_id: "00000000-0000-0000-0000-000000000101",
  profile_id: "00000000-0000-0000-0000-000000000102",
  variant_id: "00000000-0000-0000-0000-000000000103",
  content_id: "00000000-0000-0000-0000-000000000104",
  provider: "FACEBOOK" as const,
  external_post_id: "page_123_post_456",
  format: "POST",
  topic: "CERT",
  published_at: "2026-10-01T00:00:00.000Z",
  claim_token: "00000000-0000-0000-0000-000000000105",
  lease_expires_at: "2026-10-01T00:02:00.000Z",
};
const connection = {
  status: "ACTIVE",
  provider_account_id: "page_123",
  token_reference: tokenReference,
  permissions: ["pages_read_engagement"],
  expires_at: null,
  metadata: {},
};

type Call = { method: string; body: unknown; path: string; fields: string; metric: string };
const calls: Call[] = [];
const deterministicFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = (init?.method ?? "GET").toUpperCase();
  calls.push({
    method,
    body: init?.body ?? null,
    path: url.pathname,
    fields: url.searchParams.get("fields") ?? "",
    metric: url.searchParams.get("metric") ?? "",
  });

  const fields = url.searchParams.get("fields") ?? "";
  if (fields === "id") return Response.json({ id: claim.external_post_id });
  if (fields.startsWith("reactions")) return Response.json({ reactions: { summary: { total_count: 0 } } });
  if (fields.startsWith("comments")) return new Response("{}", { status: 400 });
  if (fields === "shares") return Response.json({ shares: { count: 2 } });
  if (url.pathname.endsWith("/insights")) {
    const metric = url.searchParams.get("metric");
    if (metric === "post_impressions_unique") return new Response("{}", { status: 400 });
    const value = metric === "post_impressions" ? 120 : metric === "post_engaged_users" ? 5 : 3;
    return Response.json({ data: [{ name: metric, values: [{ value }] }] });
  }
  return Response.json({});
};

const first = await fetchProviderMetrics(
  claim,
  connection,
  { SOCIAL_TOKEN_KEY: secret, META_GRAPH_VERSION: "v26.0" },
  { fetch: deterministicFetch },
);
const firstCallCount = calls.length;
const second = await fetchProviderMetrics(
  claim,
  connection,
  { SOCIAL_TOKEN_KEY: secret, META_GRAPH_VERSION: "v26.0" },
  { fetch: deterministicFetch },
);

assert.deepEqual(first, {
  reactions: 0,
  shares: 2,
  impressions: 120,
  engagement: 5,
  clicks: 3,
});
assert.deepEqual(second, first);
assert.equal(calls.length, firstCallCount * 2);
assert.ok(calls.every((call) => call.method === "GET"));
assert.ok(calls.every((call) => call.body === null));
assert.ok(calls.every((call) => call.path.includes(encodeURIComponent(claim.external_post_id))));
assert.equal("comments" in first, false, "unsupported optional metric must remain unavailable, not fabricated as zero");
assert.equal("reach" in first, false, "unsupported insight must remain unavailable, not fabricated as zero");
assert.equal(first.reactions, 0, "a real provider zero must be preserved as zero");

let providerCalls = 0;
await assert.rejects(
  fetchProviderMetrics(
    claim,
    { ...connection, expires_at: "2020-01-01T00:00:00.000Z" },
    { SOCIAL_TOKEN_KEY: secret },
    { fetch: async () => { providerCalls += 1; return Response.json({}); } },
  ),
  (reason: unknown) => reason instanceof AnalyticsProviderError
    && reason.code === "FACEBOOK_TOKEN_EXPIRED"
    && reason.terminalState === "BLOCKED",
);
assert.equal(providerCalls, 0);

for (const scenario of [
  { status: 403, code: "FACEBOOK_ANALYTICS_PERMISSION_DENIED", retryable: false, terminal: "BLOCKED" },
  { status: 404, code: "FACEBOOK_REMOTE_POST_NOT_FOUND", retryable: false, terminal: "NOT_FOUND" },
  { status: 429, code: "FACEBOOK_ANALYTICS_RATE_LIMITED", retryable: true, terminal: null },
  { status: 500, code: "FACEBOOK_ANALYTICS_TEMPORARY", retryable: true, terminal: null },
] as const) {
  await assert.rejects(
    fetchProviderMetrics(
      claim,
      connection,
      { SOCIAL_TOKEN_KEY: secret },
      { fetch: async () => new Response("{}", {
        status: scenario.status,
        headers: scenario.status === 429 ? { "retry-after": "120" } : {},
      }) },
    ),
    (reason: unknown) => reason instanceof AnalyticsProviderError
      && reason.code === scenario.code
      && reason.retryable === scenario.retryable
      && reason.terminalState === scenario.terminal
      && (scenario.status !== 429 || reason.retryAfterSeconds === 120),
  );
}

await assert.rejects(
  fetchProviderMetrics(
    claim,
    connection,
    { SOCIAL_TOKEN_KEY: secret },
    { fetch: async () => new Response("not-json", { status: 200 }) },
  ),
  (reason: unknown) => reason instanceof AnalyticsProviderError
    && reason.code === "FACEBOOK_ANALYTICS_MALFORMED"
    && reason.retryable,
);

for (const name of [
  "ANALYTICS_PROVIDER_MAPPING",
  "ANALYTICS_REMOTE_ID_MAPPING",
  "ANALYTICS_READ_ONLY",
  "ANALYTICS_NORMALIZATION",
  "ANALYTICS_NULL_VS_ZERO",
  "ANALYTICS_UNSUPPORTED_METRIC",
  "ANALYTICS_AUTH_EXPIRED",
  "ANALYTICS_PERMISSION_DENIED",
  "ANALYTICS_REMOTE_POST_NOT_FOUND",
  "ANALYTICS_RATE_LIMIT_HANDLING",
  "ANALYTICS_TEMPORARY_ERROR",
  "ANALYTICS_IDEMPOTENT_READ",
  "ANALYTICS_NO_EXTERNAL_WRITE",
]) {
  console.log(name + " = PASS");
}
console.log("PROVIDER ANALYTICS CERTIFICATION foundation: PASS — provider mapping, GET-only reads, semantic normalization and classified failures verified.");
