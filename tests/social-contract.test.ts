import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createOAuthState,
  decryptTokenBundle,
  encryptTokenBundle,
  googleApiJson,
  googleLocations,
  linkedinGrantedPermissions,
  metaGrantedPermissions,
  missingProviderConfiguration,
  providerCapabilities,
  providerConfigured,
  socialReadiness,
  verifyOAuthState,
  type SocialEnv,
} from "../api/_lib/social.js";
import { socialProviderUiLabel, socialProviderUiState } from "../src/lib/social-status-view.js";

const secret = "social-test-secret-0123456789-abcdef";
const base: SocialEnv = {
  DATABASE_URL: "postgresql://example.invalid/db",
  SOCIAL_TOKEN_KEY: secret,
};

async function run() {
  const encrypted = await encryptTokenBundle({ accessToken: "access-secret", refreshToken: "refresh-secret", expiresAt: "2030-01-01T00:00:00.000Z" }, secret);
  assert.notEqual(encrypted.includes("access-secret"), true, "encrypted token reference must not contain plaintext access token");
  const decrypted = await decryptTokenBundle(encrypted, secret);
  assert.equal(decrypted.accessToken, "access-secret");
  assert.equal(decrypted.refreshToken, "refresh-secret");

  const now = Date.UTC(2026, 7, 26, 12, 0, 0);
  const state = await createOAuthState({ provider: "FACEBOOK", profileId: "00000000-0000-4000-8000-000000000001", callbackUri: "https://example.com/api/social/callback/facebook" }, secret, now);
  const verified = await verifyOAuthState(state, secret, now + 60_000);
  assert.equal(verified.provider, "FACEBOOK");
  assert.equal(verified.profileId, "00000000-0000-4000-8000-000000000001");
  await assert.rejects(() => verifyOAuthState(state, secret, now + 11 * 60_000), /OAUTH_STATE_EXPIRED/);
  await assert.rejects(() => verifyOAuthState(`${state}x`, secret, now), /OAUTH_STATE_INVALID/);

  assert.equal(providerConfigured("FACEBOOK", base), false);
  assert.equal(providerConfigured("INSTAGRAM", { ...base, META_APP_ID: "id", META_APP_SECRET: "secret" }), true);
  assert.equal(providerConfigured("FACEBOOK", { ...base, META_APP_ID: "id", META_APP_SECRET: "secret" }), true);
  assert.equal(providerConfigured("LINKEDIN", { ...base, LINKEDIN_CLIENT_ID: "id", LINKEDIN_CLIENT_SECRET: "secret" }), true);
  assert.equal(providerConfigured("GBP", { ...base, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }), true);
  assert.equal(providerConfigured("GBP", { ...base, SOCIAL_TOKEN_KEY: "short", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }), false);
  assert.deepEqual(missingProviderConfiguration("FACEBOOK", base), ["META_APP_ID", "META_APP_SECRET"]);
  assert.deepEqual(missingProviderConfiguration("GBP", { ...base, SOCIAL_TOKEN_KEY: "short" }), ["SOCIAL_TOKEN_KEY (minimo 24 caratteri)", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);

  assert.deepEqual(providerCapabilities("INSTAGRAM").publish, ["POST", "STORY"]);
  assert.deepEqual(providerCapabilities("GBP").publish, ["POST"]);
  assert.equal(providerCapabilities("FACEBOOK").note.includes("non vengono simulati"), true);
  assert.equal(socialReadiness({ provider: "INSTAGRAM", configured: false, status: "NOT_CONNECTED" }).state, "BLOCKED_PROVIDER");
  assert.equal(socialReadiness({ provider: "INSTAGRAM", configured: true, status: "NOT_CONNECTED" }).state, "USER_ACTION_REQUIRED");
  assert.equal(socialReadiness({ provider: "INSTAGRAM", configured: true, status: "ACTIVE", permissions: ["instagram_manage_insights"] }).state, "PASS_REAL");
  assert.equal(socialReadiness({ provider: "INSTAGRAM", configured: true, status: "ACTIVE", permissions: [] }).state, "USER_ACTION_REQUIRED");
  assert.equal(socialReadiness({ provider: "FACEBOOK", configured: true, status: "PROVIDER_ERROR" }).state, "FAIL");

  const grantedMeta = await metaGrantedPermissions("meta-token", { META_GRAPH_VERSION: "v26.0" }, (async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v26.0/me/permissions");
    assert.equal(url.searchParams.get("access_token"), "meta-token");
    return Response.json({ data: [
      { permission: "instagram_basic", status: "granted" },
      { permission: "instagram_manage_insights", status: "declined" },
      { permission: "pages_read_engagement", status: "expired" },
    ] });
  }) as typeof fetch);
  assert.deepEqual(grantedMeta, ["instagram_basic"], "only permissions actually granted by Meta may be persisted");
  assert.deepEqual(linkedinGrantedPermissions("openid profile w_member_social", ["openid", "profile", "w_member_social", "r_member_postAnalytics"]), ["openid", "profile", "w_member_social"], "LinkedIn's returned scope must win when it is narrower than requested");
  assert.deepEqual(linkedinGrantedPermissions(undefined, ["openid", "profile"]), ["openid", "profile"], "an omitted OAuth scope means the granted scope is identical to the request");

  const calls: string[] = [];
  const waits: number[] = [];
  const responses = [
    new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }),
    new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 }),
    new Response(JSON.stringify({ accounts: [{ name: "accounts/1" }] }), { status: 200 }),
  ];
  const googleResult = await googleApiJson<{ accounts: Array<{ name: string }> }>("https://google.invalid/accounts", {}, {
    fetch: async (input) => { calls.push(String(input)); return responses.shift()!; },
    sleep: async (milliseconds) => { waits.push(milliseconds); },
    random: () => 0,
  });
  assert.equal(googleResult.attempts, 3, "429 retries must be bounded");
  assert.equal(calls.length, 3, "a provider request must never retry indefinitely");
  assert.deepEqual(waits, [250, 500], "429 retries must use exponential backoff");
  await assert.rejects(() => googleApiJson("https://google.invalid/accounts", {}, {
    fetch: async () => new Response("{}", { status: 429 }),
    sleep: async () => undefined,
    random: () => 0,
    maxAttempts: 99,
  }), /GBP_RATE_LIMITED/);

  const discoveryCalls: string[] = [];
  const discovered = await googleLocations("google-token", {
    fetch: (async (input) => {
      const url = new URL(String(input));
      discoveryCalls.push(url.toString());
      if (url.hostname === "mybusinessaccountmanagement.googleapis.com") return Response.json({ accounts: [
        { name: "accounts/personal", accountName: "Mario Rossi", type: "PERSONAL" },
        { name: "accounts/group", accountName: "Gruppo sedi", type: "LOCATION_GROUP" },
        { name: "accounts/org", accountName: "Organizzazione", type: "ORGANIZATION" },
      ] });
      if (url.pathname.includes("accounts/org/locations")) return Response.json({ locations: [{ name: "locations/123", title: "Sede Milano", storefrontAddress: { locality: "Milano", administrativeArea: "MI" } }] });
      return Response.json({ locations: [] });
    }) as typeof fetch,
    sleep: async () => undefined,
  });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0]?.accountId, "accounts/org");
  assert.equal(discovered[0]?.accountType, "ORGANIZATION");
  assert.ok(discoveryCalls.some((url) => url.includes("accounts/personal/locations")), "the personal account must be checked");
  assert.ok(discoveryCalls.some((url) => url.includes("accounts/group/locations")), "location groups must be checked");
  assert.ok(discoveryCalls.some((url) => url.includes("accounts/org/locations")), "organization accounts must be checked");

  await assert.rejects(() => googleLocations("google-token", { fetch: (async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "mybusinessaccountmanagement.googleapis.com") return Response.json({ accounts: [{ name: "accounts/1", type: "PERSONAL" }] });
    return Response.json({ error: { message: "API has not been used or is disabled", details: [{ reason: "SERVICE_DISABLED", metadata: { service: "mybusinessbusinessinformation.googleapis.com" } }] } }, { status: 403 });
  }) as typeof fetch }), /GBP_API_NOT_ENABLED/);
  await assert.rejects(() => googleLocations("google-token", { fetch: (async () => Response.json({ accounts: [] })) as typeof fetch }), /GBP_NO_ACCESSIBLE_ACCOUNT/);
  await assert.rejects(() => googleLocations("google-token", { fetch: (async (input) => new URL(String(input)).hostname === "mybusinessaccountmanagement.googleapis.com" ? Response.json({ accounts: [{ name: "accounts/1", type: "PERSONAL" }] }) : Response.json({ locations: [] })) as typeof fetch }), /GBP_ACCOUNT_WITHOUT_LOCATIONS/);

  const socialSource = readFileSync(new URL("../api/_lib/social.ts", import.meta.url), "utf8");
  const socialUiSource = readFileSync(new URL("../src/pages/social-page.tsx", import.meta.url), "utf8");
  const callbackMigration = readFileSync(new URL("../db/migrations/20260906_fase7b_social_oauth_idempotency.sql", import.meta.url), "utf8");
  const callbackSource = socialSource.slice(socialSource.indexOf("async function handleCallback"), socialSource.indexOf("async function handleStatus"));
  assert.equal(socialSource.includes("candidates.length === 1"), false, "OAuth callbacks must never auto-select the only discovered social account");
  assert.equal(socialSource.includes("on conflict (profile_id, provider)"), true, "a profile must keep at most one connection per provider");
  assert.equal((socialSource.match(/status: \"PENDING_SELECTION\"/g) ?? []).length >= 3, true, "Meta, LinkedIn organization and GBP callbacks must persist explicit selection state");
  assert.equal(socialUiSource.includes("Puoi collegare un solo account a questa attività. Scegli quale usare:"), true, "the Social UI must explain single-account selection clearly");
  assert.equal(socialUiSource.includes("Permesso Analytics mancante. Ricollega l’account"), true, "missing analytics consent must be visible without disconnecting the account");
  assert.equal(socialUiSource.includes("Ricollega</button>"), true, "an active provider must expose an explicit reconnect action");
  assert.equal(socialProviderUiState({ provider: "FACEBOOK", configured: true, status: "NOT_CONNECTED" }), "DISCONNECTED", "no connection record must render as disconnected");
  assert.equal(socialProviderUiLabel("DISCONNECTED"), "Non collegato");
  assert.equal(socialProviderUiState({ provider: "FACEBOOK", configured: true, status: "ACTIVE" }), "ACTIVE");
  assert.equal(socialProviderUiLabel("ACTIVE"), "Collegato");
  assert.equal(socialProviderUiState({ provider: "LINKEDIN", configured: true, status: "ACTIVE", expiresAt: "2026-01-01T00:00:00.000Z" }, Date.UTC(2026, 8, 23)), "RECONNECT", "expired LinkedIn authorization must request reconnect");
  assert.equal(socialProviderUiState({ provider: "FACEBOOK", configured: true, status: "RECONNECT_REQUIRED" }), "RECONNECT");
  assert.equal(socialProviderUiState({ provider: "FACEBOOK", configured: true, status: "ERROR" }), "ERROR", "real provider errors must remain errors");
  assert.equal(socialProviderUiState({ provider: "GBP", configured: false, status: "NOT_CONNECTED" }), "UNAVAILABLE", "missing provider configuration must not pretend to be disconnected");
  assert.equal(socialUiSource.includes("Nessun social collegato"), true, "0/4 must be a normal empty state");
  assert.equal(socialUiSource.includes("Collega almeno un account per iniziare a pubblicare."), true, "0/4 must explain the next action");
  assert.equal(socialUiSource.includes("Collega account"), true, "a disconnected provider must expose the correct CTA");
  assert.equal(socialUiSource.includes("PASS REAL"), true, "the UI must expose a truthful provider readiness matrix");
  assert.equal(socialUiSource.includes("Stato temporaneamente non disponibile"), false, "the UI must not fabricate unavailable provider states for 0/4");
  assert.equal(socialSource.includes('accountUrl.searchParams.set("pageSize", "20")'), true, "GBP accounts.list must respect Google's maximum page size");
  assert.equal(socialSource.includes('url.searchParams.set("prompt", "consent select_account")'), true, "GBP OAuth must force an explicit Google-account choice");
  for (const code of ["GBP_API_NOT_ENABLED", "GBP_NO_ACCESSIBLE_ACCOUNT", "GBP_ACCOUNT_WITHOUT_LOCATIONS", "GBP_LOCATION_DISCOVERY_DEFECT", "GBP_OAUTH_ACCOUNT_MISMATCH"]) assert.equal(socialUiSource.includes(code), true, `${code} must have a customer-safe explanation`);
  assert.equal(socialSource.includes("claimOAuthCallback"), true, "OAuth callback must be claimed before provider exchange or discovery");
  assert.equal(socialSource.includes("social_oauth_callbacks"), true, "OAuth callback idempotency must be durable");
  assert.equal(socialUiSource.includes("GBP_RATE_LIMITED"), true, "GBP quota errors must be understandable to customers");
  assert.equal(socialUiSource.includes("authenticatedApiToken"), true, "social actions must use the canonical authenticated token boundary");
  assert.equal(socialUiSource.includes("getJWTToken"), false, "social actions must not call the removed legacy JWT helper");
  assert.equal((socialUiSource.match(/\/api\/social\/connect/g) ?? []).length, 1, "one Connect action must start one server-side OAuth sequence");
  assert.equal((socialUiSource.match(/window\.location\.assign\(body\.url\)/g) ?? []).length, 1, "one Connect action must perform one provider navigation");
  assert.equal(callbackSource.indexOf("claimOAuthCallback") < callbackSource.indexOf("googleExchange(code"), true, "callback claim must happen before Google token exchange and discovery");
  assert.equal(callbackSource.indexOf("metaGrantedPermissions") < callbackSource.indexOf("metaPages(token.accessToken"), true, "Meta granted permissions must be verified before account discovery and persistence");
  assert.match(callbackSource, /permissions: grantedPermissions/, "Meta callbacks must persist provider-confirmed permissions, not requested scopes");
  assert.match(callbackSource, /linkedinGrantedPermissions\(token\.scope, requestedPermissions\)/, "LinkedIn callbacks must honor the scope returned by the token endpoint");
  assert.match(callbackMigration, /nonce text PRIMARY KEY/i, "callback nonce must be globally single-use");
  assert.match(callbackMigration, /FORCE ROW LEVEL SECURITY/i, "callback ledger must remain server-owned under forced RLS");
  assert.match(callbackMigration, /REVOKE ALL ON TABLE public\.social_oauth_callbacks FROM PUBLIC, authenticated/i, "customers must not read callback state or errors");

  console.log("social contract: PASS");
}

void run();
