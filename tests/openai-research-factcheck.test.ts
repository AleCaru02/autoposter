import assert from "node:assert/strict";
import { contentNeedsFactCheck, runOpenAIFactCheckAgent, runOpenAIResearchAgent, shouldRunResearchAgent } from "../api/_lib/openai-research-factcheck.js";

assert.equal(shouldRunResearchAgent("NEWS"), true);
assert.equal(shouldRunResearchAgent("BALANCED"), false);
assert.equal(contentNeedsFactCheck({ caption: "Contenuto editoriale senza dati numerici sensibili." }, "BALANCED"), false);
assert.equal(contentNeedsFactCheck({ caption: "3 consigli pratici per gestire meglio un immobile." }, "WEBSITE_ONLY"), false, "structural list counts must not trigger external fact-checking");
assert.equal(contentNeedsFactCheck({ caption: "Abbiamo seguito 100 clienti." }, "WEBSITE_ONLY"), true, "material bare-number claims must still require fact-checking");
assert.equal(contentNeedsFactCheck({ caption: "Il valore è aumentato del 12%." }, "BALANCED"), true);
assert.equal(contentNeedsFactCheck({ caption: "Il servizio costa 100 €." }, "WEBSITE_ONLY"), true);
assert.equal(contentNeedsFactCheck({ caption: "La regola cambia nel 2026." }, "WEBSITE_ONLY"), true);
assert.equal(contentNeedsFactCheck({ caption: "Aggiornamento di settore" }, "NEWS"), true);

let researchCalls = 0;
const researchFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  researchCalls += 1;
  const request = JSON.parse(String(init?.body)) as Record<string, any>;
  assert.equal(request.model, "gpt-5.6-terra");
  assert.equal(request.store, false);
  assert.equal(request.max_tool_calls, 1);
  assert.equal(request.tools[0].type, "web_search");
  const output = {
    status: "READY",
    summary: "Evidenza recente disponibile.",
    evidence: [{ claim: "Aggiornamento confermato", evidenceSummary: "La fonte ufficiale conferma l'aggiornamento.", sourceType: "OFFICIAL", datedAt: "2026-08-29", reliability: "HIGH" }],
  };
  return new Response(JSON.stringify({
    id: "resp_research",
    model: "gpt-5.6-terra",
    output: [
      { type: "web_search_call", action: { sources: [{ url: "https://example.org/official-update" }] } },
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] },
    ],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }), { status: 200, headers: { "x-request-id": "req_research" } });
}) as typeof fetch;

const research = await runOpenAIResearchAgent({
  apiKey: "sk-test-only",
  topic: "Aggiornamento settore",
  industry: "Property management",
  businessDescription: "Gestione immobili",
  target: "Proprietari",
  freshnessDays: 7,
  fetcher: researchFetcher,
});
assert.equal(researchCalls, 1);
assert.equal(research.status, "READY");
assert.equal(research.sources[0], "https://example.org/official-update");
assert.equal(research.usage.webSearchCalls, 1);
assert.equal(research.evidence[0].sourceType, "OFFICIAL");

let factCheckBody: Record<string, any> | null = null;
const factCheckFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  factCheckBody = JSON.parse(String(init?.body));
  const output = { verdict: "PASS", checkedClaims: [{ claim: "Aggiornamento confermato", claimType: "EXTERNAL", slideNumber: null, sourceRequired: true, status: "VERIFIED", reason: "Supportato dall'evidenza ufficiale." }] };
  return new Response(JSON.stringify({
    id: "resp_factcheck",
    model: "gpt-5.6-terra",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
    usage: { input_tokens: 80, output_tokens: 40, total_tokens: 120 },
  }), { status: 200, headers: { "x-request-id": "req_factcheck" } });
}) as typeof fetch;

const checked = await runOpenAIFactCheckAgent({
  apiKey: "sk-test-only",
  topic: "Aggiornamento settore",
  content: { caption: "Aggiornamento confermato" },
  research,
  existingSources: research.sources,
  allowWebSearch: false,
  fetcher: factCheckFetcher,
});
assert.equal(checked.verdict, "PASS");
assert.equal(checked.checkedClaims[0].status, "VERIFIED");
assert.equal(checked.checkedClaims[0].claimType, "EXTERNAL");
assert.equal(checked.checkedClaims[0].sourceRequired, true);
assert.equal(factCheckBody?.text.format.schema.properties.verdict.enum.includes("NEEDS_SOURCE"), true);
assert.equal(String(factCheckBody?.instructions).includes("EDITORIAL"), true);
assert.equal(factCheckBody && "tools" in factCheckBody, false, "Fact-check must reuse existing evidence instead of paying for another web search");

