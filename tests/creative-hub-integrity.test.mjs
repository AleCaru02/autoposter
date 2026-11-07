import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/creative-hub.tsx", import.meta.url), "utf8");

for (const forbidden of ["Gemini Omni Flash", "Nano Banana", "@alessandro.sitiweb"]) {
  assert.ok(!source.includes(forbidden), `Dashboard must not show unconfigured providers or a fixed external brand: ${forbidden}`);
}
assert.match(source, /<span>\{profileName\}<\/span>/, "The graphic demo must use the selected profile name");
assert.match(source, /Esempio illustrativo · non generato e non pubblicato/, "Graphic example must be labeled non-real");
assert.match(source, /Apri budget AI/, "Budget actions must open the real settings");
assert.match(source, /I Reel AI non sono ancora attivi/, "Reels must be explicitly unavailable until configured");
assert.ok(!source.includes("Simulatore di costo"), "Unverified price estimates must not be shown");
const dashboard = readFileSync(new URL("../src/pages/dashboard-page.tsx", import.meta.url), "utf8");
assert.match(dashboard, /verifiedSocialCount\(profileId\)/, "Dashboard must verify social provider availability");
assert.match(dashboard, /provider\.readiness\?\.state === "PASS_REAL"/, "Dashboard must count provider preflight PASS_REAL, not stored ACTIVE rows");
assert.doesNotMatch(dashboard, /neonClient\.from\("social_connections"\)\.select\("id"/, "Stored ACTIVE rows cannot be used as verified social channel counts");
assert.match(source, /Canali pronti/, "Dashboard readiness count must be labeled accurately");

console.log("Creative Hub profile isolation and real AI cost messaging: PASS");
