import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runOpenAIEditorialQA } from "../api/_lib/openai-editorial-qa.js";
import { CONTENT_AGENTS } from "../api/_lib/content-agents.js";

let requestBody: Record<string, any> | null = null;
const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  requestBody = JSON.parse(String(init?.body ?? "{}"));
  return new Response(JSON.stringify({
    id: "resp_qa",
    model: "gpt-5.6-terra",
    output_text: JSON.stringify({
      verdict: "PASS",
      reasons: [],
      checks: { brandConsistency: "PASS", platformFit: "PASS", formatFit: "PASS", ctaFit: "PASS", claimSafety: "PASS", visualSafety: "PASS" },
    }),
    usage: { input_tokens: 120, output_tokens: 60, total_tokens: 180 },
  }), { status: 200, headers: { "x-request-id": "req_qa" } });
}) as typeof fetch;

const qa = await runOpenAIEditorialQA({
  apiKey: "test-only",
  profileName: "Attività QA",
  industry: "Property management",
  tone: "Professionale",
  provider: "LINKEDIN",
  format: "POST",
  objective: "Lead",
  content: { editorialTopic: "Gestione affitti brevi", editorialAngle: "Ridurre il carico operativo", strategySummary: "Educare", variants: [] },
  variant: { provider: "LINKEDIN", format: "POST", eligible: true, hook: "Gestire meglio", caption: "Un insight professionale.", cta: "Approfondisci", hashtags: [], visualBrief: "Interno ordinato", altText: "Interno ordinato", factualBasis: ["BASE BRAND/SITO: servizio confermato"] },
  verification: { researchAgentRan: false, factCheckAgentRan: false, factCheckVerdict: null },
  externalSources: [],
  fetcher,
});

assert.equal(qa.verdict, "PASS");
assert.equal(qa.model, "gpt-5.6-terra");
assert.equal(qa.requestId, "req_qa");
assert.equal(requestBody?.model, "gpt-5.6-terra");
assert.equal(requestBody?.store, false);
assert.equal(requestBody?.reasoning.effort, "low");
assert.equal("tools" in (requestBody ?? {}), false, "Editorial QA must not use web search");
assert.equal(requestBody?.text.format.strict, true);
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "QA")?.mayUseOpenAI, true);
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "QA")?.mayUseWeb, false);

const autopilot = await readFile(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
assert.match(autopilot, /approvalMode==="AUTOMATIC"&&variant\.eligible/, "OpenAI QA must run only for automatic eligible content");
assert.match(autopilot, /runOpenAIEditorialQA/, "automatic Autopilot must call the QA agent");
assert.match(autopilot, /AUTOPILOT_EDITORIAL_QA_BLOCKED/, "QA BLOCK must stop the automatic path");
assert.match(autopilot, /AUTO_QA_RESERVE_USD/, "automatic QA cost must be reserved before generation");
assert.ok(autopilot.indexOf("runOpenAIEditorialQA") < autopilot.indexOf("generateOpenAIImage({"), "QA must run before Media Manager/gpt-image-2 spend");
assert.match(autopilot, /'AGENT_EDITORIAL_QA'/, "QA usage must be persisted per profile");

console.log("OpenAI Editorial QA regression: PASS — automatic-only, fail-closed, no web, before media spend.");
