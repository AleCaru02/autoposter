import assert from "node:assert/strict";
import fs from "node:fs";
import { BRAND_ANALYZE_CAPABILITY, BRAND_ANALYZE_TECHNICAL_OPERATION, deriveBrandAnalysisOperationKey } from "../api/_lib/brand-analysis-metering.js";

const api = fs.readFileSync("api/onboarding-analyze.ts", "utf8");
const worker = fs.readFileSync("cloudflare/onboarding-analyze.ts", "utf8");
const metering = fs.readFileSync("api/_lib/brand-analysis-metering.ts", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
const ui = fs.readFileSync("src/pages/onboarding-page.tsx", "utf8");

assert.equal(BRAND_ANALYZE_CAPABILITY, "brand.analyze");
assert.equal(BRAND_ANALYZE_TECHNICAL_OPERATION, "ANALYZE_BRAND_ONBOARDING");

const profileA = "11111111-1111-1111-1111-111111111111";
const profileB = "22222222-2222-2222-2222-222222222222";
const scanA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const scanB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
assert.equal(deriveBrandAnalysisOperationKey(profileA, scanA), deriveBrandAnalysisOperationKey(profileA, scanA));
assert.notEqual(deriveBrandAnalysisOperationKey(profileA, scanA), deriveBrandAnalysisOperationKey(profileB, scanA));
assert.notEqual(deriveBrandAnalysisOperationKey(profileA, scanA), deriveBrandAnalysisOperationKey(profileA, scanB));

for (const source of [api, worker]) {
  assert.match(source, /DATABASE_NOT_CONFIGURED/);
  assert.match(source, /BrandAnalysisMetering/);
  assert.match(source, /meter\.reserve\(\{ profileId, scanId: scan\.id \}\)/);
  assert.ok(source.indexOf("await meter.reserve") < source.indexOf("await analyzeBrandFromWebsite"), "provider callable before entitlement reserve");
  assert.ok(source.indexOf("await meter.markProviderStarted") < source.indexOf("await analyzeBrandFromWebsite"), "provider start is not recorded");
  assert.ok(source.indexOf("await meter.persistTechnicalUsage") < source.indexOf("const write = existingRows[0]"), "technical usage must be durable before product persistence");
  assert.ok(source.indexOf("await meter.storeResult") < source.indexOf("await meter.commit"), "result must be cached before logical commit");
  assert.match(source, /activeMeter\.release/);
  assert.match(source, /BRAND_ANALYSIS_IN_PROGRESS/);
  assert.doesNotMatch(source, /dataApi\("ai_usage_events"/);
}

assert.match(metering, /CAPABILITY_DISABLED/);
assert.match(metering, /CAPABILITY_LIMIT_REACHED/);
assert.match(ui, /fetch\("\/api\/onboarding-analyze"/);
assert.match(entry, /path === "\/api\/onboarding-analyze"\) return handleWorkerOnboardingAnalyze/);
assert.match(wrangler, /"main": "\.\/cloudflare\/entry\.ts"/);

console.log("Brand analysis server-side gating regression: PASS");
