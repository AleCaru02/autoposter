import assert from "node:assert/strict";
import { countWebSearchCalls, estimateTerraCostUsd, estimateTextModelCostUsd, estimateTextRequestUpperBoundUsd, extractWebSearchSources, generateSocialText, selectRelevantWebsiteContent } from "../api/_lib/openai-text.js";

let capturedUrl = "";
let capturedInit: RequestInit | undefined;
const generated = {
  editorialTopic: "Gestione professionale degli affitti brevi",
  editorialAngle: "Perché delegare la gestione riduce il carico operativo del proprietario",
  strategySummary: "Valorizzare il servizio con un messaggio concreto.",
  variants: [{ provider: "INSTAGRAM", format: "POST", eligible: true, hook: "Gestione più semplice", caption: "Un testo social verificato.", cta: "Scopri di più", hashtags: ["#propertymanagement"], visualBrief: "Immobile luminoso, stile reale", altText: "Interno di un appartamento luminoso", factualBasis: ["BASE BRAND/SITO: il sito descrive il servizio di gestione immobili"] }],
};

const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  capturedUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
  capturedInit = init;
  return new Response(JSON.stringify({
    id: "resp_test",
    model: "gpt-6-luna",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(generated) }] }],
    usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 }, output_tokens: 80, total_tokens: 200 },
  }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_test" } });
}) as typeof fetch;

const brand = {
  profileName: "QA Property",
  industry: "Property management",
  websiteUrl: "https://example.test",
  description: "Gestione di affitti brevi",
  businessModel: "Servizi ai proprietari",
  location: "Milano",
  serviceArea: "Milano",
  target: "Proprietari immobiliari",
  tone: "Professionale e diretto",
  goals: ["lead"],
  userContext: "Gestiamo pochi appartamenti selezionati e non promettiamo rendimenti garantiti.",
  confirmedWebsiteContent: [
    { url: "https://example.test/storia", title: "La nostra storia", text: "Una lunga storia aziendale senza dettagli sulla gestione." },
    { url: "https://example.test/servizi/property-management", title: "Property management e affitti brevi", text: "Gestione completa degli affitti brevi per proprietari di immobili." },
  ],
};

const ranked = selectRelevantWebsiteContent("property manager affitti brevi", brand.confirmedWebsiteContent);
assert.equal(ranked[0].url, "https://example.test/servizi/property-management", "la selezione locale deve privilegiare la pagina semanticamente pertinente prima di inviare contesto a OpenAI");

const result = await generateSocialText({
  apiKey: "sk-test-only",
  topic: "Perché affidare un immobile a un property manager",
  objective: "lead",
  providers: ["INSTAGRAM"],
  formats: ["POST"],
  brand,
  fetcher,
  cacheKey: "post-automatici:qa-profile",
  researchMode: "BALANCED",
});

assert.equal(capturedUrl, "https://api.openai.com/v1/responses");
assert.equal((capturedInit?.headers as Record<string, string>).authorization, "Bearer sk-test-only");
const body = JSON.parse(String(capturedInit?.body)) as Record<string, any>;
assert.equal(body.model, "gpt-6-luna", "copy standard ad alto volume deve usare GPT-6 Luna");
assert.equal(body.store, false);
assert.equal(body.reasoning.effort, "medium", "manteniamo reasoning medio per la qualità editoriale finale");
assert.equal(body.prompt_cache_key, "post-automatici:qa-profile");
assert.equal(body.max_output_tokens, 5000);
assert.equal("tools" in body, false, "il copy OpenAI non deve duplicare la ricerca: i fatti correnti appartengono al Gemini Grounding agent");
assert.equal(body.text.format.type, "json_schema");
assert.equal(body.text.format.strict, true);
assert.equal("include" in body, false);
assert.ok(body.text.format.schema.required.includes("editorialTopic"));
assert.ok(body.text.format.schema.required.includes("editorialAngle"));
assert.ok(String(body.instructions).includes("non inventare"));
assert.ok(String(body.instructions).includes("Perimetro editoriale"));
assert.ok(String(body.instructions).includes("non è l'unico universo di argomenti"));
assert.ok(String(body.input).includes("https://example.test/servizi/property-management"));
assert.ok(String(body.input).includes("Gestiamo pochi appartamenti selezionati"), "manual brand context must reach OpenAI generation");
assert.ok(String(body.instructions).includes("userProvidedContext"), "the model must be told how to treat manual brand context safely");
assert.equal(String(capturedInit?.body).includes("sk-test-only"), false, "la chiave non deve finire nel body/prompt");
assert.equal(result.researchMode, "BALANCED");
assert.deepEqual(result.externalSources, []);
assert.equal(result.content.editorialTopic, "Gestione professionale degli affitti brevi");
assert.equal(result.content.editorialAngle, "Perché delegare la gestione riduce il carico operativo del proprietario");
assert.equal(result.content.variants[0].caption, "Un testo social verificato.");
assert.equal(result.model, "gpt-6-luna");
assert.equal(result.requestId, "req_test");
assert.equal(result.usage.inputTokens, 120);
assert.equal(result.usage.cachedInputTokens, 20);
assert.equal(result.usage.cacheWriteTokens, 10);
assert.equal(result.usage.outputTokens, 80);
assert.equal(result.usage.totalTokens, 200);
assert.equal(result.usage.webSearchCalls, 0);
assert.equal(result.usage.estimatedCostUsd, estimateTextModelCostUsd("gpt-6-luna", 120, 80, 20, 10));
assert.equal(estimateTerraCostUsd(120, 80, 20, 10), 0.001169);
assert.equal(countWebSearchCalls({ output: [{ type: "web_search_call" }, { type: "message" }] }), 1);
assert.deepEqual(extractWebSearchSources({ output: [{ type: "web_search_call", action: { sources: [{ url: "https://example.org/a" }, { url: "ftp://bad.example/file" }] } }] }), ["https://example.org/a"]);

