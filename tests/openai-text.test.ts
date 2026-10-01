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
assert.ok(body.text.format.schema.required.includes("pillar"));
assert.ok(body.text.format.schema.required.includes("editorialAngle"));
assert.ok(body.text.format.schema.properties.variants.items.required.includes("carouselSlides"));
assert.ok(String(body.instructions).includes("non inventare"));
assert.ok(String(body.instructions).includes("Perimetro editoriale"));
assert.ok(String(body.instructions).includes("non è l'unico universo di argomenti"));
assert.ok(String(body.input).includes("https://example.test/servizi/property-management"));
assert.ok(String(body.input).includes("Gestiamo pochi appartamenti selezionati"), "manual brand context must reach OpenAI generation");
assert.ok(String(body.instructions).includes("userProvidedContext"), "the model must be told how to treat manual brand context safely");
assert.match(String(body.instructions), /copywriter madrelingua italiano/i, "all generated copy must follow the global native-language quality rule");
assert.match(String(body.instructions), /5 cose che ho imparato in 20 anni di network marketing/i, "the global rule must include a concrete idiomatic Italian example");
assert.match(String(body.instructions), /controllo linguistico finale/i, "the same generation pass must self-check naturalness before returning JSON");
assert.ok(String(body.instructions).includes("vero carosello nativo"), "carousel generation must explicitly forbid collage-style fake carousels");
assert.match(String(body.instructions), /STRATEGIA COPY Instagram/);
assert.match(String(body.instructions), /Visual-first/i);
assert.match(String(body.instructions), /STRATEGIA VISUAL Instagram/);
assert.match(String(body.instructions), /hook forte/i);
assert.match(String(body.input), /platformStrategies/);
assert.match(String(body.input), /"provider":"INSTAGRAM"/);
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
    return new Response(JSON.stringify({ id: "resp_brand_fact", model: "gpt-5.6-terra", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(numberedBrandContent) }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200 });
  }
  factCheckPayload = JSON.parse(String(request.input));
  const checked = { verdict: "PASS", checkedClaims: [{ claim: "QA Property 7 offre gestione professionale", status: "VERIFIED", reason: "Il nome e il servizio sono presenti nei dati brand." }] };
  return new Response(JSON.stringify({ id: "resp_brand_fact_check", model: "gpt-5.6-terra", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(checked) }] }], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } }), { status: 200 });
}) as typeof fetch;
const brandFactResult = await generateSocialText({ apiKey: "sk-test-only", topic: "Presentazione attività", providers: ["INSTAGRAM"], formats: ["POST"], brand: { ...brand, profileName: "QA Property 7" }, fetcher: brandFactFetcher, researchMode: "WEBSITE_ONLY" });
assert.equal(brandFactCall, 2, "a material numbered brand claim must still run fact-checking");
assert.equal(factCheckPayload?.content?.brandFacts?.name, "QA Property 7", "fact-check must receive the same authoritative brand facts used for generation");
assert.equal(factCheckPayload?.content?.brandFacts?.userProvidedContext, brand.userContext, "fact-check must receive user-confirmed facts too");
assert.equal(brandFactResult.verification.factCheckVerdict, "PASS");

let forcedSourceCall = 0;
let forcedSourceFactCheckBody: Record<string, any> | null = null;
const comparisonContent = {
  ...generated,
  editorialTopic: "Airbnb e Booking",
  variants: [{ ...generated.variants[0], caption: "Airbnb e Booking: 5 differenze da valutare prima di scegliere.", factualBasis: ["BASE BRAND/SITO"] }],
};
const forcedSourceFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  forcedSourceCall += 1;
  const request = JSON.parse(String(init?.body)) as Record<string, any>;
  if (forcedSourceCall === 1) {
    return new Response(JSON.stringify({
      id: "resp_comparison",
      model: "gpt-5.6-terra",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(comparisonContent) }] }],
      usage: { input_tokens: 25, output_tokens: 40, total_tokens: 65 },
    }), { status: 200 });
  }
  forcedSourceFactCheckBody = request;
  const checked = {
    verdict: "PASS",
    checkedClaims: [{ claim: "5 differenze", claimType: "EDITORIAL", slideNumber: null, sourceRequired: false, status: "NOT_FACTUAL", reason: "Il numero descrive la struttura editoriale del post." }],
  };
  return new Response(JSON.stringify({
    id: "resp_comparison_factcheck",
    model: "gpt-5.6-terra",
    output: [
      { type: "web_search_call", action: { sources: [{ url: "https://example.org/platform-comparison" }] } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(checked) }] },
    ],
    usage: { input_tokens: 20, output_tokens: 20, total_tokens: 40 },
  }), { status: 200 });
}) as typeof fetch;
const forcedSourceResult = await generateSocialText({
  apiKey: "test-key",
  topic: "booking vs airbnb",
  objective: "le maggiori 5 differenze fra tutti e due",
  providers: ["INSTAGRAM"],
  formats: ["POST"],
  brand,
  fetcher: forcedSourceFetcher,
  researchMode: "BALANCED",
});
assert.equal(forcedSourceCall, 2, "a factual BALANCED request with no sources must proceed to fact-check");
assert.equal(forcedSourceFactCheckBody?.tool_choice, "required", "fact-check must not be allowed to skip web search when there are no sources");
assert.equal(forcedSourceResult.verification.factCheckVerdict, "PASS");
assert.equal(forcedSourceResult.usage.webSearchCalls, 1, "the forced verification search must be tracked in usage");

