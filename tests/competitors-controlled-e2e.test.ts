import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertSocialPublishingAllowed } from "../api/_lib/social.js";
import { generateSocialText, estimateTextRequestUpperBoundUsd } from "../api/_lib/openai-text.js";
import { brainDecision, activityBudgetBand } from "../api/_lib/ai-brain-policy.js";
import { shouldRunResearchAgent, contentNeedsFactCheck } from "../api/_lib/openai-research-factcheck.js";
import { requestManualContent, manualGenerationFingerprint } from "../src/features/content/manual-content-generation.js";
import { loadAutopilotOverview, saveAutopilotSettings } from "../src/features/content/autopilot-store.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const strategies = new Map<string, Record<string, unknown>>([
  [A, { researchMode: "BALANCED", keepMe: "brand-a" }],
  [B, { researchMode: "NEWS", keepMe: "brand-b" }],
]);
const writes: Array<{ table: string; profileId: string }> = [];

// A real chain-shaped Neon mock: no database, token, network or external writes.
const db = {
  from(table: string) {
    let profileId = "";
    let update: Record<string, any> | null = null;
    let insert: Record<string, any> | null = null;
    const query: any = {
      select() { return query; },
      eq(field: string, value: string) { if (field === "profile_id") profileId = value; return query; },
      gt() { return query; },
      in() { return query; },
      order() { return query; },
      update(value: Record<string, any>) { update = value; return query; },
      insert(value: Record<string, any>) { insert = value; return query; },
      async maybeSingle() {
        const strategy = strategies.get(profileId);
        return { data: table === "content_strategies" && strategy
          ? { profile_id: profileId, platform_strategy: { ...strategy } } : null, error: null };
      },
      then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
        if (table === "content_strategies" && (update || insert)) {
          const data = (update || insert)!;
          const id = profileId || String(data.profile_id);
          strategies.set(id, data.platform_strategy);
          writes.push({ table, profileId: id });
        }
        return Promise.resolve({ error: null, data: [], count: 0 }).then(resolve, reject);
      },
    };
    return query;
  },
};
const settingsA = { enabled: false, approvalMode: "MANUAL_REVIEW" as const, researchMode: "COMPETITORS" as const, websitePilotEnabled: false };
await saveAutopilotSettings(A, settingsA, db as any);
assert.deepEqual(writes, [{ table: "content_strategies", profileId: A }]);
assert.equal((await loadAutopilotOverview(A, db as any)).settings.researchMode, "COMPETITORS");
assert.equal((await loadAutopilotOverview(A, db as any)).settings.approvalMode, "MANUAL_REVIEW");
assert.equal((await loadAutopilotOverview(B, db as any)).settings.researchMode, "NEWS");
assert.equal(strategies.get(A)?.keepMe, "brand-a");
assert.equal(strategies.get(B)?.keepMe, "brand-b");

const page = readFileSync(new URL("../src/pages/content-generator-page.tsx", import.meta.url), "utf8");
assert.match(page, /value: "COMPETITORS", title: "Competitor"/);
assert.match(page, /changeSettings\(\{ researchMode: mode.value \}\)/);
assert.match(page, /patch.researchMode !== "COMPETITORS"/, "selection alone must not start a billable autopilot run");
assert.match(page, /ManualContentComposer[\s\S]*researchMode=\{overview.settings.researchMode\}/);
const manual = readFileSync(new URL("../src/features/content/manual-content-generation.ts", import.meta.url), "utf8");
assert.match(manual, /researchMode: input.researchMode/);
const server = readFileSync(new URL("../api/generate-text.ts", import.meta.url), "utf8");
const worker = readFileSync(new URL("../cloudflare/generate-text.ts", import.meta.url), "utf8");
for (const entry of [server, worker]) {
  assert.match(entry, /ActivityBudgetEngine/);
  assert.ok(entry.indexOf(".preflight(") < entry.indexOf("await generateSocialText"), "budget preflight must precede external AI call");
}
assert.equal(activityBudgetBand(30), "HARD_STOP");
assert.equal(brainDecision({ spendEur: 30, task: "COPY_FINAL", researchMode: "COMPETITORS" }).allowBillableAi, false);
assert.equal(shouldRunResearchAgent("COMPETITORS"), true);
assert.equal(shouldRunResearchAgent("BALANCED"), false);
assert.equal(contentNeedsFactCheck({ caption: "Un testo senza numeri" }, "COMPETITORS"), true);

