import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAutopilotPillarInstruction, contentPillarsFromVisualIdentity, enrichRequestedTopicWithPillars, selectAutopilotPillar } from "../api/_lib/editorial-intelligence.js";

const visualIdentity = {
  contentPillars: [
    { name: "Gestione operativa", description: "Processi quotidiani per affitti brevi", sourceUrls: ["https://example.test/servizi", "javascript:alert(1)"] },
    { name: "Normativa locale", description: "Adempimenti verificati sul sito", sourceUrls: ["https://example.test/normativa"] },
    { name: "Marketing immobiliare", description: "Posizionamento e presentazione degli immobili", sourceUrls: ["https://example.test/marketing"] },
    { name: "gestione operativa", description: "Duplicato che deve essere ignorato", sourceUrls: [] },
    { name: "", description: "Senza nome", sourceUrls: [] },
  ],
};

const pillars = contentPillarsFromVisualIdentity(visualIdentity);
assert.equal(pillars.length, 3);
assert.equal(pillars[0].name, "Gestione operativa");
assert.deepEqual(pillars[0].sourceUrls, ["https://example.test/servizi"]);
assert.equal(pillars[1].name, "Normativa locale");

const plain = enrichRequestedTopicWithPillars("Come preparare un immobile", null);
assert.equal(plain.topic, "Come preparare un immobile");
assert.equal(plain.pillarCount, 0);

const enriched = enrichRequestedTopicWithPillars("Come preparare un immobile", visualIdentity);
assert.equal(enriched.pillarCount, 3);
assert.ok(enriched.topic.startsWith("Come preparare un immobile"));
assert.ok(enriched.topic.includes("Gestione operativa"));
assert.ok(enriched.topic.includes("https://example.test/servizi"));
assert.ok(enriched.topic.includes("Normativa locale"));
assert.equal(enriched.topic.includes("javascript:"), false);
assert.ok(enriched.topic.includes("Non copiare queste istruzioni in editorialTopic o editorialAngle"));

const unused = selectAutopilotPillar(visualIdentity, ["Gestione operativa: come organizzare check-in e pulizie", "Normativa locale per affitti brevi a Milano"], 0);
assert.equal(unused.pillar?.name, "Marketing immobiliare");
assert.equal(unused.recentUsage, 0);
assert.equal(unused.pillarCount, 3);
assert.equal(selectAutopilotPillar(visualIdentity, [], 0).pillar?.name, "Gestione operativa");
assert.equal(selectAutopilotPillar(visualIdentity, [], 1).pillar?.name, "Normativa locale");

const fallback = buildAutopilotPillarInstruction(null, [], 0);
assert.equal(fallback.pillar, null);
assert.equal(fallback.instruction, "");
const instruction = buildAutopilotPillarInstruction(visualIdentity, ["Normativa locale e adempimenti"], 0);
assert.ok(instruction.pillar);
assert.ok(instruction.instruction.includes("Pilastro editoriale prioritario:"));
assert.ok(instruction.instruction.includes("Scegli un sotto-tema specifico e un angolo nuovo"));
assert.equal(instruction.instruction.includes("javascript:"), false);

const vercel = await readFile(new URL("../api/generate-text.ts", import.meta.url), "utf8");
assert.ok(vercel.includes("visual_identity"));
assert.ok(vercel.includes("enrichRequestedTopicWithPillars(topic, brand?.visual_identity)"));
assert.ok(vercel.includes("topic: enriched.topic"));
assert.ok(vercel.includes("editorial_pillars_used: enriched.pillarCount"));
const worker = await readFile(new URL("../cloudflare/generate-text.ts", import.meta.url), "utf8");
assert.ok(worker.includes("visual_identity"));
assert.ok(worker.includes("enrichRequestedTopicWithPillars(topic, brand?.visual_identity)"));
assert.ok(worker.includes("topic: enriched.topic"));
assert.ok(worker.includes("editorial_pillars_used: enriched.pillarCount"));

const autopilot = await readFile(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
assert.ok(autopilot.includes("select description,business_model,location,service_area,target_audience,tone_of_voice,goals,visual_identity"));
assert.match(autopilot, /buildAutopilotPillarInstruction\(loaded\.visualIdentity,\s*topics,\s*count\)/);
assert.match(autopilot, /pillar\.instruction\|\|"Scegli autonomamente un nuovo tema editoriale specifico e utile per questa attività\."/);
assert.match(autopilot, /selectPlanItem\(strategy\?\.platform_strategy,provider,scheduledAt\)/, "il piano AI persistito deve avere priorità sulla rotazione locale");
assert.match(autopilot, /planner_driven:Boolean\(planItem\)/, "la telemetria deve distinguere i contenuti guidati dal Planner");
assert.ok(autopilot.includes("order by created_at desc limit 24"));

console.log("PASS editorial intelligence: pilastri persistiti restano fallback; il Planner AI persistito guida l'Autopilot quando disponibile.");
