import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCustomerPlan, customerSocialState } from "../src/features/settings/customer-settings.js";

const profilesPage = await readFile(new URL("../src/pages/profiles-page.tsx", import.meta.url), "utf8");
const profileContext = await readFile(new URL("../src/features/profiles/profile-context.tsx", import.meta.url), "utf8");
const settingsPage = await readFile(new URL("../src/pages/settings-page.tsx", import.meta.url), "utf8");
const deletionGuard = await readFile(new URL("../db/migrations/20260915_fase7j_profile_delete_guard.sql", import.meta.url), "utf8");
const adminApi = await readFile(new URL("../cloudflare/admin-api.ts", import.meta.url), "utf8");
const profileArchiveWorker = await readFile(new URL("../cloudflare/profile-archive.ts", import.meta.url), "utf8");
const profileArchiveHelper = await readFile(new URL("../api/_lib/profile-archive.ts", import.meta.url), "utf8");
const workerEntry = await readFile(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
const provisioningDefaults = await readFile(new URL("../db/migrations/20260922_z_onboarding_package_defaults.sql", import.meta.url), "utf8");

assert.doesNotMatch(profileContext, /\.from\("profiles"\)\.delete\(/, "customer UI must not directly delete a profile");
assert.doesNotMatch(profileContext, /deleteProfile|\.delete\(/, "customer profile context must not expose direct deletion");
assert.match(profilesPage, /Elimina attività/, "activity owner must have an activity removal control");
assert.doesNotMatch(profilesPage, /adminRequest|\/api\/admin\/me/, "customer Activities UI must not depend on platform-admin role detection");
assert.match(profilesPage, /fetch\("\/api\/profile-archive"/, "activity removal must use the owner-scoped archive endpoint");
assert.match(profilesPage, /authenticatedApiToken\(\)/, "activity archive must use a fresh authenticated token");
assert.match(profilesPage, /window\.confirm/, "activity removal must require explicit confirmation");
assert.doesNotMatch(profilesPage, /Cancellazione attività|cancellazione definitiva non è ancora disponibile/i, "activities page must not show a dead deletion panel with no available action");
assert.match(profilesPage, /Nuova attività/, "activities page must expose real new-profile creation");
assert.match(profilesPage, /profile-active-badge/, "activities page must clearly identify the active profile");
assert.match(workerEntry, /path === "\/api\/profile-archive"\) return handleWorkerProfileArchive/, "production Worker must route the owner archive endpoint");
assert.match(profileArchiveWorker, /verifiedCustomerAuthUserId/, "archive endpoint must verify the authenticated customer identity server-side");
assert.match(profileArchiveWorker, /request\.method !== "POST"/, "activity archive must require POST");
assert.match(profileArchiveHelper, /owner_auth_user_id = \$\{authUserId\}/, "profile archive must be restricted to an activity owned by the authenticated user");
assert.match(profileArchiveHelper, /set archived_at = now\(\), updated_at = now\(\)/, "activity removal must archive instead of hard-delete");
assert.doesNotMatch(profileArchiveHelper, /delete from public\.profiles/i, "owner activity removal must not hard-delete profile rows");
assert.match(adminApi, /archiveActivityMatch/, "platform admin archive capability may remain available separately for backoffice use");
assert.doesNotMatch(provisioningDefaults, /PROFILE_LIMIT_REACHED|MAX_PROFILES|count\(\*\)[\s\S]{0,120}owner_auth_user_id/i, "current personal provisioning must not impose a numeric activity cap");
assert.match(settingsPage, /authClient\.updateUser\(\{ name \}\)/, "account name must be editable through the auth provider");
assert.match(settingsPage, /Dati account aggiornati\./, "account update must provide a clear success state");
assert.match(settingsPage, /Piano e utilizzo/, "settings must expose plan and usage in customer language");
assert.match(settingsPage, /Collegamenti social/, "settings must expose the four social connection states");
assert.match(settingsPage, /overview\?\.profileId === selectedProfile\.id/, "settings must never render a previous profile overview after tenant switching");
assert.match(settingsPage, /cancellazione definitiva dell.account non è ancora disponibile/i, "account deletion must be honestly classified as unavailable");

const plan = buildCustomerPlan([
  { capability_key: "ai.content.generate_text", enabled: true, limit_value: 50, period_type: "MONTH", source: "INTERNAL_BASELINE" },
  { capability_key: "autopilot.manage", enabled: true, limit_value: null, period_type: "NONE", source: "INTERNAL_BASELINE" },
  { capability_key: "internal.secret", enabled: true, limit_value: 1, period_type: "MONTH", source: "INTERNAL_BASELINE" },
], [{ capability_key: "ai.content.generate_text", committed_quantity: 17, reserved_quantity: 1 }]);
assert.deepEqual(plan, { name: "Piano personale", features: ["Creazione contenuti con AI", "Autopilot"], usage: [{ label: "contenuti AI", used: 18, limit: 50, periodLabel: "questo mese" }] });
assert.equal(JSON.stringify(plan).includes("ai.content.generate_text"), false, "customer output must not expose capability keys");
assert.deepEqual(customerSocialState({ provider: "INSTAGRAM", configured: true, status: "ACTIVE", permissions: ["instagram_basic"] }), { label: "Instagram", state: "Permesso Analytics mancante" });
assert.deepEqual(customerSocialState({ provider: "LINKEDIN", configured: true, status: "ACTIVE", permissions: ["w_member_social"] }), { label: "LinkedIn", state: "Permesso Analytics mancante" });
assert.deepEqual(customerSocialState({ provider: "FACEBOOK", configured: true, status: "ACTIVE", permissions: [] }), { label: "Facebook", state: "Collegato" });
assert.deepEqual(customerSocialState({ provider: "GBP", configured: false, status: "NOT_CONNECTED", permissions: [] }), { label: "Google Business Profile", state: "Da configurare" });
for (const [status, state] of [["NOT_CONNECTED", "Non collegato"], ["RECONNECT_REQUIRED", "Ricollega"], ["PROVIDER_ERROR", "Errore"], ["PENDING_SELECTION", "Connessione in corso"]]) {
  assert.deepEqual(customerSocialState({ provider: "FACEBOOK", configured: true, status, permissions: [] }), { label: "Facebook", state });
}
assert.equal(customerSocialState({ provider: "FACEBOOK", configured: true, status: "ACTIVE", permissions: [], expiresAt: "2000-01-01T00:00:00Z" }).state, "Ricollega");
assert.deepEqual(customerSocialState({ provider: "GBP", configured: true, status: "ACTIVE", permissions: [] }), { label: "Google Business Profile", state: "Collegato" });
assert.match(deletionGuard, /DROP POLICY IF EXISTS profiles_owner_delete ON public\.profiles/, "direct profile delete policy must be removed");
assert.match(deletionGuard, /REVOKE DELETE ON TABLE public\.profiles FROM authenticated/, "authenticated customers must not retain direct profile delete privileges");
assert.doesNotMatch(deletionGuard, /DELETE FROM|DROP TABLE|CASCADE/i, "guard migration must not delete customer data");

console.log("FASE 7J profile deletion safety: PASS");