let forcedFactCheckBody: Record<string, any> | null = null;
const forcedFactCheck = await runOpenAIFactCheckAgent({
  apiKey: "test-key",
  topic: "Airbnb vs Booking",
  content: { caption: "Confronto tra piattaforme con affermazioni da verificare." },
  research: null,
  existingSources: [],
  allowWebSearch: true,
  requireWebSearch: true,
  fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
    forcedFactCheckBody = JSON.parse(String(init?.body));
    const output = { verdict: "PASS", checkedClaims: [{ claim: "Confronto piattaforme", claimType: "EXTERNAL", slideNumber: null, sourceRequired: true, status: "VERIFIED", reason: "Verificato con fonte ufficiale." }] };
    return new Response(JSON.stringify({
      id: "resp_factcheck_forced",
      model: "gpt-5.6-terra",
      output: [
        { type: "web_search_call", action: { sources: [{ url: "https://example.org/platform-source" }] } },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] },
      ],
      usage: { input_tokens: 90, output_tokens: 40, total_tokens: 130 },
    }), { status: 200 });
  }) as typeof fetch,
});
assert.equal(forcedFactCheckBody?.tool_choice, "required", "when verification has no sources the fact-check must actually perform the allowed web lookup");
assert.equal(forcedFactCheck.usage.webSearchCalls, 1);
assert.equal(forcedFactCheck.sources[0], "https://example.org/platform-source");

let repairCalls = 0;
const repaired = await runOpenAIFactCheckAgent({
  apiKey: "test-key",
  topic: "Airbnb vs Booking",
  content: { caption: "Confronto tra Airbnb e Booking con differenze operative." },
  research: null,
  existingSources: [],
  allowWebSearch: true,
  requireWebSearch: true,
  fetcher: (async (_url: string | URL | Request, init?: RequestInit) => {
    repairCalls += 1;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.tool_choice, "required");
    if (repairCalls === 1) {
      return new Response(JSON.stringify({
        id: "resp_factcheck_missing_booking",
        model: "gpt-5.6-terra",
        output: [
          { type: "web_search_call", action: { sources: [{ url: "https://example.org/airbnb-source" }] } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify({
            verdict: "NEEDS_SOURCE",
            checkedClaims: [
              { claim: "Airbnb claim", claimType: "EXTERNAL", slideNumber: null, sourceRequired: true, status: "VERIFIED", reason: "Fonte disponibile." },
              { claim: "Booking claim", claimType: "EXTERNAL", slideNumber: null, sourceRequired: true, status: "UNSUPPORTED", reason: "Manca fonte Booking." },
            ],
          }) }] },
        ],
        usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      }), { status: 200 });
    }
    const repairPayload = JSON.parse(String(request.input));
    assert.match(JSON.stringify(repairPayload.repairFocus), /Booking claim/);
    return new Response(JSON.stringify({
      id: "resp_factcheck_repaired",
      model: "gpt-5.6-terra",
      output: [
        { type: "web_search_call", action: { sources: [{ url: "https://example.org/booking-source" }] } },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify({
          verdict: "PASS",
          checkedClaims: [
            { claim: "Airbnb claim", claimType: "EXTERNAL", slideNumber: null, sourceRequired: true, status: "VERIFIED", reason: "Fonte disponibile." },
            { claim: "Booking claim", claimType: "EXTERNAL", slideNumber: null, sourceRequired: true, status: "VERIFIED", reason: "Fonte Booking trovata nel secondo pass." },
          ],
        }) }] },
      ],
      usage: { input_tokens: 110, output_tokens: 55, total_tokens: 165 },
    }), { status: 200 });
  }) as typeof fetch,
});
assert.equal(repairCalls, 2, "NEEDS_SOURCE with web enabled must receive exactly one targeted repair pass");
assert.equal(repaired.verdict, "PASS");
assert.deepEqual(repaired.sources, ["https://example.org/airbnb-source", "https://example.org/booking-source"]);
assert.equal(repaired.usage.webSearchCalls, 2);
assert.equal(repaired.usage.inputTokens, 210);


console.log("OpenAI Research + Fact-check agents regression: PASS");
