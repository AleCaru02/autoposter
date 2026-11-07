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
console.log("Creative Hub profile isolation and real AI cost messaging: PASS");
