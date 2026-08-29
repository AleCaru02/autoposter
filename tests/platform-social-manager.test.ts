import assert from "node:assert/strict";
import { buildPlatformManagerInstruction, decidePlatformAdaptation } from "../api/_lib/platform-social-manager.js";
import { buildSectorResearchInstruction } from "../api/_lib/editorial-research.js";

assert.equal(decidePlatformAdaptation("LINKEDIN", "POST").mode, "REWRITE_PLATFORM");
assert.equal(decidePlatformAdaptation("LINKEDIN", "STORY").mode, "INELIGIBLE");
assert.equal(decidePlatformAdaptation("GBP", "POST").mode, "DEDICATED_CONTENT");
assert.equal(decidePlatformAdaptation("GBP", "CAROUSEL").mode, "INELIGIBLE");
assert.equal(decidePlatformAdaptation("GBP", "POST", { localBusinessRelevance: false }).mode, "INELIGIBLE");
assert.equal(decidePlatformAdaptation("INSTAGRAM", "POST").mode, "REWRITE_PLATFORM");
assert.equal(decidePlatformAdaptation("FACEBOOK", "POST").mode, "REWRITE_PLATFORM");

const instruction = buildPlatformManagerInstruction(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"], ["POST"]);
assert.match(instruction, /nucleo editoriale comune/i);
assert.match(instruction, /LinkedIn.*professionale/i);
assert.match(instruction, /GBP.*contenuto dedicato/i);
assert.match(instruction, /non una copia abbreviata/i);

const engineInstruction = buildSectorResearchInstruction({ industry: "Property management", description: "Affitti brevi", businessModel: "Servizi", target: "Proprietari", mode: "BALANCED" }).instruction;
assert.match(engineInstruction, /SOCIAL MANAGER ORCHESTRATOR/i, "platform manager must be wired into the shared OpenAI generation instruction");
assert.match(engineInstruction, /LINKEDIN\/POST: REWRITE_PLATFORM/i);
assert.match(engineInstruction, /GBP\/POST: DEDICATED_CONTENT/i);
assert.match(engineInstruction, /GBP\/CAROUSEL: INELIGIBLE/i);

console.log("Platform social manager regression: PASS");
