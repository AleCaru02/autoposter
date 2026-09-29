import assert from "node:assert/strict";
import fs from "node:fs";
import { CAPABILITY_REGISTRY } from "../api/_lib/capabilities.js";
import {
  IDENTITY_QA_DIMENSIONS,
  identityQaVerdict,
  routeVisualProvider,
  inferVisualIdentityRequirements,
  safeVisualBriefForDecision,
} from "../api/_lib/visual-provider-routing.js";

for (const key of [
  "visual.higgsfield.api",
  "visual.higgsfield.soul_id",
  "visual.personal_brand.identity_consistency",
  "visual.provider.autonomous_routing",
  "visual.identity.qa",
] as const) {
  assert.equal(CAPABILITY_REGISTRY[key].status, "LIVE_NOT_RUNTIME_VERIFIED", `${key} must not be marked verified before live evidence`);
}

const reuse = routeVisualProvider({
  profileType: "PERSONAL_BRAND",
  suitableRealAssetAvailable: true,
  personIsPrimarySubject: true,
  requiresIdentityConsistency: true,
  requiresNewScene: false,
  virtualShoot: false,
  higgsfieldConfigured: true,
  soulIdentityState: "COMPLETED",
  higgsfieldBudgetRemainingEur: 10,
  estimatedHiggsfieldCostEur: 0.01,
});
assert.equal(reuse.provider, "REAL_ASSET");
assert.equal(reuse.reasonCode, "REUSE_SUITABLE_REAL_ASSET");

const soul = routeVisualProvider({
  profileType: "PERSONAL_BRAND",
  suitableRealAssetAvailable: false,
  personIsPrimarySubject: true,
  requiresIdentityConsistency: true,
  requiresNewScene: true,
  virtualShoot: true,
  higgsfieldConfigured: true,
  soulIdentityState: "COMPLETED",
  higgsfieldBudgetRemainingEur: 10,
  estimatedHiggsfieldCostEur: 0.01,
});
assert.equal(soul.provider, "HIGGSFIELD");
assert.equal(soul.requiresIdentityQa, true);
assert.equal(soul.fallbackApplied, false);

const noSoul = routeVisualProvider({
  profileType: "PERSONAL_BRAND",
  suitableRealAssetAvailable: false,
  personIsPrimarySubject: true,
  requiresIdentityConsistency: true,
  requiresNewScene: true,
  virtualShoot: false,
  higgsfieldConfigured: true,
  soulIdentityState: "REFERENCES_PENDING",
  higgsfieldBudgetRemainingEur: 10,
  estimatedHiggsfieldCostEur: 0.01,
});
assert.equal(noSoul.provider, "OPENAI");
assert.equal(noSoul.reasonCode, "SOUL_ID_NOT_READY");
assert.equal(noSoul.mustAvoidSyntheticPerson, true, "fallback must not invent a replacement face");

const noBudget = routeVisualProvider({
  profileType: "PERSONAL_BRAND",
  suitableRealAssetAvailable: false,
  personIsPrimarySubject: true,
  requiresIdentityConsistency: true,
  requiresNewScene: true,
  virtualShoot: false,
  higgsfieldConfigured: true,
  soulIdentityState: "COMPLETED",
  higgsfieldBudgetRemainingEur: 0,
  estimatedHiggsfieldCostEur: 0.01,
});
assert.equal(noBudget.provider, "OPENAI");
assert.equal(noBudget.reasonCode, "HIGGSFIELD_BUDGET_EXHAUSTED");
assert.equal(noBudget.mustAvoidSyntheticPerson, true);

const standard = routeVisualProvider({
  profileType: "BUSINESS",
  suitableRealAssetAvailable: false,
  personIsPrimarySubject: false,
  requiresIdentityConsistency: false,
  requiresNewScene: false,
  virtualShoot: false,
  higgsfieldConfigured: true,
  soulIdentityState: "COMPLETED",
  higgsfieldBudgetRemainingEur: 10,
  estimatedHiggsfieldCostEur: 0.01,
});
assert.equal(standard.provider, "OPENAI");
assert.equal(standard.requiresIdentityQa, false);

const inferred = inferVisualIdentityRequirements({
  profileType: "PERSONAL_BRAND",
  profileName: "Bianca Lopes",
  visualBrief: "Ritratto lifestyle della persona in una nuova scena editoriale",
});
assert.equal(inferred.personIsPrimarySubject, true);
assert.equal(inferred.requiresIdentityConsistency, true);
assert.equal(inferred.requiresNewScene, true);
const safeFallback = safeVisualBriefForDecision(noSoul, "Ritratto lifestyle");
assert.match(safeFallback, /NON raffigurare persone/);

