import assert from "node:assert/strict";
import { contentNeedsFactCheck, runOpenAIFactCheckAgent, runOpenAIResearchAgent, shouldRunResearchAgent } from "../api/_lib/openai-research-factcheck.js";

assert.equal(shouldRunResearchAgent("NEWS"), true);
assert.equal(shouldRunResearchAgent("BALANCED"), false);
assert.equal(contentNeedsFactCheck({ caption: "Contenuto editoriale senza dati numerici sensibili." }, "BALANCED"), false);
assert.equal(contentNeedsFactCheck({ caption: "Il valore è aumentato del 12%." }, "BALANCED"), true);
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
  const output = { verdict: "PASS", checkedClaims: [{ claim: "Aggiornamento confermato", status: "VERIFIED", reason: "Supportato dall'evidenza ufficiale." }] };
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
assert.equal(factCheckBody && "tools" in factCheckBody, false, "Fact-check must reuse existing evidence instead of paying for another web search");

console.log("OpenAI Research + Fact-check agents regression: PASS");
