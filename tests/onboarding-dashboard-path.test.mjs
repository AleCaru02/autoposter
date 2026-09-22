import assert from "node:assert/strict";
import fs from "node:fs";

const token = fs.readFileSync("src/lib/auth-token.ts", "utf8");
const profiles = fs.readFileSync("src/features/profiles/profile-context.tsx", "utf8");
const onboarding = fs.readFileSync("src/pages/onboarding-page.tsx", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");

assert.match(token, /authClient\.token\(/, "authenticated API calls must use the Managed Auth token endpoint");
assert.match(token, /"X-Force-Fetch": "1"/, "token retrieval must bypass stale SDK cache");
assert.doesNotMatch(token, /getJWTToken/, "the failing legacy JWT helper must not return to onboarding");
assert.match(profiles, /authenticatedApiToken\(\)[\s\S]*fetch\("\/api\/onboarding-provision"/, "profile creation must authenticate before server provisioning");
assert.doesNotMatch(profiles, /getJWTToken|from\(["']profiles["']\)\.insert/, "onboarding must neither use the legacy token helper nor insert profiles directly");
assert.match(entry, /path === "\/api\/onboarding-provision"\) return handleWorkerOnboardingProvision/);
assert.match(onboarding, /const created = await createProfile[\s\S]*completeWithoutWebsite\(created\.id\)[\s\S]*analyzeProfile\(created\.id\)/, "authenticated onboarding must keep both completion paths after provisioning");
assert.match(onboarding, /const incompleteProfile = useMemo\(\(\) => profiles\.find\(\(profile\) => !profile\.onboarding_completed\)/, "saved incomplete profiles must be detected");
assert.match(onboarding, /stage === "FORM" && !incompleteProfile\) return <Navigate to="\/app\/dashboard"/, "only completed existing profiles may skip onboarding");
assert.match(onboarding, /setCreatedProfileId\(incompleteProfile\.id\)[\s\S]*setStage\("ERROR"\)/, "incomplete onboarding must resume the saved profile instead of creating another one");
assert.match(onboarding, /profile\.website_url\?\.trim\(\)[\s\S]*analyzeProfile\(createdProfileId\)[\s\S]*completeWithoutWebsite\(createdProfileId\)/, "resume must choose website analysis or no-website completion from persisted state");
assert.match(onboarding, /fetch\("\/api\/onboarding-complete"/, "no-website completion must remain server-owned");
assert.match(onboarding, /navigate\("\/app\/dashboard"/, "completed onboarding must expose the dashboard transition");
assert.match(onboarding, /authenticatedApiToken\(\)/, "analysis and completion must use the same reliable token boundary");
assert.doesNotMatch(onboarding, /getJWTToken/);

console.log("onboarding authenticated dashboard path regression: PASS");
