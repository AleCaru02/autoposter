import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  autopilotQualityBrief,
  chooseNarrativeIntent,
  failureBreakerOpen,
  type AutopilotAttemptRecord,
} from "../api/_lib/autopilot-spend-guards.js";
import { editorialQualityIssues, qualityBriefFor, stripAvoidLists, validateResult, type GeneratedSocialContent } from "../api/_lib/openai-text.js";
import { findEditorialRepetition } from "../api/_lib/content-dedupe.js";
import { shouldDeferRejectedAutopilotSlot } from "../api/_lib/autopilot.js";

// 1. Narrative pre-check — real prod window of 16/11/2026: all 4 planned intents already at 3/12.
const prodWindow = [
  "SINGLE_POST:CHECKLIST", "SINGLE_POST:EDUCATION", "SINGLE_POST:CASE_STUDY", "SINGLE_POST:CHECKLIST",
  "SINGLE_POST:COMMON_MISTAKE", "SINGLE_POST:EDUCATION", "SINGLE_POST:COMMON_MISTAKE", "SINGLE_POST:CASE_STUDY",
  "SINGLE_POST:EDUCATION", "SINGLE_POST:CHECKLIST", "SINGLE_POST:COMMON_MISTAKE", "SINGLE_POST:CASE_STUDY",
];
for (const planned of ["CHECKLIST", "EDUCATION", "CASE_STUDY", "COMMON_MISTAKE"] as const) {
  const chosen = chooseNarrativeIntent("SINGLE_POST", planned, prodWindow);
  assert.ok(chosen && chosen !== planned, `overused ${planned} must be replaced before paying`);
  // The chosen structure must pass the same post-generation rule that rejected 5 paid runs.
  const repetition = findEditorialRepetition({ topic: "x", narrativeStructure: `SINGLE_POST:${chosen}` }, prodWindow.map((n) => ({ topic: "y", narrativeStructure: n })));
  assert.ok(!repetition.reasons.includes("NARRATIVE_STRUCTURE_OVERUSED"), `${chosen} must not be rejected after generation`);
}
assert.equal(chooseNarrativeIntent("SINGLE_POST", "TIP", prodWindow), "TIP", "a free intent is kept");
assert.equal(chooseNarrativeIntent("CAROUSEL", "CHECKLIST", prodWindow), "CHECKLIST", "other content types are counted separately");
const saturated = ["TIP", "FAQ", "PROBLEM_SOLUTION", "SERVICE"].flatMap((i) => Array(3).fill(`SINGLE_POST:${i}`));
assert.equal(chooseNarrativeIntent("SINGLE_POST", "TIP", [...saturated, ...prodWindow]), "EDUCATION", "only the 12-item window counts");
assert.equal(chooseNarrativeIntent("SINGLE_POST", "TIP", Array(12).fill("SINGLE_POST:TIP").map((v, i) => i < 3 ? v : ["SINGLE_POST:FAQ","SINGLE_POST:PROBLEM_SOLUTION","SINGLE_POST:SERVICE"][i % 3])), "EDUCATION");

// 2. Quality brief — the "avoid recent topics" list must not impose rules.
const avoid = "Segui il brief del Planner Agent: Come preparare casa per il primo ospite. Intento editoriale: TIP. Evita formulazioni e angoli già usati in questi temi recenti: Airbnb e Booking.com: 5 differenze principali | Confrontare affitto breve, medio termine e 4+4.";
assert.ok(!/differenz|confront/i.test(stripAvoidLists(avoid)), "avoid-list removed");
assert.ok(stripAvoidLists(avoid).includes("primo ospite"), "real brief kept");
assert.equal(qualityBriefFor({ topic: avoid, qualityBrief: "Brief reale" }), "Brief reale");
assert.equal(qualityBriefFor({ topic: "Le 3 differenze tra A e B" }), "Le 3 differenze tra A e B", "manual brief untouched");
assert.equal(autopilotQualityBrief({ websitePilotBrief: null, planTopicDirection: " Checklist ospite ", pillarInstruction: "p" }), "Checklist ospite");
assert.equal(autopilotQualityBrief({ websitePilotBrief: null, planTopicDirection: null, pillarInstruction: null }), null);