const perfectScores = Object.fromEntries(IDENTITY_QA_DIMENSIONS.map((key) => [key, 0.95])) as Parameters<typeof identityQaVerdict>[0];
assert.equal(identityQaVerdict(perfectScores).verdict, "PASS");
const badHands = { ...perfectScores, hands: 0.2, fingers: 0.2 };
const blocked = identityQaVerdict(badHands);
assert.equal(blocked.verdict, "BLOCK");
assert.ok(blocked.failedDimensions.includes("hands"));
assert.ok(blocked.failedDimensions.includes("fingers"));

const migration = fs.readFileSync("db/migrations/20260929_z_higgsfield_personal_brand_image_engine.sql", "utf8");
assert.match(migration, /higgsfield_cap_eur numeric/);
assert.match(migration, /other_ai_cap_eur numeric/);
assert.match(migration, /higgsfield_cap_eur \+ other_ai_cap_eur <= hard_cap_eur/);
assert.match(migration, /DEFAULT 10/);
assert.match(migration, /DEFAULT 20/);
assert.match(migration, /cost_bucket IN \('HIGGSFIELD','OTHER_AI','NON_AI'\)/);
assert.match(migration, /activity-ai-budget-bucket:/, "bucket budget must use a transaction-scoped lock");
assert.match(migration, /account-ai-budget:/, "global concurrent attempts must retain an account lock");
assert.match(migration, /personal_brand_reference_images/);
assert.match(migration, /UNIQUE\(profile_id, sha256\)/, "reference dedupe must be profile scoped");
assert.match(migration, /personal_brand_visual_identities/);
assert.match(migration, /profile_id uuid PRIMARY KEY/, "one durable visual identity state per profile");
assert.match(migration, /visual\.higgsfield\.soul_id/);
assert.match(migration, /provider_attempt_reserve_usd/);
assert.match(migration, /set_activity_ai_budget_split/);
assert.match(migration, /sum\(ap\.hard_cap_eur\)/, "account ceiling must cover independent activity caps");
assert.match(migration, /user_provisioning_package_defaults/, "first-class Personal Brand provisioning must preserve the user's package default");
assert.match(migration, /profile_type/, "first-class Personal Brand type must remain durable");
assert.doesNotMatch(migration, /SAFE_MODE\s*=\s*false/i);

const activityBudget = fs.readFileSync("api/_lib/activity-budget.ts", "utf8");
assert.match(activityBudget, /higgsfieldRemainingEur/);
assert.match(activityBudget, /otherAiRemainingEur/);
assert.match(activityBudget, /AI_BUDGET_BUCKET_EXHAUSTED/);
assert.match(activityBudget, /costBucket\?: "HIGGSFIELD" \| "OTHER_AI"/);


const routingMigration = fs.readFileSync("db/migrations/20260929_zz_visual_provider_routing.sql", "utf8");
for (const column of ["visual_provider","visual_model","visual_decision_reason","visual_estimated_cost_eur","visual_actual_cost_eur","identity_qa_status"]) {
  assert.match(routingMigration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`), `${column} must be persisted`);
}
assert.match(routingMigration, /REAL_ASSET','OPENAI','HIGGSFIELD/);

const worker = fs.readFileSync("cloudflare/worker.ts", "utf8");
assert.match(worker, /resolveVisualProviderRuntime/);
assert.match(worker, /costBucket: "OTHER_AI"/, "OpenAI images must be constrained by the €20 Other AI bucket");
assert.match(worker, /HIGGSFIELD_RUNTIME_NOT_VERIFIED/);
assert.match(worker, /providerCallExecuted: false/, "uncertified Higgsfield path must not make a provider call");
assert.match(worker, /identity_fallback/);

const autopilot = fs.readFileSync("api/_lib/autopilot.ts", "utf8");
assert.match(autopilot, /resolveVisualProviderRuntime/);
assert.match(autopilot, /costBucket:"OTHER_AI"/);
assert.match(autopilot, /visual_provider='REAL_ASSET'/);
assert.match(autopilot, /autopilot-image-higgsfield-pending/);

const assets = fs.readFileSync("api/_lib/asset-intelligence.ts", "utf8");
assert.match(assets, /identityCritical/);
assert.match(assets, /metadata\.identity_fallback === true/, "identity fallback assets must not mask future identity-consistent routing");

const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
assert.match(wrangler, /"SAFE_MODE": "true"/);
assert.doesNotMatch(wrangler, /HIGGSFIELD_(?:CREDENTIALS|API_KEY|SECRET)/, "Higgsfield credentials must never be a public Worker var");

console.log("Higgsfield Personal Brand foundation: PASS");
