import assert from "node:assert/strict";
import { CONTENT_AGENTS, buildEditorialPlan, buildOrchestratorInstruction, chooseContentType, mapContentTypeToSocialFormat } from "../api/_lib/content-agents.js";

assert.equal(CONTENT_AGENTS.length, 10);
assert.deepEqual(CONTENT_AGENTS.map((agent) => agent.role), ["STRATEGIST","RESEARCHER","FACT_CHECKER","PLANNER","COPYWRITER","VISUAL_DIRECTOR","FORMAT_BUILDER","QA","PUBLISHER","ANALYST"]);
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "RESEARCHER")?.mayUseWeb, true);
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "COPYWRITER")?.mayUseWeb, false);
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "VISUAL_DIRECTOR")?.mayUseOpenAI, true, "Visual Director is now the OpenAI Media Manager stage");
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "VISUAL_DIRECTOR")?.mayUseWeb, false, "Media Manager must not spend on web research");
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "FORMAT_BUILDER")?.mayUseOpenAI, false, "deterministic native-format mapping must not be falsely labelled an AI agent runtime");
assert.equal(CONTENT_AGENTS.find((agent) => agent.role === "QA")?.blocksOnFailure, true);

assert.equal(chooseContentType("INSTAGRAM", 0), "SINGLE_POST");
assert.equal(chooseContentType("INSTAGRAM", 1), "CAROUSEL");
assert.equal(chooseContentType("INSTAGRAM", 2), "SINGLE_STORY");
assert.equal(chooseContentType("INSTAGRAM", 3), "STORYTELLING");
assert.equal(mapContentTypeToSocialFormat("INSTAGRAM", "STORYTELLING"), "CAROUSEL");
assert.equal(mapContentTypeToSocialFormat("INSTAGRAM", "SINGLE_STORY"), "STORY");
assert.equal(mapContentTypeToSocialFormat("LINKEDIN", "SINGLE_STORY"), "POST");
assert.equal(mapContentTypeToSocialFormat("GBP", "CAROUSEL"), "POST");

const propertyPlan = buildEditorialPlan({
  provider: "INSTAGRAM",
  count: 3,
  industry: "Property management",
  location: "Milano",
  serviceArea: "Milano e Monza",
  objective: "Generare richieste da proprietari",
  now: new Date("2026-08-29T10:00:00Z"),
});
assert.equal(propertyPlan.contentType, "STORYTELLING");
assert.equal(propertyPlan.nativeFormat, "CAROUSEL");
assert.equal(propertyPlan.season, "ESTATE");
assert.match(propertyPlan.localization ?? "", /Milano/);
assert.match(propertyPlan.narrativeInstruction, /sequenza narrativa/i);
assert.equal(propertyPlan.agentSequence.length, 10);

const instruction = buildOrchestratorInstruction(propertyPlan);
assert.match(instruction, /STRATEGIST -> RESEARCHER -> FACT_CHECKER/);
assert.match(instruction, /non forzare keyword locali/i);
assert.match(instruction, /Non inventare integrazioni o metriche/i);

const plumberPlan = buildEditorialPlan({ provider: "FACEBOOK", count: 8, industry: "Idraulico", location: "Monza", now: new Date("2026-01-15T10:00:00Z") });
assert.equal(plumberPlan.season, "INVERNO");
assert.equal(plumberPlan.intent, "CHECKLIST");
assert.ok(plumberPlan.cta.length > 5);

console.log("content agents regression: PASS");