const brand = {
  profileName: "Studio Siti", industry: "Realizzazione siti web", websiteUrl: "https://studio.example",
  description: "Creazione di siti per piccole imprese", businessModel: "Servizi B2B",
  location: "Milano", serviceArea: "Italia", target: "Imprenditori italiani",
  tone: "Concreto", goals: ["Contatti qualificati"], userContext: "Bozza iniziale gratuita.",
  confirmedWebsiteContent: [{ url: "https://studio.example/servizi", title: "Siti per imprese", text: "Bozza iniziale gratuita per siti web professionali." }],
};
const draft = {
  editorialTopic: "Presentare servizi digitali in modo comprensibile",
  editorialAngle: "Mostrare al cliente cosa comprende il servizio senza promesse difficili da verificare.",
  strategySummary: "Spiegare il servizio con un esempio concreto e un invito alla bozza gratuita.",
  variants: [{
    provider: "INSTAGRAM", format: "POST", eligible: true,
    hook: "Il cliente deve capire subito cosa offri",
    caption: "Un sito può presentare chiaramente i tuoi servizi, le informazioni essenziali e il modo per contattarti. Richiedi una bozza iniziale gratuita.",
    cta: "Richiedi la bozza gratuita", hashtags: ["#sitiweb"],
    visualBrief: "Una pagina web ordinata su schermo neutro, leggibile.",
    altText: "Presentazione di un sito web professionale.",
    factualBasis: ["BASE BRAND/SITO: bozza iniziale gratuita"], carouselSlides: [],
  }],
};
function reply(name: string, payload: unknown, urls: string[] = [], status = 200) {
  if (status !== 200) return new Response(JSON.stringify({ error: { code: "provider_error" } }), { status });
  return new Response(JSON.stringify({
    id: "mock-" + name, model: "gpt-5.6-terra",
    output: [
      ...(urls.length ? [{ type: "web_search_call", action: { sources: urls.map(url => ({ url })) } }] : []),
      { type: "message", content: [{ type: "output_text", text: JSON.stringify(payload) }] },
    ],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }), { status: 200, headers: { "x-request-id": "req-" + name } });
}
const sourceA = "https://agencya.example/servizi";
const sourceB = "https://agencyb.example/servizi";
const researchPayload = {
  status: "READY", summary: "Due esempi pubblici di presentazione dei servizi: spunti, non risultati.",
  evidence: [{ claim: "Le pagine descrivono servizi", evidenceSummary: "Descrizioni pubbliche di servizi; non provano conversioni.", sourceType: "PRIMARY", datedAt: null, reliability: "HIGH" }],
};
const factPayload = {
  verdict: "PASS", checkedClaims: [{ claim: "Invito a richiedere una bozza", claimType: "EDITORIAL", slideNumber: null, sourceRequired: false, status: "NOT_FACTUAL", reason: "CTA editoriale." }],
};
function makeMock(urls: string[], failResearch = false) {
  const stages: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const call = JSON.parse(String(init?.body)) as Record<string, any>;
    assert.equal(call.store, false);
    stages.push(call.text.format.name);
    if (stages.length === 1) {
      assert.equal(call.text.format.name, "post_automatici_research_agent");
      assert.equal(call.tool_choice, "required");
      assert.match(String(call.input), /Confronto tra competitor del settore/);
      return failResearch ? reply("provider-error", {}, [], 503) : reply("research", researchPayload, urls);
    }
    if (stages.length === 2) {
      assert.equal(call.text.format.name, "post_automatici_social_content");
      assert.equal("tools" in call, false, "copy must reuse research without a second search");
      const input = JSON.parse(String(call.input));
      assert.equal(input.task.researchMode, "COMPETITORS");
      assert.ok(input.researchAgentEvidence.sources.length >= 2);
      assert.match(String(call.instructions), /Non copiare testi/);
      return reply("copy", draft);
    }
    assert.equal(call.text.format.name, "post_automatici_fact_check_agent");
    return reply("fact", factPayload);
  };
  return { fetcher, stages };
}
const options = {
  apiKey: "mock-key-never-sent", topic: "Come presentare un sito per piccole imprese",
  objective: "Invitare a richiedere una bozza", providers: ["INSTAGRAM" as const],
  formats: ["POST" as const], brand, researchMode: "COMPETITORS" as const,
};
assert.ok(estimateTextRequestUpperBoundUsd(options) > estimateTextRequestUpperBoundUsd({ ...options, researchMode: "WEBSITE_ONLY" }));
for (const urls of [[], [sourceA], [sourceA, sourceA + "?ref=other"]]) {
  const mock = makeMock(urls);
  await assert.rejects(generateSocialText({ ...options, fetcher: mock.fetcher }), /OPENAI_RESEARCH_BLOCKED/);
  assert.deepEqual(mock.stages, ["post_automatici_research_agent"], "zero or one independent source must block before copy");
}
const failed = makeMock([], true);
await assert.rejects(generateSocialText({ ...options, fetcher: failed.fetcher }), /OPENAI_AGENT_HTTP_503/);
assert.deepEqual(failed.stages, ["post_automatici_research_agent"], "provider error must not generate copy");
const success = makeMock([sourceA, sourceB]);
const checked = await generateSocialText({ ...options, fetcher: success.fetcher });
assert.deepEqual(success.stages, ["post_automatici_research_agent", "post_automatici_social_content", "post_automatici_fact_check_agent"]);
assert.equal(checked.verification.researchAgentRan, true);
assert.equal(checked.verification.factCheckAgentRan, true);
assert.equal(checked.verification.factCheckVerdict, "PASS");
assert.equal(checked.researchMode, "COMPETITORS");
assert.equal(checked.externalSources.length, 2);
assert.equal(checked.usage.webSearchCalls, 1);
assert.equal(checked.content.variants[0]?.caption, draft.variants[0].caption);
assert.doesNotMatch(JSON.stringify(checked.content), /\b(?:follower|viralità|conversioni garantite|visualizzazioni)\b/i);
assert.ok(checked.technicalEvents.some(event => event.operation === "AGENT_RESEARCH"));
assert.ok(checked.technicalEvents.some(event => event.operation === "AGENT_FACTCHECK"));