let websiteOnlyBody: Record<string, any> | null = null;
const websiteOnlyFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  websiteOnlyBody = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ id: "resp_site", model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(generated) }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200 });
}) as typeof fetch;
const websiteOnlyResult = await generateSocialText({ apiKey: "sk-test-only", topic: "Servizi reali", providers: ["INSTAGRAM"], formats: ["POST"], brand, fetcher: websiteOnlyFetcher, researchMode: "WEBSITE_ONLY" });
assert.equal(websiteOnlyBody && "tools" in websiteOnlyBody, false, "la modalità solo sito non deve attivare web search");
assert.equal(websiteOnlyResult.usage.webSearchCalls, 0);
assert.equal(websiteOnlyResult.usage.estimatedCostUsd, estimateTextModelCostUsd("gpt-6-luna", 10, 10));

let brandFactCall = 0;
let factCheckPayload: Record<string, any> | null = null;
const numberedBrandContent = {
  ...generated,
  variants: [{ ...generated.variants[0], caption: "QA Property 7 offre gestione professionale." }],
};
const brandFactFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  brandFactCall += 1;
  const request = JSON.parse(String(init?.body)) as Record<string, any>;
  if (brandFactCall === 1) {
    return new Response(JSON.stringify({ id: "resp_brand_fact", model: "gpt-6-luna", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(numberedBrandContent) }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200 });
  }
  factCheckPayload = request;
  assert.equal(request.model, "gemini-3.8-flash");
  const checked = { verdict: "PASS", checkedClaims: [{ claim: "QA Property 7 offre gestione professionale", status: "VERIFIED", reason: "Il nome e il servizio sono presenti nei dati brand." }] };
  return new Response(JSON.stringify({ id: "int_brand_fact_check", model: "gemini-3.8-flash", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(checked) }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200 });
}) as typeof fetch;
const brandFactResult = await generateSocialText({ apiKey: "sk-test-only", geminiApiKey: "gem-test-only", topic: "Presentazione attività", providers: ["INSTAGRAM"], formats: ["POST"], brand: { ...brand, profileName: "QA Property 7" }, fetcher: brandFactFetcher, researchMode: "WEBSITE_ONLY" });
assert.equal(brandFactCall, 2, "a material numbered brand claim must still run fact-checking");
assert.ok(String(factCheckPayload?.input).includes("QA Property 7"), "fact-check must receive the same authoritative brand facts used for generation");
assert.ok(String(factCheckPayload?.input).includes(brand.userContext), "fact-check must receive user-confirmed facts too");
assert.equal(brandFactResult.verification.factCheckVerdict, "PASS");

const upperBound = estimateTextRequestUpperBoundUsd({ topic: "property manager", objective: "lead", providers: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"], formats: ["POST"], brand, researchMode: "BALANCED" });
const websiteOnlyUpperBound = estimateTextRequestUpperBoundUsd({ topic: "property manager", objective: "lead", providers: ["INSTAGRAM"], formats: ["POST"], brand, researchMode: "WEBSITE_ONLY" });
assert.ok(upperBound >= websiteOnlyUpperBound, "la modalità bilanciata standard non deve pagare automaticamente una ricerca esterna");
const newsUpperBound = estimateTextRequestUpperBoundUsd({ topic: "novità property manager", objective: "lead", providers: ["INSTAGRAM"], formats: ["POST"], brand, researchMode: "NEWS" });
assert.ok(newsUpperBound > websiteOnlyUpperBound, "NEWS deve riservare il costo di Gemini Grounding + fact-check");
assert.ok(upperBound < 0.1, `una richiesta testo normale deve restare sotto $0.10 nel worst-case interno, ricevuto ${upperBound}`);

console.log("PASS text routing: GPT-6 Luna copy + Gemini Grounding fact-check, senza duplicare web search nel copy.");
