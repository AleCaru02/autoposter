import assert from "node:assert/strict";
import fs from "node:fs";

const token = fs.readFileSync("src/lib/auth-token.ts", "utf8");
const brand = fs.readFileSync("src/pages/brand-page.tsx", "utf8");
const site = fs.readFileSync("src/pages/website-scan-page.tsx", "utf8");
const fullScan = fs.readFileSync("src/lib/full-website-scan.ts", "utf8");

assert.match(token, /authClient\.token\(/);
assert.match(token, /"X-Force-Fetch": "1"/);

for (const [name, source] of [["Brand", brand], ["Sito", site]]) {
  assert.match(source, /authenticatedApiToken\(\)/, `${name} must use the reliable same-origin Managed Auth token boundary`);
  assert.doesNotMatch(source, /getJWTToken/, `${name} must not reintroduce the JWT helper that failed during onboarding`);
  assert.match(source, /runFullWebsiteScan/, `${name} must use the authenticated shared full-site scanner`);
  assert.match(source, /fetch\("\/api\/onboarding-analyze"/);
}

assert.match(site, /async function requestBrandAnalysis\([\s\S]*authenticatedApiToken\(\)[\s\S]*fetch\("\/api\/onboarding-analyze"/, "brand analysis must obtain a fresh Managed Auth token at request time");
assert.match(site, /attempt < 2[\s\S]*AUTH_REQUIRED/, "brand analysis must retry auth once before surfacing session expiry");
assert.match(brand, /const scanToken = await jwt\(\)[\s\S]*runFullWebsiteScan\(\{ profileId, token: scanToken, forceNew: true \}\)/, "Brand reanalysis must use a dedicated token for the long crawler");
assert.match(brand, /for \(let attempt = 0; attempt < 2 && !analysisCompleted; attempt \+= 1\)[\s\S]*const analysisToken = await jwt\(\)/, "Brand analysis must obtain a fresh token after the crawler and retry auth once");
assert.match(brand, /analysisResponse\.status === 401 \|\| body\.error === "AUTH_REQUIRED"/, "Brand reanalysis auth retry must be limited to the authentication boundary");
assert.match(fullScan, /fetch\("\/api\/website-scan"/, "the shared full-site scanner must call the same-origin website-scan endpoint");
assert.match(fullScan, /authorization:\s*`Bearer \$\{input\.token\}`/, "the shared scanner must forward the Managed Auth bearer on every batch");
assert.doesNotMatch(fullScan, /getJWTToken/, "the shared scanner must not obtain or decode auth independently");

console.log("FASE 7A brand reanalysis Auth regression: PASS");
