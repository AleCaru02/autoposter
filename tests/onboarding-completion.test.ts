import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("db/migrations/20260905_fase5b_onboarding_completion.sql", "utf8");
const shared = fs.readFileSync("api/_lib/onboarding-completion.ts", "utf8");
const vercel = fs.readFileSync("api/onboarding-complete.ts", "utf8");
const worker = fs.readFileSync("cloudflare/onboarding-complete.ts", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
const ui = fs.readFileSync("src/pages/onboarding-page.tsx", "utf8");
const vercelAnalyze = fs.readFileSync("api/onboarding-analyze.ts", "utf8");
const workerAnalyze = fs.readFileSync("cloudflare/onboarding-analyze.ts", "utf8");
const legacyWorker = fs.readFileSync("cloudflare/worker.ts", "utf8");

assert.match(migration, /profiles_onboarding_completion_guard/);
assert.match(migration, /current_user = 'authenticated'[\s\S]*ONBOARDING_COMPLETION_SERVER_ONLY/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.complete_onboarding_profile/);
assert.match(migration, /profile\.owner_auth_user_id = p_actor_auth_user_id/);
assert.match(migration, /coalesce\(auth_user\.banned, false\) IS FALSE/);
assert.match(migration, /p_mode NOT IN \('NO_WEBSITE', 'BRAND_ANALYZED'\)/);
assert.match(migration, /ONBOARDING_WEBSITE_REQUIRES_ANALYSIS/);
assert.match(migration, /ONBOARDING_BRAND_REQUIRED/);
assert.match(migration, /ONBOARDING_COMPLETED/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.complete_onboarding_profile[\s\S]*PUBLIC, authenticated/);
assert.match(shared, /select public\.complete_onboarding_profile/);

for (const endpoint of [vercel, worker]) {
  assert.match(endpoint, /verifiedCustomerAuthUserId/);
  assert.match(endpoint, /completeOnboardingProfile/);
  assert.match(endpoint, /"NO_WEBSITE"/);
}
assert.match(entry, /path === "\/api\/onboarding-complete"\) return handleWorkerOnboardingComplete/);
assert.match(ui, /fetch\("\/api\/onboarding-complete"/);
assert.doesNotMatch(ui, /update\(\{ onboarding_completed: true/);
assert.doesNotMatch(legacyWorker, /onboarding_completed:\s*true/);
assert.doesNotMatch(legacyWorker, /path === "\/api\/onboarding-analyze"/);

for (const analyze of [vercelAnalyze, workerAnalyze]) {
  assert.match(analyze, /verifiedCustomerAuthUserId/);
  assert.equal((analyze.match(/completeOnboardingProfile\([^)]*"BRAND_ANALYZED"/g) ?? []).length, 2);
  const commit = analyze.indexOf("await meter.commit(eventId)");
  const freshCompletion = analyze.lastIndexOf("await completeOnboardingProfile");
  assert.ok(commit >= 0 && freshCompletion > commit, "fresh brand completion must follow logical commit");
  assert.doesNotMatch(analyze, /onboarding_completed: true/);
}

console.log("FASE 5B onboarding completion: PASS");
