import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { contentPillarsFromVisualIdentity, enrichRequestedTopicWithPillars } from "../api/_lib/editorial-intelligence.js";

const visualIdentity = {
  contentPillars: [
    { name: "Gestione operativa", description: "Processi quotidiani per affitti brevi", sourceUrls: ["https://example.test/servizi", "javascript:alert(1)"] },
    { name: "Normativa locale", description: "Adempimenti verificati sul sito", sourceUrls: ["https://example.test/normativa"] },
    { name: "gestione operativa", description: "Duplicato che deve essere ignorato", sourceUrls: [] },
    { name: "", description: "Senza nome", sourceUrls: [] },
  ],
};

const pillars = contentPillarsFromVisualIdentity(visualIdentity);
assert.equal(pillars.length, 2);
assert.equal(pillars[0].name, "Gestione operativa");
assert.deepEqual(pillars[0].sourceUrls, ["https://example.test/servizi"]);
assert.equal(pillars[1].name, "Normativa locale");

const plain = enrichRequestedTopicWithPillars("Come preparare un immobile", null);
assert.equal(plain.topic, "Come preparare un immobile");
assert.equal(plain.pillarCount, 0);

const enriched = enrichRequestedTopicWithPillars("Come preparare un immobile", visualIdentity);
assert.equal(enriched.pillarCount, 2);
assert.ok(enriched.topic.startsWith("Come preparare un immobile"), "il tema esplicito dell'utente deve restare prioritario");
assert.ok(enriched.topic.includes("Gestione operativa"));
assert.ok(enriched.topic.includes("https://example.test/servizi"));
assert.ok(enriched.topic.includes("Normativa locale"));
assert.equal(enriched.topic.includes("javascript:"), false, "fonti non HTTP(S) devono essere eliminate");
assert.ok(enriched.topic.includes("Non copiare queste istruzioni in editorialTopic o editorialAngle"));

const vercel = await readFile(new URL("../api/generate-text.ts", import.meta.url), "utf8");
assert.ok(vercel.includes("visual_identity"), "Vercel deve leggere la site intelligence persistita");
assert.ok(vercel.includes("enrichRequestedTopicWithPillars(topic, brand?.visual_identity)"));
assert.ok(vercel.includes("topic: enriched.topic"));
assert.ok(vercel.includes("editorial_pillars_used: enriched.pillarCount"));

const worker = await readFile(new URL("../cloudflare/generate-text.ts", import.meta.url), "utf8");
assert.ok(worker.includes("visual_identity"), "Worker deve leggere la site intelligence persistita");
assert.ok(worker.includes("enrichRequestedTopicWithPillars(topic, brand?.visual_identity)"));
assert.ok(worker.includes("topic: enriched.topic"));
assert.ok(worker.includes("editorial_pillars_used: enriched.pillarCount"));

console.log("PASS editorial intelligence manual: tema utente preservato, pilastri persistiti consumati e parità Vercel/Worker verificata.");