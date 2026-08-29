import assert from "node:assert/strict";
import { generateOpenAIPlan, generateOpenAIStrategy } from "../api/_lib/openai-strategy-planner.js";
import { CONTENT_AGENTS } from "../api/_lib/content-agents.js";

const calls: Array<Record<string, unknown>> = [];
const responses = [
  {
    id: "resp_strategy",
    model: "gpt-5.6-terra",
    output_text: JSON.stringify({
      summary: "Strategia locale educativa e orientata ai lead",
      primaryObjective: "Generare richieste qualificate",
      audience: "Proprietari di immobili",
      positioning: "Competenza pratica e trasparente",
      contentPillars: ["Gestione", "Normativa", "Ottimizzazione"],
      contentMix: { educational: 30, promotional: 15, news: 15, tips: 25, storytelling: 15 },
      platformPriorities: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"],
      ctaPolicy: "CTA coerente con il funnel",
      localityPolicy: "Localizzare solo quando pertinente",
      seasonalityPolicy: "Usare stagionalità reale",
      doNotClaim: ["Risultati non verificati"],
    }),
    usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
  },
  {
    id: "resp_plan",
    model: "gpt-5.6-terra",
    output_text: JSON.stringify({
      horizonDays: 14,
      planningSummary: "Piano bilanciato su due settimane",
      items: [
        { dayOffset: 1, provider: "INSTAGRAM", contentType: "STORYTELLING", intent: "PROBLEM_SOLUTION", topicDirection: "Errore frequente dei proprietari", objective: "Generare richieste qualificate", funnelStage: "AWARENESS" },
        { dayOffset: 3, provider: "GBP", contentType: "SINGLE_POST", intent: "TIP", topicDirection: "Consiglio locale pratico", objective: "Aumentare fiducia locale", funnelStage: "CONSIDERATION" },
      ],
    }),
    usage: { input_tokens: 120, output_tokens: 220, total_tokens: 340 },
  },
];

const mockFetch: typeof fetch = async (_url, init) => {
  calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
  const body = responses.shift();
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-request-id": `req_${calls.length}` } });
};

const profile = { id: "11111111-1111-4111-8111-111111111111", name: "Attività Test", industry: "Property management", website_url: "https://example.com", timezone: "Europe/Rome" };
const strategy = await generateOpenAIStrategy({ apiKey: "test", profile, brand: { description: "Gestione affitti brevi", business_model: "Servizi", location: "Milano", service_area: "Milano e Monza", target_audience: { summary: "Proprietari" }, tone_of_voice: { summary: "Professionale" }, goals: ["Lead"], visual_identity: {} }, existingObjectives: ["Lead"], fetcher: mockFetch });
assert.equal(strategy.output.primaryObjective, "Generare richieste qualificate");
assert.equal(Object.values(strategy.output.contentMix).reduce((a, b) => a + b, 0), 100);

const plan = await generateOpenAIPlan({ apiKey: "test", profile, strategy: strategy.output, schedules: [{ provider: "INSTAGRAM", posts_per_week: 2, preferred_slots: [], timezone: "Europe/Rome", enabled: true }, { provider: "GBP", posts_per_week: 1, preferred_slots: [], timezone: "Europe/Rome", enabled: true }], recentTopics: ["Tema recente"], fetcher: mockFetch });
assert.equal(plan.output.horizonDays, 14);
assert.equal(plan.output.items[0]?.contentType, "STORYTELLING");
assert.equal(plan.output.items[1]?.provider, "GBP");
assert.equal(plan.output.items[1]?.contentType, "SINGLE_POST");

assert.equal(calls.length, 2);
for (const call of calls) {
  assert.equal(call.model, "gpt-5.6-terra");
  assert.equal(call.store, false);
  assert.equal("tools" in call, false, "Strategist/Planner must not silently use web search; Research Agent owns web research");
  const text = call.text as Record<string, unknown>;
  const format = text.format as Record<string, unknown>;
  assert.equal(format.type, "json_schema");
  assert.equal(format.strict, true);
}
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "STRATEGIST")?.mayUseOpenAI, true);
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "PLANNER")?.mayUseOpenAI, true);
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "FACT_CHECKER")?.mayUseOpenAI, true, "Fact-checker is now a real OpenAI-backed runtime stage");
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "FACT_CHECKER")?.mayUseWeb, true, "Fact-checker may use web only when existing evidence is insufficient");

console.log("OpenAI strategist/planner regression: PASS");