let repairFlowCall = 0;
let repairRequestBody: Record<string, any> | null = null;
const unsafeComparisonContent = {
  ...generated,
  editorialTopic: "Airbnb e Booking",
  variants: [{ ...generated.variants[0], caption: "Airbnb trattiene il 99% e Booking il 12%: 5 differenze.", factualBasis: ["BASE ESTERNA"] }],
};
const repairedComparisonContent = {
  ...generated,
  editorialTopic: "Airbnb e Booking",
  variants: [{ ...generated.variants[0], caption: "Airbnb e Booking hanno aspetti diversi da valutare: costi, regole, operatività, pubblico e gestione del canale.", factualBasis: ["BASE BRAND/SITO"] }],
};
const repairFlowFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  repairFlowCall += 1;
  const request = JSON.parse(String(init?.body)) as Record<string, any>;
  if (repairFlowCall === 1) {
    return new Response(JSON.stringify({
      id: "resp_repair_generation", model: "gpt-5.6-terra",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(unsafeComparisonContent) }] }],
      usage: { input_tokens: 20, output_tokens: 20, total_tokens: 40 },
    }), { status: 200 });
  }
  if (repairFlowCall === 2) {
    const checked = {
      verdict: "NEEDS_SOURCE",
      checkedClaims: [{ claim: "Airbnb 99% e Booking 12%", claimType: "EXTERNAL", slideNumber: null, sourceRequired: true, status: "UNSUPPORTED", reason: "Percentuali non supportate." }],
    };
    return new Response(JSON.stringify({
      id: "resp_repair_factcheck_1", model: "gpt-5.6-terra",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(checked) }] }],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    }), { status: 200 });
  }
  if (repairFlowCall === 3) {
    repairRequestBody = request;
    return new Response(JSON.stringify({
      id: "resp_copy_repair", model: "gpt-5.6-terra",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(repairedComparisonContent) }] }],
      usage: { input_tokens: 30, output_tokens: 20, total_tokens: 50 },
    }), { status: 200 });
  }
  const checked = {
    verdict: "PASS",
    checkedClaims: [{ claim: "5 differenze", claimType: "EDITORIAL", slideNumber: null, sourceRequired: false, status: "NOT_FACTUAL", reason: "Struttura editoriale." }],
  };
  return new Response(JSON.stringify({
    id: "resp_repair_factcheck_2", model: "gpt-5.6-terra",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(checked) }] }],
    usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
  }), { status: 200 });
}) as typeof fetch;
const repairedResult = await generateSocialText({
  apiKey: "test-key",
  topic: "booking vs airbnb",
  objective: "le maggiori 5 differenze fra tutti e due",
  providers: ["INSTAGRAM"],
  formats: ["POST"],
  brand,
  fetcher: repairFlowFetcher,
  researchMode: "WEBSITE_ONLY",
});
assert.equal(repairFlowCall, 4, "a NEEDS_SOURCE result must get one copy repair and one final verification");
assert.match(String(repairRequestBody?.instructions), /Copy Repair Agent/);
assert.doesNotMatch(repairedResult.content.variants[0].caption, /99%|12%/);
assert.equal(repairedResult.verification.factCheckVerdict, "PASS");
assert.ok(repairedResult.technicalEvents.some((event) => event.operation === "AGENT_COPY_REPAIR"));
assert.equal(repairedResult.usage.inputTokens, 70);
assert.equal(repairedResult.usage.outputTokens, 60);

