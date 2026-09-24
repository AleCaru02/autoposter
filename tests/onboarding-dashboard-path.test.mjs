import assert from "node:assert/strict";
import fs from "node:fs";

const token = fs.readFileSync("src/lib/auth-token.ts", "utf8");
const profiles = fs.readFileSync("src/features/profiles/profile-context.tsx", "utf8");
const onboarding = fs.readFileSync("src/pages/onboarding-page.tsx", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
const app = fs.readFileSync("src/App.tsx", "utf8");
const profileBootstrap = fs.readFileSync("api/_lib/profile-bootstrap.ts", "utf8");
const workerProfileBootstrap = fs.readFileSync("cloudflare/profile-bootstrap.ts", "utf8");
const onboardingFlow = fs.readFileSync("src/lib/onboarding-flow.ts", "utf8");
const profilesPage = fs.readFileSync("src/pages/profiles-page.tsx", "utf8");

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
assert.match(profilesPage, /clearNewActivityFlow\(\); navigate\("\/onboarding\?new=1"\)/, "clicking Nuova attività must clear any stale resume target before entering onboarding");
assert.match(onboardingFlow, /NEW_ACTIVITY_FLOW_KEY = "post-automatici\.new-activity-flow"/, "new-activity resume state must have its own scoped browser key");
assert.match(onboardingFlow, /createdProfileId/, "new-activity resume state must remember only the exact created profile id");
assert.match(onboarding, /if \(newActivityProfileId\)[\s\S]*profiles\.find\(\(profile\) => profile\.id === newActivityProfileId\)/, "new-activity retry must resume only its exact saved profile");
assert.match(onboarding, /if \(requestedNewActivity\) return;[\s\S]*if \(!incompleteProfile\) return;/, "a fresh Nuova attività request must ignore unrelated incomplete profiles");
assert.match(onboarding, /rememberNewActivityProfile\(created\.id\)/, "once a new activity is actually created its exact id must become the only resume target");
assert.match(onboarding, /loading \|\| submitting \|\| stage !== "FORM"/, "the resume effect must not race an active profile creation");
assert.match(onboarding, /Annulla e torna alle attività/, "fresh new-activity onboarding must allow leaving before creating anything");
assert.match(onboarding, /profile\.website_url\?\.trim\(\)[\s\S]*analyzeProfile\(createdProfileId\)[\s\S]*completeWithoutWebsite\(createdProfileId\)/, "resume must choose website analysis or no-website completion from persisted state");
assert.match(onboarding, /fetch\("\/api\/onboarding-complete"/, "no-website completion must remain server-owned");
assert.match(onboarding, /navigate\("\/app\/dashboard"/, "completed onboarding must expose the dashboard transition");
assert.match(onboarding, /authenticatedApiToken\(\)/, "analysis and completion must use the same reliable token boundary");
assert.doesNotMatch(onboarding, /getJWTToken/);
assert.match(profiles, /PROFILE_BOOTSTRAP_RETRY_DELAYS_MS = \[0, 250, 700\]/, "hard refresh must absorb the short auth/session warmup race automatically");
assert.match(profiles, /for \(let attempt = 0; attempt < PROFILE_BOOTSTRAP_RETRY_DELAYS_MS\.length; attempt \+= 1\)/, "profile bootstrap must retry a bounded number of times");
assert.match(profiles, /const token = await authenticatedApiToken\(\)[\s\S]*fetch\("\/api\/profile-bootstrap"/, "every bootstrap attempt must obtain a fresh Managed Auth token before the same-origin server request");
assert.match(profiles, /return body\.profiles/, "an authoritative successful empty profile list must return immediately instead of being retried");
assert.match(profiles, /authorization: \`Bearer \$\{token\}\`/, "profile bootstrap request must carry the verified bearer token explicitly");
assert.doesNotMatch(profiles, /authenticatedProfileRows|NEON_DATA_API_URL/, "profile existence must not be inferred from a direct client Data API read after hard refresh");
assert.match(entry, /path === "\/api\/profile-bootstrap"\) return handleWorkerProfileBootstrap/, "Cloudflare production must route the profile bootstrap endpoint");
assert.match(workerProfileBootstrap, /verifiedCustomerAuthUserId/, "profile bootstrap must verify the Managed Auth bearer server-side");
assert.match(profileBootstrap, /where p\.owner_auth_user_id = \$\{authUserId\}/, "server bootstrap must resolve profiles from the verified owner identity");
assert.match(profileBootstrap, /left join public\.profile_tenant_modes/, "server bootstrap must return the tenant mode with the profile");
assert.ok(
  app.indexOf('if (error) return <main className="center-state profile-load-error"') <
    app.indexOf('if (profiles.length === 0) return <Navigate to="/onboarding" replace />'),
  "profile bootstrap errors must fail closed before the zero-profile onboarding redirect",
);

console.log("onboarding authenticated dashboard path regression: PASS");
