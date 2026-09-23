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

assert.match(fullScan, /fetch\("\/api\/website-scan"/, "the shared full-site scanner must call the same-origin website-scan endpoint");
assert.match(fullScan, /authorization:\s*`Bearer \$\{input\.token\}`/, "the shared scanner must forward the Managed Auth bearer on every batch");
assert.doesNotMatch(fullScan, /getJWTToken/, "the shared scanner must not obtain or decode auth independently");

console.log("FASE 7A brand reanalysis Auth regression: PASS");
