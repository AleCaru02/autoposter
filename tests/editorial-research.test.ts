import assert from "node:assert/strict";
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

const websiteOnly = buildEditorialResearchPolicy("WEBSITE_ONLY");
assert.equal(websiteOnly.useWebSearch, false);

const plumber = buildSectorResearchInstruction({
  industry: "Idraulica",
  description: "Pronto intervento, manutenzione e installazioni idrauliche",
  businessModel: "Servizi locali",
  target: "Proprietari di casa e amministratori",
  mode: "BALANCED",
});
assert.equal(plumber.mode, "BALANCED");
assert.match(plumber.instruction, /Idraulica/);
assert.match(plumber.instruction, /non è l'unico universo di argomenti/i);
assert.match(plumber.instruction, /informazione esterna/i);
assert.doesNotMatch(plumber.instruction, /property manager/i);

console.log("PASS editorial research: website defines brand context while sector-aware web research is filtered by content mode and relevance.");
