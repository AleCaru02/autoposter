import assert from "node:assert/strict";
import { AnalyticsProviderError, fetchProviderMetrics } from "../api/_lib/analytics.js";
import { encryptTokenBundle } from "../api/_lib/social.js";

const secret = "fase7h-runtime-contract-secret";
const token_reference = await encryptTokenBundle({ accessToken: "secret-provider-token" }, secret);
const baseClaim = {
  job_id: "00000000-0000-4000-8000-000000000001", profile_id: "00000000-0000-4000-8000-000000000002",
  variant_id: "00000000-0000-4000-8000-000000000003", content_id: "00000000-0000-4000-8000-000000000004",
  provider: "FACEBOOK" as const, external_post_id: "page_post", format: "POST", topic: "QA",
  published_at: new Date().toISOString(), claim_token: "00000000-0000-4000-8000-000000000005", lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
};
const facebookConnection = { status: "ACTIVE", provider_account_id: "page", token_reference, permissions: ["pages_read_engagement"], expires_at: null, metadata: {} };

for (const [status, code, retryable, terminal] of [
  [401, "FACEBOOK_ANALYTICS_RECONNECT_REQUIRED", false, "BLOCKED"],
  [403, "FACEBOOK_ANALYTICS_RECONNECT_REQUIRED", false, "BLOCKED"],
  [404, "FACEBOOK_REMOTE_POST_NOT_FOUND", false, "NOT_FOUND"],
  [429, "FACEBOOK_ANALYTICS_RATE_LIMITED", true, null],
  [500, "FACEBOOK_ANALYTICS_TEMPORARY", true, null],
] as const) {
  await assert.rejects(
    fetchProviderMetrics(baseClaim, facebookConnection, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => new Response("{}", { status, headers: status === 429 ? { "retry-after": "120" } : {} }) }),
    (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === code && reason.retryable === retryable && reason.terminalState === terminal && (status !== 429 || reason.retryAfterSeconds === 120),
  );
}

await assert.rejects(
  fetchProviderMetrics(baseClaim, facebookConnection, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => { throw new Error("network secret detail"); } }),
  (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === "FACEBOOK_ANALYTICS_TEMPORARY" && reason.customerMessage === "Risultati temporaneamente non aggiornabili.",
);

const linkedInClaim = { ...baseClaim, provider: "LINKEDIN" as const, external_post_id: "urn:li:share:1" };
const linkedInConnection = { ...facebookConnection, provider_account_id: "member", permissions: ["openid", "profile", "w_member_social", "r_member_postAnalytics"], metadata: { accountType: "MEMBER" } };
const linkedInQueries: string[] = [];
const linkedInMetrics = await fetchProviderMetrics(linkedInClaim, linkedInConnection, { SOCIAL_TOKEN_KEY: secret }, { fetch: async (input, init) => {
  const url = new URL(String(input)); const queryType = url.searchParams.get("queryType") || ""; linkedInQueries.push(queryType);
  const headers = new Headers(init?.headers); assert.equal(headers.get("authorization"), "Bearer secret-provider-token"); assert.equal(headers.get("Linkedin-Version"), "202608"); assert.equal(headers.get("X-Restli-Protocol-Version"), "2.0.0");
  assert.equal(url.searchParams.get("entity"), "(share:urn:li:share:1)"); assert.equal(url.searchParams.get("aggregation"), "TOTAL"); assert.equal(url.searchParams.has("pageType"), false);
  return Response.json({ elements: [{ metricType: queryType, count: queryType === "IMPRESSION" ? 10 : 1 }] });
} });
assert.deepEqual(linkedInQueries, ["IMPRESSION", "MEMBERS_REACHED", "REACTION", "COMMENT", "RESHARE", "LINK_CLICKS"]);
assert.deepEqual(linkedInMetrics, { impressions: 10, reach: 1, reactions: 1, comments: 1, shares: 1, link_clicks: 1 });

let providerCalled = false;
await assert.rejects(fetchProviderMetrics(linkedInClaim, { ...linkedInConnection, permissions: ["w_member_social"] }, { SOCIAL_TOKEN_KEY: secret }, { fetch: async () => { providerCalled = true; return Response.json({}); } }), (reason: unknown) => reason instanceof AnalyticsProviderError && reason.code === "MISSING_PERMISSIONS:r_member_postAnalytics" && reason.terminalState === "BLOCKED");
assert.equal(providerCalled, false, "publishing scope must never be used as analytics fallback");

console.log("FASE7H_RUNTIME_CONTRACT: PASS — provider errors and strict LinkedIn member analytics contract");
