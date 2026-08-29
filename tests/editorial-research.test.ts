import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildEditorialResearchPolicy, buildSectorResearchInstruction, normalizeEditorialResearchMode } from "../api/_lib/editorial-research.js";

assert.equal(normalizeEditorialResearchMode("NEWS"), "NEWS");
assert.equal(normalizeEditorialResearchMode("nonsense"), "BALANCED");
const news = buildEditorialResearchPolicy("NEWS");
assert.equal(news.useWebSearch, true);
assert.equal(news.freshnessDays, 14);
assert.match(news.instruction, /notizie recenti/i);
const tips = buildEditorialResearchPolicy("TIPS");
assert.equal(tips.useWebSearch, true);
assert.equal(tips.freshnessDays, null);
assert.match(tips.instruction, /consigli pratici/i);
assert.equal(buildEditorialResearchPolicy("WEBSITE_ONLY").useWebSearch, false);

const plumber = buildSectorResearchInstruction({ industry: "Idraulica", description: "Pronto intervento, manutenzione e installazioni idrauliche", businessModel: "Servizi locali", target: "Proprietari di casa e amministratori", mode: "BALANCED" });
assert.equal(plumber.mode, "BALANCED");
assert.match(plumber.instruction, /Idraulica/);
assert.match(plumber.instruction, /non è l'unico universo di argomenti/i);
assert.match(plumber.instruction, /informazione esterna/i);
assert.doesNotMatch(plumber.instruction, /property manager/i);

const autopilot = readFileSync(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
assert.match(autopilot, /normalizeEditorialResearchMode\(asObject\(strategy\?\.platform_strategy\)\.researchMode\)/, "Autopilot must read researchMode from the current profile strategy");
assert.match(autopilot, /generateSocialText\(\{[^}]*researchMode[^}]*cacheKey:/s, "Autopilot must pass researchMode into OpenAI generation regardless of source formatting");
assert.match(autopilot, /external_sources\s*:\s*generated\.externalSources/, "Autopilot must retain external source telemetry");
assert.match(autopilot, /web_search_calls\s*:\s*generated\.usage\.webSearchCalls/, "Autopilot must retain web search cost telemetry");
assert.match(autopilot, /planItem\?\.intent==="NEWS"\?"NEWS":configuredResearch/, "Planner NEWS intent must force the verified NEWS research path");
assert.doesNotMatch(autopilot, /Usa esclusivamente i fatti confermati dal sito e dal brand/);

const store = readFileSync(new URL("../src/features/content/autopilot-store.ts", import.meta.url), "utf8");
assert.match(store, /researchMode: normalizeEditorialResearchMode\(row\.researchMode\)/);
assert.match(store, /researchMode: normalizeEditorialResearchMode\(settings\.researchMode\)/);
const page = readFileSync(new URL("../src/pages/content-generator-page.tsx", import.meta.url), "utf8");
for (const label of ["Bilanciato", "Consigli", "News", "Evergreen", "Solo sito"]) assert.match(page, new RegExp(label));
assert.match(page, /changeSettings\(\{ researchMode: mode\.value \}\)/);

console.log("PASS editorial research: website defines brand context; sector web research, Planner NEWS routing, profile filter and telemetry are guarded.");
