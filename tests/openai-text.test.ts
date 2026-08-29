import assert from "node:assert/strict";
import { countWebSearchCalls, estimateTerraCostUsd, estimateTextRequestUpperBoundUsd, extractWebSearchSources, generateSocialText, selectRelevantWebsiteContent } from "../api/_lib/openai-text.js";

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
    model: "gpt-5.6-terra",
    output: [
      { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://example.org/industry-report" }, { type: "url", url: "javascript:alert(1)" }] } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(generated) }] },
    ],
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
assert.equal(body.model, "gpt-5.6-terra", "il modello finale non deve essere degradato a Luna");
assert.equal(body.store, false);
assert.equal(body.reasoning.effort, "medium", "manteniamo reasoning medio per la qualità editoriale finale");
assert.equal(body.prompt_cache_key, "post-automatici:qa-profile");
assert.equal(body.max_output_tokens, 5000);
assert.equal(body.max_tool_calls, 1, "una generazione può fare al massimo una ricerca web per contenere la spesa");
assert.deepEqual(body.include, ["web_search_call.action.sources"]);
assert.equal(body.text.format.type, "json_schema");
assert.equal(body.text.format.strict, true);
assert.equal(body.tools[0].type, "web_search");
assert.equal(body.tools[0].search_context_size, "low", "ricerca web a contesto basso per contenere il costo");
assert.ok(body.text.format.schema.required.includes("editorialTopic"));
assert.ok(body.text.format.schema.required.includes("editorialAngle"));
assert.ok(String(body.instructions).includes("non inventare"));
assert.ok(String(body.instructions).includes("Perimetro editoriale"));
assert.ok(String(body.instructions).includes("non è l'unico universo di argomenti"));
assert.ok(String(body.input).includes("https://example.test/servizi/property-management"));
assert.equal(String(capturedInit?.body).includes("sk-test-only"), false, "la chiave non deve finire nel body/prompt");
assert.equal(result.researchMode, "BALANCED");
assert.deepEqual(result.externalSources, ["https://example.org/industry-report"]);
assert.equal(result.content.editorialTopic, "Gestione professionale degli affitti brevi");
assert.equal(result.content.editorialAngle, "Perché delegare la gestione riduce il carico operativo del proprietario");
assert.equal(result.content.variants[0].caption, "Un testo social verificato.");
assert.equal(result.model, "gpt-5.6-terra");
assert.equal(result.requestId, "req_test");
assert.equal(result.usage.inputTokens, 120);
assert.equal(result.usage.cachedInputTokens, 20);
assert.equal(result.usage.cacheWriteTokens, 10);
assert.equal(result.usage.outputTokens, 80);
assert.equal(result.usage.totalTokens, 200);
assert.equal(result.usage.webSearchCalls, 1);
assert.equal(result.usage.estimatedCostUsd, 0.011169);
assert.equal(estimateTerraCostUsd(120, 80, 20, 10), 0.001169);
assert.equal(countWebSearchCalls({ output: [{ type: "web_search_call" }, { type: "message" }] }), 1);
assert.deepEqual(extractWebSearchSources({ output: [{ type: "web_search_call", action: { sources: [{ url: "https://example.org/a" }, { url: "ftp://bad.example/file" }] } }] }), ["https://example.org/a"]);

let websiteOnlyBody: Record<string, any> | null = null;
const websiteOnlyFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  websiteOnlyBody = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ id: "resp_site", model: "gpt-5.6-terra", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(generated) }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200 });
}) as typeof fetch;
const websiteOnlyResult = await generateSocialText({ apiKey: "sk-test-only", topic: "Servizi reali", providers: ["INSTAGRAM"], formats: ["POST"], brand, fetcher: websiteOnlyFetcher, researchMode: "WEBSITE_ONLY" });
assert.equal(websiteOnlyBody && "tools" in websiteOnlyBody, false, "la modalità solo sito non deve attivare web search");
assert.equal(websiteOnlyResult.usage.webSearchCalls, 0);
assert.equal(websiteOnlyResult.usage.estimatedCostUsd, estimateTerraCostUsd(10, 10));

const upperBound = estimateTextRequestUpperBoundUsd({ topic: "property manager", objective: "lead", providers: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"], formats: ["POST"], brand, researchMode: "BALANCED" });
const websiteOnlyUpperBound = estimateTextRequestUpperBoundUsd({ topic: "property manager", objective: "lead", providers: ["INSTAGRAM"], formats: ["POST"], brand, researchMode: "WEBSITE_ONLY" });
assert.ok(upperBound > websiteOnlyUpperBound, "il budget preventivo deve includere il costo separato della ricerca web");
assert.ok(upperBound < 0.1, `una richiesta testo normale deve restare sotto $0.10 nel worst-case interno, ricevuto ${upperBound}`);

console.log("PASS OpenAI text: Terra + ricerca web filtrabile, una sola web run, fonti estratte e costo totale tracciato.");
