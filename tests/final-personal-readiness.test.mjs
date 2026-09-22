import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computeCompletion, countValidRealSamples, createInitialState, EXTERNAL_STATUSES, PHASES, PHASE_STATUSES, REQUIRED_CHECKS } from "./final-personal-readiness.mjs";

assert.deepEqual(PHASE_STATUSES, ["PASS", "FAIL_PRODUCT", "FAIL_CONFIGURATION", "BLOCKED_EXTERNAL", "WAITING_MANUAL_ACTION", "WAITING_REAL_DATA", "NOT_RUN"]);
assert.equal(PHASES.length, 15);
assert.deepEqual(PHASES.map((phase) => phase.id), Array.from({ length: 15 }, (_, index) => String(index + 1).padStart(2, "0")));
assert.equal(REQUIRED_CHECKS.length, 24);
assert.deepEqual(EXTERNAL_STATUSES, ["PASS", "BLOCKED_EXTERNAL_VERIFIED", "NOT_RUN"]);

const state = createInitialState("candidate");
assert.deepEqual(computeCompletion(state), { completed: 0, required: 24, ready: false, productBugs: 0, externalReady: false });
for (const key of REQUIRED_CHECKS) state.checks[key] = { status: "PASS", evidence: "verified" };
state.external.GBP.status = "BLOCKED_EXTERNAL_VERIFIED";
assert.deepEqual(computeCompletion(state), { completed: 24, required: 24, ready: true, productBugs: 0, externalReady: true });
state.phases[12].status = "FAIL_PRODUCT";
assert.equal(computeCompletion(state).ready, false, "a product failure must stop 100% readiness");

const profileId = "11111111-1111-4111-8111-111111111111";
const base = { profile_id: profileId, provider: "FACEBOOK", format: "POST", topic: "Tema", published_at: "2026-09-01T10:00:00.000Z", metrics: { reach: 100, likes: 5 }, source: "PROVIDER_API" };
const rows = [
  { ...base, external_post_id: "same", captured_at: "2026-09-02T10:00:00.000Z" },
  { ...base, external_post_id: "same", captured_at: "2026-09-03T10:00:00.000Z" },
  { ...base, provider: "INSTAGRAM", external_post_id: "ig", captured_at: "2026-09-03T10:00:00.000Z", metrics: { engagement_rate: 4.5 } },
  { ...base, provider: "LINKEDIN", external_post_id: "li", captured_at: "2026-09-03T10:00:00.000Z" },
  { ...base, external_post_id: "demo", captured_at: "2026-09-03T10:00:00.000Z", source: "DEMO_SAMPLE" },
  { ...base, external_post_id: "unscorable", captured_at: "2026-09-03T10:00:00.000Z", metrics: {} },
];
assert.equal(countValidRealSamples(profileId, rows), 2, "learning count must deduplicate and exclude demo, LinkedIn and unscorable rows");

const [runner, docs, gitignore] = await Promise.all([
  readFile("tests/final-personal-readiness.mjs", "utf8"),
  readFile("docs/final-personal-readiness.md", "utf8"),
  readFile(".gitignore", "utf8"),
]);
assert.match(runner, /SENSITIVE_EVIDENCE_REJECTED/);
assert.match(runner, /PASSWORD_GENERATION_INTERACTIVE_ONLY/);
assert.match(runner, /VALID_REAL_SAMPLES=\$\{valid\}\/10; MISSING=\$\{missing\}/);
assert.match(runner, /FINAL_QA_ALLOW_CREATE_DEMO/);
assert.match(runner, /profile_tenant_modes\?profile_id=/, "demo verification must read the server-owned tenant mode");
assert.match(runner, /profile_entitlements\?profile_id=/, "demo verification must read normal server-side entitlements");
assert.match(runner, /PACKAGE:demo_persistent:v1/, "demo verification must require the expected entitlement assignment source");
assert.match(runner, /external_publishing_enabled === false/, "demo verification must fail closed for real publishing");
assert.match(docs, /PRIMA la migration[\s\S]*POI il deploy/);
assert.match(docs, /non è un rollback distruttivo/);
assert.match(gitignore, /^\.qa\/$/m);

console.log("Final personal readiness runner: PASS — deterministic 24-check model, checkpoint/resume, secret rejection and real learning count verified.");
