import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { siteIntelligenceView } from "../src/lib/site-intelligence-view.js";

const parsed = siteIntelligenceView({
  visual_identity: {
    observedColors: ["#123456", "rgb(1, 2, 3)", "not-a-color"],
    observedFonts: ["Inter", "Montserrat", "Inter"],
    logoUrl: "https://example.test/logo.svg",
    contentPillars: [
      { name: "Gestione operativa", description: "Processi per affitti brevi" },
      { name: "gestione operativa", description: "duplicato" },
      { name: "Normativa", description: "Adempimenti" },
    ],
    pageInsights: [{ url: "a" }, { url: "b" }],
  },
  services: ["Check-in", "Gestione annunci"],
  tone_of_voice: { traits: ["professionale", "diretto"] },
  target_audience: { summary: "Proprietari di immobili" },
  differentiators: ["Gestione completa"],
});

assert.deepEqual(parsed.colors, ["#123456", "rgb(1, 2, 3)"]);
assert.deepEqual(parsed.fonts, ["Inter", "Montserrat"]);
assert.equal(parsed.logoUrl, "https://example.test/logo.svg");
assert.deepEqual(parsed.pillars.map((item) => item.name), ["Gestione operativa", "Normativa"]);
assert.equal(parsed.pageInsightCount, 2);
assert.deepEqual(parsed.services, ["Check-in", "Gestione annunci"]);
assert.deepEqual(parsed.toneTraits, ["professionale", "diretto"]);
assert.equal(parsed.targetSummary, "Proprietari di immobili");
assert.deepEqual(parsed.differentiators, ["Gestione completa"]);

const unsafe = siteIntelligenceView({ visual_identity: { logoUrl: "javascript:alert(1)", observedColors: ["url(evil)"] } });
assert.equal(unsafe.logoUrl, null);
assert.deepEqual(unsafe.colors, []);

const source = await readFile(new URL("../src/pages/website-scan-page.tsx", import.meta.url), "utf8");
const fullScan = await readFile(new URL("../src/lib/full-website-scan.ts", import.meta.url), "utf8");
assert.ok(source.includes('from("brand_profiles")'), "la pagina deve leggere la site intelligence persistita");
assert.ok(source.includes('.eq("profile_id", profileId)'), "ogni lettura deve restare vincolata all’attività selezionata");
assert.ok(source.includes("siteIntelligenceView"), "la UI deve usare il parser fail-closed");
assert.ok(source.includes("Cosa ho imparato dal sito"), "la site intelligence deve essere visibile all’utente");
assert.ok(source.includes("Non vengono mostrati valori demo"), "la UI deve dichiarare la provenienza reale dei dati");
assert.ok(source.includes("runFullWebsiteScan"), "la pagina Sito deve usare il runner condiviso di scansione completa");
assert.ok(source.includes('scan?.state === "COMPLETE"'), "una scansione parziale deve riprendere automaticamente");
assert.match(fullScan, /pageLimit:\s*8/, "ogni singolo batch deve restare entro il limite Cloudflare sicuro");
assert.match(fullScan, /if \(!body\.hasMore\) return/, "il runner deve continuare finché il backend segnala pagine pendenti");
assert.match(fullScan, /maxBatches = 260/, "deve esistere un limite fail-safe coerente con la copertura massima");

console.log("PASS site intelligence UI: parser fail-closed, dati reali visibili e query profile-scoped verificati.");