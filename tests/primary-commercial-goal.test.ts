import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { commercialGoalOptions, primaryCommercialGoal } from "../api/_lib/primary-commercial-goal.js";
import { generateOpenAIStrategy } from "../api/_lib/openai-strategy-planner.js";

assert.equal(primaryCommercialGoal(null), null);
assert.equal(primaryCommercialGoal({}), null);
assert.equal(primaryCommercialGoal({ primaryCommercialGoal: 24 }), null);
assert.equal(primaryCommercialGoal({ primaryCommercialGoal: " " }), null);
assert.equal(primaryCommercialGoal({ primaryCommercialGoal: "x".repeat(161) }), null);
assert.equal(primaryCommercialGoal({ primaryCommercialGoal: "  Richieste   di preventivo " }), "Richieste di preventivo");
assert.ok(commercialGoalOptions([], []).includes("Vendite"));
assert.ok(commercialGoalOptions([], []).includes("Crescita del personal brand"));
assert.deepEqual(commercialGoalOptions(["Prenotazioni"], ["Prenotazioni"]), [
  "Richieste di preventivo", "Vendite", "Prenotazioni", "Visibilità", "Crescita del personal brand",
]);

const brandPage = readFileSync(new URL("../src/pages/brand-page.tsx", import.meta.url), "utf8");
assert.match(brandPage, /Obiettivo commerciale prioritario/);
assert.match(brandPage, /primaryCommercialGoal: draft.primaryCommercialGoal.trim\(\) \|\| null/);
assert.match(brandPage, /primaryCommercialGoal: primaryCommercialGoal\(visual\) \?\? ""/);
assert.match(brandPage, /selectedProfile\?\.id/, "brand saves must remain scoped to one profile");
assert.match(brandPage, /primaryCommercialGoal: removing && current.primaryCommercialGoal === goal \? "" : current.primaryCommercialGoal/);

const autopilot = readFileSync(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
assert.match(autopilot, /const ownerCommercialGoal=primaryCommercialGoal\(loaded.visualIdentity\)/);
assert.match(autopilot, /:ownerCommercialGoal\|\|planItem\?\.objective/, "priority must override stale planned objectives");
assert.match(autopilot, /goal:ownerCommercialGoal\?\?context.goals\[0\]/);
for (const path of ["api/onboarding-analyze.ts", "cloudflare/onboarding-analyze.ts"]) {
  const source = readFileSync(new URL("../" + path, import.meta.url), "utf8");
  assert.match(source, /primaryCommercialGoal: primaryCommercialGoal\(existingVisualIdentity\)/,
    path + ": repeated scans must keep owner priority");
}

const modelStrategy = {
  summary: "Strategia educativa",
  primaryObjective: "Obiettivo inventato dal modello",
  audience: "Pubblico italiano",
  positioning: "Competenza",
  contentPillars: ["FAQ", "Servizi", "Casi pratici"],
  contentMix: { educational: 30, promotional: 20, news: 10, tips: 30, storytelling: 10 },
  platformPriorities: ["INSTAGRAM"],
  ctaPolicy: "Richiesta di contatto",
  localityPolicy: "Solo se pertinente",
  seasonalityPolicy: "Stagionalità reale",
  doNotClaim: ["Conversioni non documentate"],
};
const profileA = { id: "11111111-1111-4111-8111-111111111111", name: "Casa Test", industry: "Ospitalità", website_url: "https://a.example", timezone: "Europe/Rome" };
const profileB = { id: "22222222-2222-4222-8222-222222222222", name: "Personal Test", industry: "Personal brand", website_url: "https://b.example", timezone: "Europe/Rome" };
function mockStrategist(expectedGoal: string) {
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls += 1;
    const payload = JSON.parse(String(init?.body)) as Record<string, any>;
    assert.equal(payload.store, false);
    assert.equal("tools" in payload, false, "no provider search or paid external lookup in this controlled test");
    assert.equal(JSON.parse(payload.input).brand.primaryCommercialGoal, expectedGoal);
    assert.match(String(payload.instructions), /priorità esplicitamente impostata/);
    return new Response(JSON.stringify({
      id: "mock-strategy", model: "gpt-5.6-terra",
      output_text: JSON.stringify(modelStrategy),
      usage: { input_tokens: 15, output_tokens: 15, total_tokens: 30 },
    }), { status: 200 });
  };
  return { fetcher, count: () => calls };
}
const business = mockStrategist("Prenotazioni");
const resultA = await generateOpenAIStrategy({
  apiKey: "mock-only", profile: profileA,
  brand: {
    description: "Alloggi", business_model: "Affitti brevi", location: "Milano", service_area: "Milano",
    target_audience: { summary: "Turisti" }, tone_of_voice: { summary: "Professionale" },
    goals: ["Prenotazioni"], visual_identity: { primaryCommercialGoal: "Prenotazioni" }, user_context: null,
  }, existingObjectives: ["Traffico"], fetcher: business.fetcher,
});
assert.equal(resultA.output.primaryObjective, "Prenotazioni", "a model suggestion cannot override the chosen business objective");
assert.equal(business.count(), 1);
const personal = mockStrategist("Crescita del personal brand");
const resultB = await generateOpenAIStrategy({
  apiKey: "mock-only", profile: profileB,
  brand: {
    description: "Consulente", business_model: "Servizi", location: "Italia", service_area: "Online",
    target_audience: { summary: "Professionisti" }, tone_of_voice: { summary: "Diretto" },
    goals: ["Visibilità"], visual_identity: { primaryCommercialGoal: "Crescita del personal brand" }, user_context: null,
  }, existingObjectives: ["Vendite"], fetcher: personal.fetcher,
});
assert.equal(resultB.output.primaryObjective, "Crescita del personal brand");
assert.equal(personal.count(), 1);
assert.notEqual(resultA.output.primaryObjective, resultB.output.primaryObjective, "one profile must never inherit another's priority");

console.log("Commercial goal: profile isolation, explicit priority, website rescans, strategist and autopilot: PASS");