const request = { profileId: A, topic: options.topic, objective: options.objective, providers: options.providers, format: "POST" as const, researchMode: "COMPETITORS" as const };
assert.notEqual(manualGenerationFingerprint(request), manualGenerationFingerprint({ ...request, profileId: B }));
let manualCalls = 0;
const prepared = await requestManualContent(request, "fake-jwt", "test-operation-id-0000000001", (async (url, init) => {
  manualCalls += 1;
  assert.equal(url, "/api/generate-text", "manual draft must not open a publication endpoint");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.profileId, A);
  assert.equal(body.researchMode, "COMPETITORS");
  assert.deepEqual(body.providers, ["INSTAGRAM"]);
  return new Response(JSON.stringify({
    content: checked.content,
    editorialContext: { profileType: "BUSINESS", pillar: null, sourceProfileId: null, sourceProfileIds: [], sourceRefs: [], audience: {}, factProvenance: [], externalSources: checked.externalSources, sourceIntelligence: checked.sourceIntelligence },
  }), { status: 200 });
}) as typeof fetch);
assert.equal(manualCalls, 1);
assert.equal(prepared.content.variants[0]?.caption, draft.variants[0].caption);
assert.equal(prepared.editorialContext.externalSources.length, 2);
assert.throws(() => assertSocialPublishingAllowed({ SAFE_MODE: true }), /SAFE_MODE_ACTIVE/, "safe mode blocks social writes");
console.log("PASS competitors controlled E2E: per-profile mode persistence, research 0/1/2 sources, errors, fact-check, budget and draft only.");
