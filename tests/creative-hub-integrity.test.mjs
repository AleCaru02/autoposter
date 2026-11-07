import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/creative-hub.tsx", import.meta.url), "utf8");

for (const forbidden of ["Gemini Omni Flash", "Nano Banana", "@alessandro.sitiweb"]) {
  assert.ok(!source.includes(forbidden), `Dashboard must not show unconfigured providers or a fixed external brand: ${forbidden}`);
}
assert.match(source, /STUDIO|POST AUTOMATICI/, "The command center must show product identity");
assert.match(source, /\{profileName\}/, "The workspace must remain scoped to the selected profile");
assert.doesNotMatch(source, /creator-ig-frame|creator-ig-visual|Esempio illustrativo/, "Do not use fake Instagram screenshots in an operational dashboard");
assert.match(source, /reviewCount > 0[\s\S]*connectedCount === 0/, "The primary action must prioritize real reviews and social readiness");
assert.match(source, /\{publishedCount\}/, "Real published-job counts must remain visible");
assert.match(source, /\{scheduledCount\}/, "Real upcoming-job counts must remain visible");
assert.match(source, /Apri budget AI/, "Budget actions must open the real settings");
assert.match(source, /I Reel AI non sono ancora attivi/, "Reels must be explicitly unavailable until configured");
assert.ok(!source.includes("Simulatore di costo"), "Unverified price estimates must not be shown");
const dashboard = readFileSync(new URL("../src/pages/dashboard-page.tsx", import.meta.url), "utf8");
assert.match(dashboard, /verifiedSocialCount\(profileId!?\)/, "Dashboard must verify social provider availability");
assert.match(dashboard, /provider\.readiness\?\.state === "PASS_REAL"/, "Dashboard must count provider preflight PASS_REAL, not stored ACTIVE rows");
assert.doesNotMatch(dashboard, /neonClient\.from\("social_connections"\)\.select\("id"/, "Stored ACTIVE rows cannot be used as verified social channel counts");
assert.match(source, /Canali pronti/, "Dashboard readiness count must be labeled accurately");

console.log("Creative Hub profile isolation and real AI cost messaging: PASS");
