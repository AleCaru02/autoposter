import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCustomerPlan, customerSocialState } from "../src/features/settings/customer-settings.js";

const profilesPage = await readFile(new URL("../src/pages/profiles-page.tsx", import.meta.url), "utf8");
const profileContext = await readFile(new URL("../src/features/profiles/profile-context.tsx", import.meta.url), "utf8");
const settingsPage = await readFile(new URL("../src/pages/settings-page.tsx", import.meta.url), "utf8");
const deletionGuard = await readFile(new URL("../db/migrations/20260915_fase7j_profile_delete_guard.sql", import.meta.url), "utf8");

assert.doesNotMatch(profileContext, /\.from\("profiles"\)\.delete\(/, "customer UI must not directly delete a profile");
assert.doesNotMatch(profilesPage, /deleteProfile|Eliminare definitivamente|Trash2/, "unsafe profile deletion must not be exposed");
assert.match(profilesPage, /La cancellazione definitiva non è ancora disponibile/, "customer must see an honest non-technical status");
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
