import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createOAuthState,
  decryptTokenBundle,
  encryptTokenBundle,
  missingProviderConfiguration,
  providerCapabilities,
  providerConfigured,
  verifyOAuthState,
  type SocialEnv,
} from "../api/_lib/social.js";

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

  const socialSource = readFileSync(new URL("../api/_lib/social.ts", import.meta.url), "utf8");
  const socialUiSource = readFileSync(new URL("../src/pages/social-page.tsx", import.meta.url), "utf8");
  assert.equal(socialSource.includes("candidates.length === 1"), false, "OAuth callbacks must never auto-select the only discovered social account");
  assert.equal(socialSource.includes("on conflict (profile_id, provider)"), true, "a profile must keep at most one connection per provider");
  assert.equal((socialSource.match(/status: \"PENDING_SELECTION\"/g) ?? []).length >= 3, true, "Meta, LinkedIn organization and GBP callbacks must persist explicit selection state");
  assert.equal(socialUiSource.includes("Puoi collegare un solo account a questa attività. Scegli quale usare:"), true, "the Social UI must explain single-account selection clearly");

  console.log("social contract: PASS");
}

void run();