const carouselGenerated = {
  editorialTopic: "Checklist per preparare un immobile",
  pillar: "Affitti brevi",
  editorialAngle: "Una verifica pratica prima di pubblicare l'annuncio",
  strategySummary: "Carosello educativo progressivo.",
  variants: [{
    provider: "INSTAGRAM",
    format: "CAROUSEL",
    eligible: true,
    hook: "Prima di pubblicare, controlla questi 4 punti",
    caption: "Una checklist concreta da scorrere slide per slide.",
    cta: "Salva la checklist",
    hashtags: ["#affittibrevi"],
    visualBrief: "Sistema grafico coerente per quattro slide quadrate",
    altText: "Checklist in quattro slide",
    factualBasis: ["BASE BRAND/SITO"],
    carouselSlides: [
      { position: 1, purpose: "Hook", headline: "Prima di pubblicare", body: "Controlla questi 4 punti.", hierarchy: "Titolo dominante", visualBrief: "Copertina pulita con numero 4", altText: "Copertina checklist" },
      { position: 2, purpose: "Controllo 1", headline: "Descrizione chiara", body: "Spiega cosa trova davvero l'ospite.", hierarchy: "Titolo + testo breve", visualBrief: "Scheda testuale con icona documento", altText: "Slide sulla descrizione" },
      { position: 3, purpose: "Controllo 2", headline: "Foto coerenti", body: "Mostra gli spazi senza promesse non supportate.", hierarchy: "Titolo + visuale", visualBrief: "Interno luminoso senza persone", altText: "Slide sulle fotografie" },
      { position: 4, purpose: "CTA", headline: "Checklist pronta", body: "Salvala e usala prima della pubblicazione.", hierarchy: "CTA dominante", visualBrief: "Chiusura grafica con checklist", altText: "Slide finale con invito a salvare" },
    ],
  }],
} as const;
let carouselBody: Record<string, any> | null = null;
let carouselCalls = 0;
const carouselFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  carouselCalls += 1;
  const request = JSON.parse(String(init?.body));
  if (carouselCalls === 1) {
    carouselBody = request;
    return new Response(JSON.stringify({
      id: "resp_carousel",
      model: "gpt-5.6-terra",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(carouselGenerated) }] }],
      usage: { input_tokens: 30, output_tokens: 120, total_tokens: 150 },
    }), { status: 200 });
  }
  return new Response(JSON.stringify({
    id: "resp_carousel_factcheck",
    model: "gpt-5.6-terra",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
      verdict: "PASS",
      checkedClaims: [{ claim: "4 punti", status: "VERIFIED", reason: "Il numero descrive la struttura editoriale del carosello, non un fatto esterno." }],
    }) }] }],
    usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 },
  }), { status: 200 });
}) as typeof fetch;
const carouselResult = await generateSocialText({
  apiKey: "sk-test-only",
  topic: "Checklist preparazione immobile",
  providers: ["INSTAGRAM"],
  formats: ["CAROUSEL"],
  brand,
  fetcher: carouselFetcher,
  researchMode: "WEBSITE_ONLY",
});
assert.equal(carouselResult.content.pillar, "Affitti brevi");
assert.equal(carouselResult.content.variants[0].carouselSlides?.length, 4);
assert.deepEqual(carouselResult.content.variants[0].carouselSlides?.map((slide) => slide.position), [1, 2, 3, 4]);
assert.equal(carouselBody?.text.format.schema.properties.variants.items.properties.carouselSlides.maxItems, 10);

const upperBound = estimateTextRequestUpperBoundUsd({ topic: "property manager", objective: "lead", providers: ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"], formats: ["POST"], brand, researchMode: "BALANCED" });
const websiteOnlyUpperBound = estimateTextRequestUpperBoundUsd({ topic: "property manager", objective: "lead", providers: ["INSTAGRAM"], formats: ["POST"], brand, researchMode: "WEBSITE_ONLY" });
assert.ok(upperBound > websiteOnlyUpperBound, "il budget preventivo deve includere il costo separato della ricerca web");
assert.ok(upperBound < 0.1, `una richiesta testo normale deve restare sotto $0.10 nel worst-case interno, ricevuto ${upperBound}`);

console.log("PASS OpenAI text: Terra + ricerca web filtrabile, una sola web run, fonti estratte e costo totale tracciato.");
