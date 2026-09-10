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
const linkedInConnection = { ...facebookConnection, provider_account_id: "member", permissions: ["openid", "profile", "w_member_social"], metadata: { accountType: "MEMBER" } };
const linkedInMetrics = await fetchProviderMetrics(linkedInClaim, linkedInConnection, { SOCIAL_TOKEN_KEY: secret, LINKEDIN_API_VERSION: "202601" }, { fetch: async (_input, init) => {
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-provider-token");
  return Response.json({ likesSummary: { totalLikes: 3 }, commentsSummary: { totalFirstLevelComments: 2 } });
} });
assert.deepEqual(linkedInMetrics, { likes: 3, comments: 2 });

console.log("FASE7H_RUNTIME_CONTRACT: PASS — 401/403/404/429/5xx/network classification and LinkedIn fallback normalization");
