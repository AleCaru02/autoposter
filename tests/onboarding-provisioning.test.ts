import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("db/migrations/20260905_fase5a_onboarding_provisioning.sql", "utf8");
const shared = fs.readFileSync("api/_lib/onboarding-provisioning.ts", "utf8");
const auth = fs.readFileSync("api/_lib/verified-customer-auth.ts", "utf8");
const vercel = fs.readFileSync("api/onboarding-provision.ts", "utf8");
const worker = fs.readFileSync("cloudflare/onboarding-provision.ts", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
const client = fs.readFileSync("src/features/profiles/profile-context.tsx", "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.onboarding_profile_provisioning/);
assert.match(migration, /PRIMARY KEY \(owner_auth_user_id, operation_id\)/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /ONBOARDING_IDEMPOTENCY_CONFLICT/);
assert.match(migration, /INSERT INTO public\.profiles/);
assert.match(migration, /PERFORM public\.apply_entitlement_package\([\s\S]*'commercial_guarded'[\s\S]*'ONBOARDING_SERVER'/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.provision_onboarding_profile[\s\S]*PUBLIC, authenticated/);

assert.match(auth, /\$\{DATA_API\}\/rpc\/current_auth_user_id/);
assert.match(auth, /coalesce\(banned, false\)/);
assert.doesNotMatch(auth, /JSON\.parse\([^)]*split\("\."\)/, "server auth must not trust decoded JWT claims");
assert.match(shared, /SHA-256/);
assert.match(shared, /select \* from public\.provision_onboarding_profile/);
assert.match(shared, /operationId\.replace/);

for (const endpoint of [vercel, worker]) {
  assert.match(endpoint, /verifiedCustomerAuthUserId/);
  assert.match(endpoint, /provisionOnboardingProfile/);
  assert.match(endpoint, /ONBOARDING_IDEMPOTENCY_CONFLICT/);
}
assert.match(entry, /path === "\/api\/onboarding-provision"\) return handleWorkerOnboardingProvision/);
assert.match(client, /fetch\("\/api\/onboarding-provision"/);
assert.match(client, /sessionStorage\.setItem\(ONBOARDING_OPERATION_KEY/);
assert.match(client, /sessionStorage\.removeItem\(ONBOARDING_OPERATION_KEY/);
assert.doesNotMatch(client, /from\("profiles"\)\.insert/, "profile creation must use the authenticated server provisioning boundary");

console.log("FASE 5A onboarding provisioning: PASS");
