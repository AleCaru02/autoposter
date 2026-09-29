import assert from "node:assert/strict";
import { decideMasterEditorial, type MasterEditorialContextSnapshot } from "../api/_lib/master-editorial-brain.js";

const context: MasterEditorialContextSnapshot = {
  profileType: "BUSINESS",
  personalBrand: false,
  brandSignalCount: 7,
  sitePageCount: 8,
  sourceCount: 8,
  industry: "Property management",
  goals: ["Generare richieste"],
  audience: ["Proprietari di immobili"],
  pillars: ["Affitti brevi"],
  connectedProviders: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"],
  recentContentCount: 12,
  calendarScheduledCount: 4,
  budget: { band: "ORDINARY", remainingEur: 24.5, higgsfieldRemainingEur: 10, otherAiRemainingEur: 14.5 },
  relevantEvents: [],
  analyticsSampleCount: 18,
  learningSignalCount: 2,
  reusableAssetCount: 3,
};

const ready = decideMasterEditorial({
  topic: "Come preparare un immobile per gli affitti brevi",
  objective: "Generare richieste",
  funnelStage: "CONSIDERATION",
  contentType: "SINGLE_POST",
  intent: "TIP",
  preferredProvider: "INSTAGRAM",
  format: "POST",
  localBusinessRelevance: true,
  professionalRelevance: true,
  hasVerifiableContext: true,
  context,
});
assert.equal(ready.status, "READY");
assert.equal(ready.selectedProvider, "INSTAGRAM");
assert.equal(ready.channels.filter((x) => x.action === "USE").length, 1);
assert.equal(ready.channels.find((x) => x.provider === "GBP")?.action, "SKIP");
assert.equal(ready.objective, "Generare richieste");
assert.equal(ready.audience, "Proprietari di immobili");
assert.equal(ready.pillar, "Affitti brevi");
assert.match(ready.visualStrategy, /3 asset riusabili/);
assert.match(ready.rationale, /learning affidabile/);
assert.ok(ready.contextSignals.some((signal) => signal.includes("sitePages=8")));
assert.deepEqual(ready.context.connectedProviders, ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);

const skipped = decideMasterEditorial({
  topic: "",
  funnelStage: "AWARENESS",
  contentType: "SINGLE_POST",
  intent: "TIP",
  preferredProvider: "FACEBOOK",
  format: "POST",
  localBusinessRelevance: false,
  professionalRelevance: false,
  hasVerifiableContext: false,
  context: { ...context, sitePageCount: 0, sourceCount: 0 },
});
assert.equal(skipped.status, "SKIP_PUBLICATION");
assert.equal(skipped.skipReason, "INSUFFICIENT_VERIFIABLE_CONTEXT");
assert.equal(skipped.channels.every((x) => x.action === "SKIP"), true);

const disconnected = decideMasterEditorial({
  topic: "Tema verificato",
  funnelStage: "AWARENESS",
  contentType: "SINGLE_POST",
  intent: "EDUCATION",
  preferredProvider: "LINKEDIN",
  format: "POST",
  localBusinessRelevance: false,
  professionalRelevance: true,
  hasVerifiableContext: true,
  context: { ...context, connectedProviders: ["INSTAGRAM", "FACEBOOK"] },
});
assert.equal(disconnected.status, "SKIP_PUBLICATION");
assert.equal(disconnected.skipReason, "PROVIDER_NOT_CONNECTED");

const budgetStop = decideMasterEditorial({
  topic: "Tema verificato",
  funnelStage: "AWARENESS",
  contentType: "SINGLE_POST",
  intent: "EDUCATION",
  preferredProvider: "INSTAGRAM",
  format: "POST",
  localBusinessRelevance: false,
  professionalRelevance: true,
  hasVerifiableContext: true,
  context: { ...context, budget: { ...context.budget, band: "HARD_STOP", remainingEur: 0 } },
});
assert.equal(budgetStop.status, "SKIP_PUBLICATION");
assert.equal(budgetStop.skipReason, "AI_BUDGET_HARD_STOP");

const seasonal = decideMasterEditorial({
  topic: "Evento stagionale verificato",
  funnelStage: "AWARENESS",
  contentType: "CAROUSEL",
  intent: "SEASONAL",
  preferredProvider: "INSTAGRAM",
  format: "CAROUSEL",
  localBusinessRelevance: true,
  professionalRelevance: false,
  hasVerifiableContext: true,
  context: { ...context, relevantEvents: ["Milano Design Week"] },
});
assert.equal(seasonal.urgency, "HIGH");
assert.match(seasonal.rationale, /evento\/trigger/);

console.log("Master Editorial Brain: PASS");