const variant = (provider: string, hook: string, caption: string) => ({
  provider, format: "POST", eligible: true, hook, caption, cta: "Parliamone", hashtags: [], visualBrief: "v", factualBasis: [], carouselSlides: [],
});
const content = {
  editorialTopic: "Preparare casa per il primo ospite",
  editorialAngle: "Tre controlli pratici prima del check-in.",
  strategySummary: "s",
  variants: [variant("INSTAGRAM", "Prima del primo ospite", "Controlla biancheria, wifi e istruzioni di accesso prima dell'arrivo.")],
} as unknown as GeneratedSocialContent;
const before = editorialQualityIssues(content, avoid, null);
assert.ok(before.includes("DIFFERENCE_REQUEST_DILUTED") || before.some((i) => i.startsWith("REQUESTED_COUNT_STRUCTURE_INVALID")), "reproduces the old false positive");
const after = editorialQualityIssues(content, qualityBriefFor({ topic: avoid }), null);
assert.ok(!after.includes("DIFFERENCE_REQUEST_DILUTED") && !after.some((i) => i.startsWith("REQUESTED_COUNT_STRUCTURE_INVALID")), `no false positive after fix: ${after.join(",")}`);
// A real comparison request is still enforced.
assert.ok(editorialQualityIssues(content, "Le differenze tra affitto breve e 4+4", null).includes("DIFFERENCE_REQUEST_DILUTED"));

// 3. Stray carousel slides on a POST are dropped, not a paid-run rejection.
const raw = {
  editorialTopic: "t", editorialAngle: "a.", strategySummary: "s",
  variants: [{ ...variant("INSTAGRAM", "h", "c"), carouselSlides: [{ position: 1, purpose: "p", headline: "h", hierarchy: "x", visualBrief: "v", altText: "a" }] }],
};
const validated = validateResult(raw, ["INSTAGRAM"], ["POST"]);
assert.deepEqual(validated.variants[0].carouselSlides, []);
assert.throws(() => validateResult({ ...raw, variants: [{ ...raw.variants[0], format: "CAROUSEL", carouselSlides: [] }] }, ["INSTAGRAM"], ["CAROUSEL"]), /OPENAI_INVALID_CAROUSEL_SLIDES/, "real carousels still validated");

// 4. Slot cooldown now covers every content rejection seen in prod.
const now = new Date("2026-11-16T17:00:00Z");
for (const reason of ["AUTOPILOT_REPETITION_BLOCKED:NARRATIVE_STRUCTURE_OVERUSED", "OPENAI_UNEXPECTED_CAROUSEL_SLIDES", "OPENAI_EDITORIAL_QUALITY_BLOCKED", "AUTOPILOT_EDITORIAL_QA_BLOCKED:x"]) {
  assert.equal(shouldDeferRejectedAutopilotSlot({ state: "RELEASED", reason, created_at: "2026-11-16T08:00:00Z" }, now), true, reason);
}
assert.equal(shouldDeferRejectedAutopilotSlot({ state: "RELEASED", reason: "AI_BUDGET_HARD_STOP", created_at: "2026-11-16T08:00:00Z" }, now), false, "budget stops are not content rejections");

// 5. Profile circuit breaker.
const rejected = (h: number, reason = "OPENAI_EDITORIAL_QUALITY_BLOCKED"): AutopilotAttemptRecord => ({ state: "RELEASED", reason, created_at: new Date(now.getTime() - h * 3600_000).toISOString() });
assert.equal(failureBreakerOpen([rejected(1), rejected(3, "AUTOPILOT_REPETITION_BLOCKED:NARRATIVE_STRUCTURE_OVERUSED"), rejected(9)], now), true, "3 content rejections in 24h open it");
assert.equal(failureBreakerOpen([rejected(1), rejected(3)], now), false, "fewer than 3 attempts");
assert.equal(failureBreakerOpen([rejected(1), { state: "COMMITTED", reason: null, created_at: rejected(2).created_at }, rejected(3)], now), false, "a success closes it");
assert.equal(failureBreakerOpen([rejected(1), rejected(3), rejected(25)], now), false, "oldest failure aged out: one new attempt allowed");
assert.equal(failureBreakerOpen([rejected(1), rejected(2), rejected(3, "AUTOPILOT_ACTIVITY_BUDGET_STOP")], now), false, "infrastructure/budget reasons do not count");

// 6. Wiring: guards run before the paid call.
const autopilot = readFileSync(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
assert.ok(autopilot.indexOf("chooseNarrativeIntent(") < autopilot.indexOf("generateSocialText({"), "narrative pre-check precedes generation");
assert.ok(autopilot.includes("const qualityBrief=autopilotQualityBrief(") && /generateSocialText\(\{[^}]*qualityBrief,/.test(autopilot), "autopilot passes the real brief");
const serialized = readFileSync(new URL("../api/_lib/autopilot-serialized.ts", import.meta.url), "utf8");
assert.ok(serialized.indexOf("failureBreakerOpen(") < serialized.indexOf("runContentAutopilot(env"), "breaker precedes the run");
const manual = readFileSync(new URL("../api/generate-text.ts", import.meta.url), "utf8");
assert.ok(manual.includes("qualityBrief: topic"), "manual generation checks the user's own brief");

console.log("autopilot-spend-guards: PASS");
