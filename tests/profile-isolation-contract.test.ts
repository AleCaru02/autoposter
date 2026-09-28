import assert from "node:assert/strict";
import fs from "node:fs";
import { learningContext, type PersistedLearningInsight } from "../api/_lib/learning-guidance.js";

const PROPERTY = "11111111-1111-4111-8111-111111111111";
const NETWORK = "22222222-2222-4222-8222-222222222222";
const base = {
  dimension: "TOPIC" as const,
  sample_size: 8,
  total_scorable_samples: 16,
  uplift_pct: 30,
  confidence: "HIGH" as const,
  recommendation: "Usa il tema quando pertinente",
  metric_basis: "engagement",
  observed_from: "2026-09-01T00:00:00.000Z",
  observed_to: "2026-09-20T00:00:00.000Z",
  generated_at: "2026-09-21T00:00:00.000Z",
  active: true,
};
const rows: PersistedLearningInsight[] = [
  { ...base, profile_id: PROPERTY, dimension_value: "PROPERTY_ONLY_SIGNAL" },
  { ...base, profile_id: NETWORK, dimension_value: "NETWORK_ONLY_SIGNAL" },
];

const propertyContext = learningContext(PROPERTY, rows);
const networkContext = learningContext(NETWORK, rows);
assert.deepEqual(propertyContext.map((row) => row.value), ["PROPERTY_ONLY_SIGNAL"], "NETWORK → PROPERTY learning contamination must be impossible");
assert.deepEqual(networkContext.map((row) => row.value), ["NETWORK_ONLY_SIGNAL"], "PROPERTY → NETWORK learning contamination must be impossible");

const autopilot = fs.readFileSync("api/_lib/autopilot.ts", "utf8");
const personalBrandSources = fs.readFileSync("api/_lib/personal-brand-sources.ts", "utf8");
const social = fs.readFileSync("api/_lib/social.ts", "utf8");
const analytics = fs.readFileSync("db/migrations/20260909_fase7h_analytics_ingestion.sql", "utf8");
const learning = fs.readFileSync("db/migrations/20260917_fase7i_learning_runtime.sql", "utf8");
const publication = fs.readFileSync("db/migrations/20260908_fase7f_safe_publication_engine.sql", "utf8");
const activityBudget = fs.readFileSync("api/_lib/activity-budget.ts", "utf8");
const tenantAudit = fs.readFileSync("cloudflare/tenant-security.ts", "utf8");
const generateText = fs.readFileSync("cloudflare/generate-text.ts", "utf8");

assert.match(autopilot, /loadProfileBrandContext\(sql,profile\)/, "autopilot must delegate profile-scoped brand/site loading through the Personal Brand Sources boundary");
for (const [label, pattern] of [
  ["Brand Brain", /brand_profiles[\s\S]*where profile_id=\$\{profile\.id\}::uuid/],
  ["website scan", /website_scans[\s\S]*where profile_id=\$\{profile\.id\}::uuid/],
  ["website pages", /website_pages[\s\S]*where profile_id=\$\{profile\.id\}::uuid[\s\S]*scan_id=\$\{scans\[0\]\.id\}::uuid/],
] as const) assert.match(personalBrandSources, pattern, `${label} must remain profile-scoped in the shared editorial source loader`);

for (const [label, pattern] of [
  ["recent topics", /content_items where profile_id=\$\{profileId\}/],
  ["semantic dedupe", /where ci\.profile_id=\$\{profileId\}/],
  ["assets", /assets where profile_id=\$\{profile\.id\}/],
  ["calendar jobs", /publication_jobs where profile_id=\$\{profile\.id\}/],
  ["learning", /learning_insights where profile_id=\$\{profileId\}/],
  ["costs", /ai_usage_events where profile_id=\$\{profileId\}/],
  ["OpenAI cache", /cacheKey:`post-automatici:\$\{profile\.id\}`/],
] as const) assert.match(autopilot, pattern, `${label} must remain profile-scoped`);

assert.match(generateText, /brand_profiles\?profile_id=eq\.\$\{encodeURIComponent\(profileId\)\}/, "manual copy must load only the active activity Brand Brain/user_context");
assert.match(generateText, /website_pages\?scan_id=eq\.\$\{encodeURIComponent\(scan\.id\)\}&profile_id=eq\.\$\{encodeURIComponent\(profileId\)\}/, "manual copy website context must require both scan and profile");

assert.match(social, /social_oauth_callbacks[\s\S]*profile_id[\s\S]*state\.profileId/, "OAuth callback ledger must persist the source profile");
assert.match(social, /where nonce=\$\{state\.nonce\} and profile_id=\$\{state\.profileId\}::uuid and provider=\$\{state\.provider\}/, "OAuth callback claims must be profile/provider bound");
assert.match(social, /from public\.social_connections[\s\S]*where profile_id = \$\{profileId\}::uuid and provider = \$\{provider\}/, "social destination lookup must be profile-scoped");
assert.match(social, /from public\.assets where id=\$\{assetId\}::uuid and profile_id=\$\{profileId\}::uuid/, "signed media must not resolve an asset from another activity");
assert.match(social, /where v\.id=\$\{variantId\}::uuid and v\.profile_id=\$\{profileId\}::uuid/, "publication jobs must load variants from the claimed profile only");

assert.match(publication, /variant\.id=job\.variant_id AND variant\.profile_id=job\.profile_id[\s\S]*variant\.provider=job\.provider/, "retry/cron publication integrity must bind variant, profile and provider");
assert.match(publication, /event\.profile_id=job\.profile_id/, "publication cost reservation must belong to the same profile");
assert.match(analytics, /job\.id=claimed\.job_id AND job\.profile_id=claimed\.profile_id/, "analytics claim must preserve profile identity");
assert.match(analytics, /variant\.id=job\.variant_id AND variant\.profile_id=job\.profile_id/, "analytics attribution must not cross profiles");
assert.match(learning, /record\.profile_id<>p_profile_id/, "learning persistence must reject foreign-profile records");
assert.match(activityBudget, /provider_cost_attempts[\s\S]*where profile_id=\$\{profileId\}::uuid/, "activity cost forecasting must be profile-scoped");

for (const table of [
  "profile_entitlements",
  "capability_usage_events",
  "capability_usage_buckets",
  "activity_ai_budget_policies",
  "profile_entitlement_package_assignments",
  "provider_cost_attempts",
  "social_oauth_callbacks",
  "analytics_sync_targets",
]) assert.match(tenantAudit, new RegExp(table), `permanent tenant audit must cover ${table}`);

console.log("Profile isolation PROPERTY ↔ NETWORK: PASS");
