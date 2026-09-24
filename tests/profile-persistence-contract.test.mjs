import assert from "node:assert/strict";
import fs from "node:fs";

const onboarding = fs.readFileSync("src/pages/onboarding-page.tsx", "utf8");
const site = fs.readFileSync("src/pages/website-scan-page.tsx", "utf8");
const fullScan = fs.readFileSync("src/lib/full-website-scan.ts", "utf8");
const worker = fs.readFileSync("cloudflare/worker.ts", "utf8");
const settings = fs.readFileSync("src/pages/settings-page.tsx", "utf8");
const brand = fs.readFileSync("src/pages/brand-page.tsx", "utf8");
const profiles = fs.readFileSync("src/features/profiles/profile-context.tsx", "utf8");
const autosave = fs.readFileSync("src/lib/use-autosave-draft.ts", "utf8");

// Onboarding with a website must crawl before brand analysis/completion.
const analyzeStart = onboarding.indexOf("async function analyzeProfile");
const analyzeEnd = onboarding.indexOf("async function completeWithoutWebsite");
const analyzeBlock = onboarding.slice(analyzeStart, analyzeEnd);
assert.ok(analyzeStart >= 0 && analyzeEnd > analyzeStart, "onboarding analyzeProfile flow must exist");
assert.ok(analyzeBlock.indexOf("runFullWebsiteScan") >= 0, "onboarding must scan the website");
assert.ok(
  analyzeBlock.indexOf("runFullWebsiteScan") < analyzeBlock.indexOf('fetch("/api/onboarding-analyze"'),
  "onboarding must complete the persisted site crawl before brand analysis",
);
assert.match(analyzeBlock, /const crawlToken = await jwt\(\)[\s\S]*runFullWebsiteScan\([\s\S]*token: crawlToken/, "new-activity onboarding must use a dedicated token for the long site crawl");
assert.match(analyzeBlock, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)[\s\S]*const analysisToken = await jwt\(\)/, "brand analysis after onboarding crawl must obtain a fresh token and retry auth once");
assert.match(analyzeBlock, /analysisResponse\.status === 401 \|\| analysisBody\.error === "AUTH_REQUIRED"/, "new-activity brand auth retry must be limited to AUTH_REQUIRED");
assert.match(
  onboarding,
  /if \(!website\.trim\(\)\)[\s\S]*completeWithoutWebsite\(created\.id\)[\s\S]*await analyzeProfile\(created\.id\)/,
  "profiles with a configured website must enter the scan flow during onboarding",
);
assert.match(
  onboarding,
  /if \(profile\.website_url\?\.trim\(\)\) await analyzeProfile\(createdProfileId\)/,
  "an interrupted onboarding must resume the same persisted website scan",
);

// The Site page must restore persisted state from DB for the selected profile.
assert.match(site, /from\("website_scans"\)[\s\S]*eq\("profile_id", profileId\)[\s\S]*order\("created_at", \{ ascending: false \}\)\.limit\(1\)/,
  "Site page must reload the latest persisted scan for the selected activity");
assert.match(site, /from\("website_pages"\)[\s\S]*eq\("profile_id", profileId\)[\s\S]*eq\("scan_id", latest\.id\)/,
  "Site page must reload persisted pages scoped to both activity and scan");
assert.match(site, /from\("brand_profiles"\)[\s\S]*eq\("profile_id", profileId\)/,
  "site intelligence must remain persisted per activity");

// Manual re-scan creates a new scan; automatic continuation resumes the current scan.
const startScanStart = site.indexOf("async function startScan");
const startScanEnd = site.indexOf("const scanUiState");
const startScanBlock = site.slice(startScanStart, startScanEnd);
assert.match(startScanBlock, /forceNew: !automatic/, "manual Ripeti analisi must request a fresh scan");
assert.match(site, /onClick=\{\(\) => void startScan\(false\)\}/, "Ripeti analisi must remain available after onboarding");
assert.match(fullScan, /forceNew: Boolean\(input\.forceNew && batchIndex === 0\)/,
  "only the first batch of a manual re-scan may create a new scan");
const scanHandlerStart = worker.indexOf("async function handleWebsiteScan");
const scanHandlerEnd = worker.indexOf("async function routeApi", scanHandlerStart);
const scanHandler = worker.slice(scanHandlerStart, scanHandlerEnd);
assert.ok(scanHandlerStart >= 0 && scanHandlerEnd > scanHandlerStart, "website scan worker handler must exist");
assert.match(scanHandler, /if \(!forceNew\)[\s\S]*website_scans\?profile_id=eq\./,
  "automatic continuation must resume an existing persisted scan");
assert.match(scanHandler, /else \{[\s\S]*dataApi\("website_scans"[\s\S]*method: "POST"/,
  "a forced manual re-scan must append a new persisted scan");
assert.doesNotMatch(scanHandler, /method:\s*"DELETE"|\bDELETE\b/i,
  "re-scanning must never erase previous scan history");

// Activity settings and brand edits must persist to DB, not browser-only state.
assert.match(settings, /await updateProfile\(selectedProfile\.id,/, "activity settings must persist on the selected profile");
assert.match(brand, /from\("brand_profiles"\)[\s\S]*(?:update|insert)\(/,
  "brand settings must persist in brand_profiles");
assert.match(brand, /profile_id:\s*profileId/, "brand writes must remain activity-scoped");
assert.match(autosave, /await saveForThisDraft\(current\)/, "autosave must call the persistent save function");
assert.doesNotMatch(settings, /localStorage|sessionStorage/, "activity settings must not be stored only in browser storage");
assert.doesNotMatch(brand, /localStorage|sessionStorage/, "brand settings must not be stored only in browser storage");

// Browser storage is allowed only as a pointer to the active activity / onboarding idempotency.
assert.match(profiles, /post-automatici\.active-profile/, "the active profile pointer may persist locally");
assert.match(profiles, /post-automatici\.onboarding-operation/, "onboarding idempotency may persist for the current browser session");

console.log("PASS profile persistence contract: onboarding scan, persisted scan history, re-scan, and per-activity settings.");
