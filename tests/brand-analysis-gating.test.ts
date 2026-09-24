import assert from "node:assert/strict";
import fs from "node:fs";
import { BRAND_ANALYZE_CAPABILITY, BRAND_ANALYZE_TECHNICAL_OPERATION, deriveBrandAnalysisAttemptOperationKey, deriveBrandAnalysisOperationKey } from "../api/_lib/brand-analysis-metering.js";

const api = fs.readFileSync("api/onboarding-analyze.ts", "utf8");
const worker = fs.readFileSync("cloudflare/onboarding-analyze.ts", "utf8");
const metering = fs.readFileSync("api/_lib/brand-analysis-metering.ts", "utf8");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
const ui = fs.readFileSync("src/pages/onboarding-page.tsx", "utf8");
const analysisEngine = fs.readFileSync("api/_lib/brand-analysis.ts", "utf8");

assert.equal(BRAND_ANALYZE_CAPABILITY, "brand.analyze");
assert.equal(BRAND_ANALYZE_TECHNICAL_OPERATION, "ANALYZE_BRAND_ONBOARDING");

const profileA = "11111111-1111-1111-1111-111111111111";
const profileB = "22222222-2222-2222-2222-222222222222";
const scanA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const scanB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
assert.equal(deriveBrandAnalysisOperationKey(profileA, scanA), deriveBrandAnalysisOperationKey(profileA, scanA));
assert.notEqual(deriveBrandAnalysisOperationKey(profileA, scanA), deriveBrandAnalysisOperationKey(profileB, scanA));
assert.notEqual(deriveBrandAnalysisOperationKey(profileA, scanA), deriveBrandAnalysisOperationKey(profileA, scanB));
assert.equal(deriveBrandAnalysisAttemptOperationKey(profileA, scanA, 0), deriveBrandAnalysisOperationKey(profileA, scanA));
assert.equal(deriveBrandAnalysisAttemptOperationKey(profileA, scanA, 1), `${deriveBrandAnalysisOperationKey(profileA, scanA)}:retry:1`);
assert.notEqual(deriveBrandAnalysisAttemptOperationKey(profileA, scanA, 1), deriveBrandAnalysisAttemptOperationKey(profileA, scanA, 2));

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
  assert.match(source, /state=in\.\(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL\)/, "brand analysis must accept terminal scans completed with page warnings");
}

assert.match(metering, /CAPABILITY_DISABLED/);
assert.match(metering, /CAPABILITY_LIMIT_REACHED/);
assert.match(metering, /deriveBrandAnalysisAttemptOperationKey/);
assert.match(metering, /existing\.state === "RESERVED"/);
assert.match(metering, /retry_attempt: attempt/);
assert.match(metering, /STALE_RESERVED_RECOVERY/, "stale brand reservations must recover instead of blocking retries forever");
assert.match(metering, /10 \* 60 \* 1000/, "stale reservation recovery must use a conservative timeout");
assert.match(analysisEngine, /const MAX_PAGES = 160/, "large sites must keep up to 160 analyzed pages in brand context");
assert.match(analysisEngine, /maxItems: 160/, "structured page insights must support the large-site page count");
assert.match(analysisEngine, /reasoning: \{ effort: "low" \}/, "brand extraction should use the faster low-reasoning path");
assert.match(analysisEngine, /const MAX_OUTPUT_TOKENS = 16_000/, "large-site structured output must have enough bounded room without hidden provider retries");
assert.match(analysisEngine, /max_output_tokens: MAX_OUTPUT_TOKENS/, "each endpoint attempt must make one explicitly bounded provider call");
assert.match(analysisEngine, /body\.status === "incomplete"/, "incomplete OpenAI structured responses must be detected explicitly");
assert.match(api, /order=depth\.asc&limit=160/, "Vercel brand endpoint must read all supported large-site pages");
assert.match(worker, /order=depth\.asc&limit=160/, "Cloudflare brand endpoint must read all supported large-site pages");
assert.doesNotMatch(ui, /Sparkles|WandSparkles/, "onboarding must avoid decorative AI-sparkle iconography");
assert.match(ui, /aria-label="Avanzamento configurazione brand"/, "brand phase must expose a visible progress bar");
assert.match(ui, /Riprendi analisi brand/, "brand failure must expose a dedicated brand-only retry");
assert.match(ui, /fetch\("\/api\/onboarding-analyze"/);
assert.match(entry, /path === "\/api\/onboarding-analyze"\) return handleWorkerOnboardingAnalyze/);
assert.match(wrangler, /"main": "\.\/cloudflare\/entry\.ts"/);

console.log("Brand analysis server-side gating regression: PASS");
