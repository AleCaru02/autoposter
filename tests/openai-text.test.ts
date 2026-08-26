import assert from "node:assert/strict";
import { generateSocialText } from "../api/_lib/openai-text.js";

let capturedUrl = "";
let capturedInit: RequestInit | undefined;
const generated = {
  strategySummary: "Valorizzare il servizio con un messaggio concreto.",
  variants: [{ provider: "INSTAGRAM", format: "POST", eligible: true, hook: "Gestione più semplice", caption: "Un testo social verificato.", cta: "Scopri di più", hashtags: ["#propertymanagement"], visualBrief: "Immobile luminoso, stile reale", altText: "Interno di un appartamento luminoso", factualBasis: ["Il sito descrive il servizio di gestione immobili"] }],
};

const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  capturedUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
  capturedInit = init;
  return new Response(JSON.stringify({ id: "resp_test", model: "gpt-5.6-terra", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(generated) }] }], usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_test" } });
}) as typeof fetch;

const result = await generateSocialText({
  apiKey: "sk-test-only",
  topic: "Perché affidare un immobile a un property manager",
  objective: "lead",
  providers: ["INSTAGRAM"],
  formats: ["POST"],
  brand: { profileName: "QA Property", industry: "Property management", websiteUrl: "https://example.test", description: "Gestione di affitti brevi", businessModel: "Servizi ai proprietari", location: "Milano", serviceArea: "Milano", target: "Proprietari immobiliari", tone: "Professionale e diretto", goals: ["lead"], confirmedWebsiteContent: [{ url: "https://example.test/servizi", title: "Servizi", text: "Gestione completa degli affitti brevi per proprietari di immobili." }] },
  fetcher,
});

assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
assert.equal((capturedInit?.headers as Record<string, string>).authorization, "Bearer sk-test-only");
const body = JSON.parse(String(capturedInit?.body)) as Record<string, any>;
assert.equal(body.model, "gpt-5.6-terra");
assert.equal(body.store, false);
assert.equal(body.reasoning.effort, "low");
assert.equal(body.text.format.type, "json_schema");
assert.equal(body.text.format.strict, true);
assert.ok(String(body.instructions).includes("non inventare"));
assert.ok(String(body.input).includes("https://example.test/servizi"));
assert.equal(String(capturedInit?.body).includes("sk-test-only"), false, "la chiave non deve finire nel body/prompt");
assert.equal(result.content.variants[0].caption, "Un testo social verificato.");
assert.equal(result.model, "gpt-5.6-terra");
assert.equal(result.requestId, "req_test");
assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 80, totalTokens: 200 });

console.log("PASS OpenAI text contract: Responses API, gpt-5.6-terra, Structured Outputs, factual grounding.");
